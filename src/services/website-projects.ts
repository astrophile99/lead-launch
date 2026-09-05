import { prisma } from "@/db/client";
import { AppError, toAppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import { buildWebsite, restoreArchivedVersion } from "@/agents/website-builder";
import { resolveRoute } from "@/providers/ai/router";
import type {
  BuildAgentInput,
  QualityReport,
  WebsiteBrief,
} from "@/types";
import { logActivity, notify } from "./activity";
import { refreshSuggestedTask } from "./opportunity";
import { getSettings } from "./settings";

/**
 * Build orchestration and versioning.
 *
 * Every build is a WebsiteBuild row; every successful build produces an
 * immutable WebsiteVersion. Versions are never overwritten, because iterative
 * AI edits regularly make a site worse and the user must be able to go back.
 */

export async function startBuild(workspaceId: string, projectId: string) {
  const project = await prisma.websiteProject.findFirst({
    where: { id: projectId, workspaceId },
    include: {
      prospect: {
        include: {
          business: true,
          audits: {
            where: { status: "complete" },
            orderBy: { startedAt: "desc" },
            take: 1,
            include: { findings: { take: 12 } },
          },
          opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
          competitors: true,
        },
      },
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  if (!project) {
    throw new AppError({
      kind: "not-found",
      message: "Website project not found.",
      remedy: "Generate a website concept first.",
    });
  }

  const brief = fromJson<WebsiteBrief | null>(project.briefJson, null);
  if (!brief) {
    throw new AppError({
      kind: "conflict",
      message: "This project has no brief.",
      remedy: "Generate and review the website concept before building.",
    });
  }

  const settings = await getSettings(workspaceId);
  const codeRoute = await resolveRoute(workspaceId, "codeGeneration");
  const visionRoute = await resolveRoute(workspaceId, "vision");
  const strategy = codeRoute.provider.isMock ? "scaffold" : "agent";

  // The visual QA loop needs BOTH a headless browser to screenshot with and a
  // vision model to judge the screenshots. The vision half is checked here; the
  // browser half is not bundled, so the loop reports itself as unavailable and
  // the quality gate marks the rendered checks skipped rather than passed.
  const hasVisionModel = !visionRoute.provider.isMock;
  const hasScreenshotRunner = false;
  const visualQaAvailable = hasVisionModel && hasScreenshotRunner;

  const version = (project.versions[0]?.version ?? 0) + 1;

  const build = await prisma.websiteBuild.create({
    data: {
      projectId,
      status: "building",
      stage: "planning",
      provider: strategy === "agent" ? codeRoute.provider.id : "builtin-scaffold",
      model: strategy === "agent" ? codeRoute.model : "deterministic-generator",
      iteration: 1,
    },
  });

  await prisma.websiteProject.update({
    where: { id: projectId },
    data: { status: "building" },
  });
  await prisma.prospect.update({
    where: { id: project.prospectId },
    data: { stage: "building" },
  });
  await logActivity({
    workspaceId,
    prospectId: project.prospectId,
    type: "build.started",
    message: `Website build v${version} started (${strategy === "agent" ? codeRoute.provider.label : "built-in scaffolder"}).`,
    meta: { buildId: build.id, projectId, strategy },
  });

  const audit = project.prospect.audits[0] ?? null;
  const opportunity = project.prospect.opportunities[0] ?? null;

  const input: BuildAgentInput = {
    business: {
      id: project.prospect.business.id,
      name: project.prospect.business.name,
      category: project.prospect.business.category,
      subcategory: project.prospect.business.subcategory,
      description: project.prospect.business.description,
      address: project.prospect.business.address,
      city: project.prospect.business.city,
      area: project.prospect.business.area,
      country: project.prospect.business.country,
      lat: project.prospect.business.lat,
      lng: project.prospect.business.lng,
      phone: project.prospect.business.phone,
      email: project.prospect.business.email,
      website: project.prospect.business.website,
      googleUrl: project.prospect.business.googleUrl,
      instagram: project.prospect.business.instagram,
      facebook: project.prospect.business.facebook,
      linkedin: project.prospect.business.linkedin,
      rating: project.prospect.business.rating,
      reviewCount: project.prospect.business.reviewCount,
      hours: fromJson<Record<string, string> | null>(project.prospect.business.hoursJson, null),
      services: fromJson<string[]>(project.prospect.business.servicesJson, []),
      images: [],
      logoUrl: project.prospect.business.logoUrl,
    },
    audit: audit
      ? {
          scores: {
            performance: audit.scorePerformance ?? 0,
            accessibility: audit.scoreAccessibility ?? 0,
            bestPractices: audit.scoreBestPractices ?? 0,
            seo: audit.scoreSeo ?? 0,
            ux: audit.scoreUx ?? 0,
            technical: audit.scoreTechnical ?? 0,
            overall: audit.scoreOverall ?? 0,
          },
          findings: audit.findings.map((f) => ({
            category: f.category as never,
            severity: f.severity as never,
            title: f.title,
            whatIsWrong: f.whatIsWrong,
            whyItMatters: f.whyItMatters,
            recommendation: f.recommendation,
            effort: f.effort as never,
            impact: f.impact as never,
            evidence: f.evidence ?? undefined,
          })),
        }
      : null,
    opportunity: opportunity
      ? {
          score: opportunity.score,
          labels: fromJson<string[]>(opportunity.labelsJson, []),
          reasons: fromJson(opportunity.reasonsJson, []),
        }
      : null,
    competitors: project.prospect.competitors
      .filter((c) => c.verified)
      .map((c) => ({ name: c.name, website: c.website, note: c.notesJson ?? "" })),
    websiteBrief: brief,
    designRequirements: [
      "One accent colour, used only for actions.",
      "A real type scale; no three shades of grey standing in for hierarchy.",
      "Asymmetric section rhythm - never a row of identical cards.",
      "No decorative gradients, no stock photography placeholders.",
      "Motion only where it clarifies, and gated behind prefers-reduced-motion.",
    ],
    technicalRequirements: [
      "Mobile-first; verified at 375, 768, 1024 and 1440.",
      "Semantic landmarks, labelled inputs, visible focus states.",
      "LocalBusiness structured data, canonical URL, Open Graph.",
      "No render-blocking scripts.",
      "Nothing may be asserted that is not present in the supplied business data.",
    ],
  };

  try {
    const result = await buildWebsite(project.slug, input, {
      strategy,
      version,
      visualQaAvailable,
    });

    if (result.status === "failed") {
      throw new AppError({
        kind: "build-failed",
        message: result.error ?? "The build failed.",
        remedy: "Check the build log, then retry.",
        retryable: true,
      });
    }

    await prisma.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "complete",
        stage: "finalized",
        qualityScore: result.qualityScore,
        reportJson: toJson(result.report),
        logText: result.log,
        completedAt: new Date(),
      },
    });

    await prisma.websiteVersion.create({
      data: {
        projectId,
        buildId: build.id,
        version,
        label: `v${version}`,
        changesJson: toJson(
          version === 1
            ? ["Initial build from the approved brief."]
            : ["Rebuilt from the current brief."],
        ),
        filesJson: toJson(result.filesChanged),
        qualityScore: result.qualityScore,
        reportJson: toJson(result.report),
        provider: strategy === "agent" ? codeRoute.provider.id : "builtin-scaffold",
        model: strategy === "agent" ? codeRoute.model : "deterministic-generator",
      },
    });

    await prisma.websiteProject.update({
      where: { id: projectId },
      data: { status: "ready" },
    });
    await prisma.prospect.update({
      where: { id: project.prospectId },
      data: { stage: "website-ready" },
    });

    await logActivity({
      workspaceId,
      prospectId: project.prospectId,
      type: "build.completed",
      message: `Website v${version} built. Quality ${result.qualityScore}/100.`,
      meta: { buildId: build.id, version, qualityScore: result.qualityScore },
    });
    await notify({
      workspaceId,
      type: "build.completed",
      title: `${project.prospect.business.name}: website v${version} ready`,
      body: `Quality ${result.qualityScore}/100${result.remainingIssues.length ? `, ${result.remainingIssues.length} issue(s) outstanding.` : "."}`,
      level: "success",
      link: `/studio/${project.id}`,
    });

    await refreshSuggestedTask(workspaceId, project.prospectId);
    void settings;
    return { buildId: build.id, version, qualityScore: result.qualityScore, report: result.report };
  } catch (e) {
    const err = toAppError(e, "Retry the build.");
    await prisma.websiteBuild.update({
      where: { id: build.id },
      data: { status: "failed", error: err.message, completedAt: new Date() },
    });
    await prisma.websiteProject.update({ where: { id: projectId }, data: { status: "failed" } });
    await logActivity({
      workspaceId,
      prospectId: project.prospectId,
      type: "build.failed",
      message: `Website build failed: ${err.message}`,
      meta: { buildId: build.id },
    });
    await notify({
      workspaceId,
      type: "build.failed",
      title: `Build failed: ${project.prospect.business.name}`,
      body: `${err.message} ${err.remedy}`,
      level: "error",
      link: `/studio/${project.id}`,
    });
    throw err;
  }
}

export async function getProject(workspaceId: string, projectId: string) {
  const project = await prisma.websiteProject.findFirst({
    where: { id: projectId, workspaceId },
    include: {
      prospect: { include: { business: true } },
      versions: { orderBy: { version: "desc" } },
      builds: { orderBy: { startedAt: "desc" }, take: 10 },
      deployments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) return null;
  return {
    ...project,
    brief: fromJson<WebsiteBrief | null>(project.briefJson, null),
    versionReports: new Map(
      project.versions.map((v) => [v.id, fromJson<QualityReport | null>(v.reportJson, null)]),
    ),
  };
}

export async function restoreVersion(workspaceId: string, projectId: string, versionId: string) {
  const version = await prisma.websiteVersion.findFirst({
    where: { id: versionId, project: { workspaceId, id: projectId } },
    include: { project: true },
  });
  if (!version) {
    throw new AppError({
      kind: "not-found",
      message: "Version not found.",
      remedy: "Reload the Website Studio.",
    });
  }
  const restored = await restoreArchivedVersion(version.project.slug, version.version);

  await prisma.websiteProject.update({
    where: { id: projectId },
    data: { status: "ready" },
  });
  await logActivity({
    workspaceId,
    prospectId: version.project.prospectId,
    type: "build.completed",
    message: `Restored website v${version.version} (${restored.length} files).`,
    meta: { projectId, versionId, restored },
  });

  return { version: version.version, files: restored };
}
