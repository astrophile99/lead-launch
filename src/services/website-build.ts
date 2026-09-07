import {
  BUILD_QUALITY,
  recommendationReason,
  type BuildQuality,
  type BuildRequest,
  type BuildStrategy,
} from "@/config/build";
import { MODEL_CATALOG, modelSpec, type AIProviderId } from "@/config/ai";
import { buildGateFor, normaliseStage } from "@/config/pipeline";
import { prisma } from "@/db/client";
import { AppError, toAppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import { getAIProvider, resolveRoute } from "@/providers/ai/router";
import { selectBuilder } from "@/providers/website-builder";
import { getStorageProvider } from "@/providers/storage";
import { writeProjectFiles } from "@/agents/website-builder";
import type {
  BuildAgentInput,
  BuildEstimateView,
  BuildOptionsView,
  WebsiteBrief,
} from "@/types";
import { logActivity, notify } from "./activity";
import { refreshSuggestedTask } from "./opportunity";
import { getSettings } from "./settings";
import { estimateCost } from "./costs";
import { persistArtifacts, renderReadme } from "./website-package";

/**
 * Website build orchestration.
 *
 * ## The rule this file exists to enforce
 *
 * A build starts here and nowhere else, and it starts only when someone passes
 * an explicit `BuildRequest` — a provider, a model, a quality mode and, where
 * the prospect has not reached a build-ready stage, a deliberate override flag.
 * There is no default request. There is no "start a build if the score is high"
 * branch. Discovery, auditing, scoring, campaign runs, outreach and stage
 * changes cannot reach this function: nothing in those paths imports it, and a
 * test asserts that.
 *
 * That is not a stylistic preference. Generating a website is the single most
 * expensive operation in the product, and doing it for a prospect who has never
 * replied is money set on fire.
 */

export type BuildEstimate = BuildEstimateView & { provider: AIProviderId };

/** Everything the Build Website dialog needs, resolved on the server. */
export type { BuildOptionsView };

const PROVIDER_LABELS: Record<AIProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  mock: "Deterministic (no model)",
};

/**
 * Picks a default before the operator chooses.
 *
 * Preference order: a configured provider whose catalogue has a model at the
 * quality mode's preferred tier, then any configured provider, then the
 * workspace's own codeGeneration route. Never returns a model the server has no
 * key for without saying so.
 */
export function recommendModel(
  quality: BuildQuality,
): { provider: AIProviderId; model: string; reason: string } | null {
  const wanted = BUILD_QUALITY[quality].preferredTier;
  const order: AIProviderId[] = ["anthropic", "openai", "gemini"];

  for (const tier of [wanted, "premium", "balanced", "fast"] as const) {
    for (const id of order) {
      if (!getAIProvider(id).isConfigured()) continue;
      const match = MODEL_CATALOG[id].find(
        (m) => m.tier === tier && m.supports.includes("codeGeneration"),
      );
      if (match) {
        return { provider: id, model: match.id, reason: recommendationReason(quality, match.tier) };
      }
    }
  }
  return null;
}

export function estimateBuild(
  provider: AIProviderId,
  model: string,
  quality: BuildQuality,
  strategy: BuildStrategy,
): BuildEstimate {
  const spec = BUILD_QUALITY[quality];
  const modelInfo = modelSpec(provider, model);

  if (strategy === "scaffold") {
    return {
      provider,
      model,
      modelLabel: "Deterministic generator",
      quality,
      strategy,
      calls: 0,
      tokensIn: 0,
      tokensOut: 0,
      priced: true,
      lowUsd: 0,
      highUsd: 0,
      iterations: 1,
      qaCycles: 1,
      assumptions: ["The scaffold calls no model, so it costs nothing beyond your own time."],
    };
  }

  const { calls, inPerCall, outPerCall } = spec.estimate;
  const tokensIn = calls * inPerCall;
  const tokensOut = calls * outPerCall;

  const cost = estimateCost([
    { type: "website.build", count: calls, provider, model },
  ]);

  const assumptions = [
    `${spec.label} mode plans once, writes each file, then reviews and fixes up to ${spec.maxIterations} time(s).`,
    `Assumes roughly ${calls} model calls at ~${(inPerCall / 1000).toFixed(0)}k in / ~${(outPerCall / 1000).toFixed(0)}k out each.`,
    "A site with more pages, or one that needs more fix rounds, will cost more.",
  ];

  if (!modelInfo || modelInfo.usdPerMTokIn == null) {
    assumptions.push(
      `No price is configured for ${modelInfo?.label ?? model} in src/config/ai.ts, so no money figure is shown. A guessed price would be worse than none.`,
    );
  }

  // Real prices, when present, are per million tokens; widen the band because
  // the call count is the part we cannot know in advance.
  const unit =
    modelInfo?.usdPerMTokIn != null && modelInfo.usdPerMTokOut != null
      ? (tokensIn / 1e6) * modelInfo.usdPerMTokIn + (tokensOut / 1e6) * modelInfo.usdPerMTokOut
      : null;

  return {
    provider,
    model,
    modelLabel: modelInfo?.label ?? model,
    quality,
    strategy,
    calls,
    tokensIn,
    tokensOut,
    priced: unit != null,
    lowUsd: unit != null ? Number((unit * 0.7).toFixed(4)) : null,
    highUsd: unit != null ? Number((unit * 1.6).toFixed(4)) : null,
    iterations: spec.maxIterations,
    qaCycles: spec.runCodeReview ? spec.maxIterations : 1,
    assumptions: [...assumptions, ...(cost.priced ? [] : [])],
  };
}

/** Resolves everything the confirmation dialog shows, without starting anything. */
export async function getBuildOptions(
  workspaceId: string,
  projectId: string,
): Promise<BuildOptionsView> {
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
            include: { findings: { where: { severity: { in: ["critical", "high"] } }, take: 5 } },
          },
          opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
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

  const settings = await getSettings(workspaceId);
  const quality: BuildQuality =
    settings.buildQuality === "economy"
      ? "fast"
      : settings.buildQuality === "quality"
        ? "premium"
        : "balanced";

  const brief = fromJson<WebsiteBrief | null>(project.briefJson, null);
  const audit = project.prospect.audits[0] ?? null;
  const stage = normaliseStage(project.prospect.stage);
  const storage = getStorageProvider();
  const storageHealth = await storage.health();
  const visionRoute = await resolveRoute(workspaceId, "vision");

  return {
    projectId: project.id,
    prospectId: project.prospectId,
    businessName: project.prospect.business.name,
    industry: project.prospect.business.subcategory ?? project.prospect.business.category,
    currentWebsite: project.prospect.business.website,
    stage,
    stageLabel: stage,
    auditScore: audit?.scoreOverall ?? null,
    opportunityScore: project.prospect.opportunities[0]?.score ?? null,
    weaknesses: (audit?.findings ?? []).map((f) => f.title),
    concept: brief?.positioning ?? null,
    hasBrief: Boolean(brief),
    gate: buildGateFor(stage),
    nextVersion: (project.versions[0]?.version ?? 0) + 1,
    providers: (Object.keys(MODEL_CATALOG) as AIProviderId[])
      .filter((id) => id !== "mock")
      .map((id) => ({
        id,
        label: PROVIDER_LABELS[id],
        configured: getAIProvider(id).isConfigured(),
        models: MODEL_CATALOG[id].map((m) => ({
          id: m.id,
          label: m.label,
          tier: m.tier,
          supported: m.supports.includes("codeGeneration"),
        })),
      })),
    recommended: recommendModel(quality),
    storage: {
      label: storage.label,
      durable: storage.durable,
      detail: storageHealth.detail,
    },
    // Both halves are required, and the browser half is not bundled.
    visualQaAvailable: !visionRoute.provider.isMock && false,
  };
}

/* --------------------------------------------------------------- the build */

export type BuildOutcomeView = {
  buildId: string;
  versionId: string;
  version: number;
  qualityScore: number | null;
  strategy: BuildStrategy;
  requestedStrategy: BuildStrategy;
  fallbackReason: string | null;
  provider: string;
  model: string;
  iterations: number;
  qaCycles: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  durationMs: number;
  files: number;
  durable: boolean;
  remainingIssues: string[];
};

/**
 * Starts a build. The ONLY function in the codebase that creates a
 * WebsiteBuild row.
 *
 * `request` is required and has no default, so no caller can start a build by
 * omission. `request.overrideStage` must be explicitly true to build outside a
 * build-ready stage — the check is here rather than in the UI, because a check
 * that only exists in a dialog is not a check.
 */
export async function startBuild(
  workspaceId: string,
  projectId: string,
  request: BuildRequest,
  actor: { userId: string | null } = { userId: null },
): Promise<BuildOutcomeView> {
  const startedAtMs = Date.now();

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

  const stage = normaliseStage(project.prospect.stage);
  const gate = buildGateFor(stage);
  if (gate.requiresOverride && !request.overrideStage) {
    throw new AppError({
      kind: "conflict",
      message: `${project.prospect.business.name} has not reached a stage where a build is expected. ${gate.reason}`,
      remedy:
        "Move the prospect to Meeting Scheduled or later, or tick “build anyway” in the build dialog to override deliberately.",
    });
  }

  const settings = await getSettings(workspaceId);
  const visionRoute = await resolveRoute(workspaceId, "vision");
  // The visual QA loop needs BOTH a headless browser to capture with and a
  // vision model to judge. The vision half is checked; the browser half is not
  // bundled, so the loop reports unavailable and the gate marks those checks
  // skipped rather than passed.
  const visualQaAvailable = !visionRoute.provider.isMock && false;

  const requestedStrategy: BuildStrategy = request.provider === "mock" ? "scaffold" : "agent";
  const selection = await selectBuilder(workspaceId, requestedStrategy, {
    provider: request.provider,
    model: request.model,
  });

  const version = (project.versions[0]?.version ?? 0) + 1;
  const estimate = estimateBuild(request.provider, request.model, request.quality, selection.ran);

  const build = await prisma.websiteBuild.create({
    data: {
      projectId,
      status: "building",
      stage: "planning",
      provider: selection.ran === "agent" ? request.provider : "builtin-scaffold",
      model: selection.ran === "agent" ? request.model : "deterministic-generator",
      strategy: selection.ran,
      quality: request.quality,
      requestedBy: actor.userId,
      stageAtRequest: stage,
      stageOverride: request.overrideStage,
      notes: request.notes.trim() || null,
      estimateJson: toJson(estimate),
      iteration: 1,
    },
  });

  await prisma.websiteProject.update({ where: { id: projectId }, data: { status: "building" } });
  await logActivity({
    workspaceId,
    prospectId: project.prospectId,
    type: "build.started",
    message: `Website build v${version} started by hand (${selection.ran === "agent" ? `${request.provider}/${request.model}` : "deterministic scaffold"}, ${request.quality}).`,
    meta: {
      buildId: build.id,
      projectId,
      strategy: selection.ran,
      requested: requestedStrategy,
      override: request.overrideStage,
    },
  });

  const audit = project.prospect.audits[0] ?? null;
  const opportunity = project.prospect.opportunities[0] ?? null;
  const b = project.prospect.business;

  const input: BuildAgentInput = {
    business: {
      id: b.id,
      name: b.name,
      category: b.category,
      subcategory: b.subcategory,
      description: b.description,
      address: b.address,
      city: b.city,
      area: b.area,
      country: b.country,
      lat: b.lat,
      lng: b.lng,
      phone: b.phone,
      email: b.email,
      website: b.website,
      googleUrl: b.googleUrl,
      instagram: b.instagram,
      facebook: b.facebook,
      linkedin: b.linkedin,
      rating: b.rating,
      reviewCount: b.reviewCount,
      hours: fromJson<Record<string, string> | null>(b.hoursJson, null),
      services: fromJson<string[]>(b.servicesJson, []),
      images: [],
      logoUrl: b.logoUrl,
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
      "Asymmetric section rhythm — never a row of identical cards.",
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
    const outcome = await selection.builder.build(input, {
      workspaceId,
      projectId,
      slug: project.slug,
      version,
      quality: request.quality,
      notes: request.notes,
      visualQaAvailable,
    });

    if (outcome.status === "failed") {
      throw new AppError({
        kind: "build-failed",
        message: outcome.error ?? "The build failed.",
        remedy: "Read the build log, then retry — possibly with a different model.",
        retryable: true,
        detail: outcome.log.slice(-6).join("\n"),
      });
    }

    const durationMs = Date.now() - startedAtMs;

    // Working copy on disk, for the in-app preview.
    const written = await writeProjectFiles(project.slug, outcome.files);

    const versionRow = await prisma.websiteVersion.create({
      data: {
        projectId,
        buildId: build.id,
        version,
        label: `v${version}`,
        changesJson: toJson(
          version === 1
            ? ["Initial build from the approved brief."]
            : [`Rebuilt from the current brief in ${request.quality} mode.`],
        ),
        filesJson: toJson(written),
        qualityScore: outcome.qualityScore,
        reportJson: toJson(outcome.report),
        provider: outcome.provider,
        model: outcome.model,
        approval: "draft",
        strategy: outcome.strategy,
        quality: request.quality,
        tokensIn: outcome.usage.tokensIn,
        tokensOut: outcome.usage.tokensOut,
        costUsd: outcome.usage.costUsd,
        durationMs,
      },
    });

    const readme = renderReadme({
      businessName: b.name,
      city: b.city,
      slug: project.slug,
      version,
      brief,
      report: outcome.report,
      strategy: outcome.strategy,
      requestedStrategy,
      fallbackReason: selection.fallbackReason,
      quality: request.quality,
      provider: outcome.provider,
      model: outcome.model,
      iterations: outcome.iterations,
      files: outcome.files,
      builtAt: new Date(),
      auditUrl: audit?.finalUrl ?? audit?.url ?? null,
      visualQaAvailable,
    });

    const packaged = await persistArtifacts(versionRow.id, project.slug, version, [
      ...outcome.files,
      { path: "README.md", content: readme },
    ]);

    await prisma.websiteVersion.update({
      where: { id: versionRow.id },
      data: { readmeText: readme },
    });

    await prisma.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "complete",
        stage: "packaged",
        qualityScore: outcome.qualityScore,
        reportJson: toJson(outcome.report),
        logText: outcome.log.join("\n"),
        strategy: outcome.strategy,
        iterations: outcome.iterations,
        qaCycles: outcome.qaCycles,
        tokensIn: outcome.usage.tokensIn,
        tokensOut: outcome.usage.tokensOut,
        tokensCached: outcome.usage.tokensCached,
        costUsd: outcome.usage.costUsd,
        completedAt: new Date(),
      },
    });

    await prisma.websiteProject.update({
      where: { id: projectId },
      data: { status: "ready", storageProvider: getStorageProvider().id },
    });

    // NOTE: the prospect's sales stage is deliberately NOT changed here.
    // Building a website is not a thing that happens *to* the deal, and moving
    // someone to "website-ready" was how production leaked into the pipeline.

    await logActivity({
      workspaceId,
      prospectId: project.prospectId,
      type: "build.completed",
      message: `Website v${version} built (${outcome.strategy === "agent" ? `${outcome.provider}/${outcome.model}` : "scaffold"}). Quality ${outcome.qualityScore}/100. Awaiting review.`,
      meta: { buildId: build.id, version, qualityScore: outcome.qualityScore },
    });

    if (settings.notifyOnBuild) {
      await notify({
        workspaceId,
        type: "build.completed",
        title: `${b.name}: website v${version} ready to review`,
        body: `Quality ${outcome.qualityScore}/100${
          outcome.remainingIssues.length ? `, ${outcome.remainingIssues.length} issue(s) outstanding` : ""
        }. Nothing was deployed.`,
        level: "success",
        link: `/studio/${project.id}`,
      });
    }

    await refreshSuggestedTask(workspaceId, project.prospectId);

    return {
      buildId: build.id,
      versionId: versionRow.id,
      version,
      qualityScore: outcome.qualityScore,
      strategy: outcome.strategy,
      requestedStrategy,
      fallbackReason: selection.fallbackReason,
      provider: outcome.provider,
      model: outcome.model,
      iterations: outcome.iterations,
      qaCycles: outcome.qaCycles,
      tokensIn: outcome.usage.tokensIn,
      tokensOut: outcome.usage.tokensOut,
      costUsd: outcome.usage.costUsd,
      durationMs,
      files: packaged.stored,
      durable: packaged.durable,
      remainingIssues: outcome.remainingIssues,
    };
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
      title: `Build failed: ${b.name}`,
      body: `${err.message} ${err.remedy}`,
      level: "error",
      link: `/studio/${project.id}`,
    });
    throw err;
  }
}

/* ------------------------------------------------------------- version review */

export async function setVersionApproval(
  workspaceId: string,
  versionId: string,
  approval: "draft" | "approved" | "rejected",
  note: string | null,
) {
  const version = await prisma.websiteVersion.findFirst({
    where: { id: versionId, project: { workspaceId } },
    include: { project: true },
  });
  if (!version) {
    throw new AppError({
      kind: "not-found",
      message: "Version not found.",
      remedy: "Refresh the Website Studio.",
    });
  }

  const updated = await prisma.websiteVersion.update({
    where: { id: versionId },
    data: {
      approval,
      approvedAt: approval === "approved" ? new Date() : null,
      reviewNote: note,
    },
  });

  await logActivity({
    workspaceId,
    prospectId: version.project.prospectId,
    type: "build.completed",
    message:
      approval === "approved"
        ? `Marked website v${version.version} approved after review.`
        : approval === "rejected"
          ? `Rejected website v${version.version}.`
          : `Moved website v${version.version} back to draft.`,
    meta: { versionId },
  });

  return updated;
}
