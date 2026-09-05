import { resolveIndustry } from "@/config/industries";
import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import { slugify } from "@/lib/utils";
import { appConfig } from "@/config/app";
import path from "node:path";
import type { AuditSignals, WebsiteBrief } from "@/types";
import { factsBlock, jsonParser, runAIJob } from "./ai-jobs";
import { logActivity } from "./activity";
import { latestOpportunity, refreshSuggestedTask } from "./opportunity";

/**
 * Produces the website brief that the build agent works from.
 *
 * The brief is editable before it is used - it is a document the user owns, not
 * a hidden prompt. Anything the system does not know is listed under
 * requiresClientInput rather than invented, which is what keeps generated
 * copy free of fabricated credentials and statistics.
 */

const SYSTEM = `You are an art director and information architect planning a website for a specific local business.

Rules:
- Use only what is in the <facts> block. Never invent awards, certifications, years in business,
  testimonials, client names or statistics. If a fact would be needed and is absent, list it under
  requiresClientInput instead.
- Reject template thinking. Decide a visual direction that suits THIS business and say why.
- Do not propose a page the business has no content for.
- Prefer fewer, better pages over a large sitemap.

Return a single JSON object with these keys: positioning, targetAudience, primaryGoal,
secondaryGoals[], brandPersonality[], colorDirection, typographyDirection, designStyle,
pages[{name, purpose, sections[]}], ctaStrategy, trustElements[], socialProof, contentStrategy,
seoStrategy, animationDirection, mobileStrategy, requiresClientInput[].`;

function validateBrief(v: unknown, fallbackGeneratedBy: string): WebsiteBrief {
  const o = v as Record<string, unknown>;
  const s = (k: string, fb: string) =>
    typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : fb;
  const a = (k: string) =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];

  const pages = Array.isArray(o.pages)
    ? (o.pages as unknown[])
        .map((p) => {
          const pg = p as Record<string, unknown>;
          return {
            name: typeof pg.name === "string" ? pg.name : "",
            purpose: typeof pg.purpose === "string" ? pg.purpose : "",
            sections: Array.isArray(pg.sections)
              ? (pg.sections as unknown[]).filter((x): x is string => typeof x === "string")
              : [],
          };
        })
        .filter((p) => p.name)
    : [];

  return {
    positioning: s("positioning", "Not stated."),
    targetAudience: s("targetAudience", "Not stated."),
    primaryGoal: s("primaryGoal", "Make an enquiry"),
    secondaryGoals: a("secondaryGoals"),
    brandPersonality: a("brandPersonality"),
    colorDirection: s("colorDirection", ""),
    typographyDirection: s("typographyDirection", ""),
    designStyle: s("designStyle", ""),
    pages: pages.length ? pages : [{ name: "Home", purpose: "Explain and convert", sections: [] }],
    ctaStrategy: s("ctaStrategy", ""),
    trustElements: a("trustElements"),
    socialProof: s("socialProof", ""),
    contentStrategy: s("contentStrategy", ""),
    seoStrategy: s("seoStrategy", ""),
    animationDirection: s("animationDirection", ""),
    mobileStrategy: s("mobileStrategy", ""),
    requiresClientInput: a("requiresClientInput"),
    generatedBy: s("generatedBy", fallbackGeneratedBy),
  };
}

export async function generateBrief(workspaceId: string, prospectId: string) {
  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, workspaceId },
    include: {
      business: true,
      audits: {
        where: { status: "complete" },
        orderBy: { startedAt: "desc" },
        take: 1,
        include: { findings: { take: 10 } },
      },
    },
  });
  if (!prospect) {
    throw new AppError({
      kind: "not-found",
      message: "Prospect not found.",
      remedy: "Refresh the prospect list.",
    });
  }

  const industry = resolveIndustry(prospect.business.category);
  const audit = prospect.audits[0] ?? null;
  const signals = audit ? fromJson<AuditSignals | null>(audit.signalsJson, null) : null;
  const opportunity = await latestOpportunity(prospectId);
  const services = fromJson<string[]>(prospect.business.servicesJson, []);

  const unknowns: string[] = [];
  if (!services.length) unknowns.push("The actual list of services offered");
  if (!prospect.business.email) unknowns.push("A contact email address");
  if (!prospect.business.hoursJson) unknowns.push("Confirmed opening hours");
  unknowns.push("Photography of the premises and team");
  unknowns.push("Current pricing, or whether pricing should be published at all");

  const facts = {
    businessName: prospect.business.name,
    category: industry.label,
    city: prospect.business.city,
    area: prospect.business.area,
    address: prospect.business.address,
    rating: prospect.business.rating,
    reviewCount: prospect.business.reviewCount,
    website: prospect.business.website,
    services,
    corePages: industry.corePages,
    optionalPages: industry.optionalPages,
    primaryConversion: industry.primaryConversion,
    secondaryConversions: industry.secondaryConversions,
    trustElements: industry.trustElements,
    conversionRisks: industry.conversionRisks,
    currentSiteScore: audit?.scoreOverall ?? null,
    currentSiteFindings: (audit?.findings ?? []).map((f) => f.title),
    currentPlatform: signals?.platform.detected ?? [],
    opportunityLabels: opportunity?.labels ?? [],
    positioningAngle:
      (prospect.business.reviewCount ?? 0) >= 100
        ? "a long local track record backed by review volume"
        : "careful, personal service",
    socialProof:
      prospect.business.rating && prospect.business.reviewCount
        ? `${prospect.business.rating} stars across ${prospect.business.reviewCount} reviews, quoted verbatim with attribution.`
        : "No verified review data — leave space for testimonials the client supplies.",
    unknowns,
  };

  const outcome = await runAIJob<WebsiteBrief>({
    workspaceId,
    type: "website.brief",
    capability: "websitePlanning",
    entityType: "prospect",
    entityId: prospectId,
    inputSummary: { businessName: facts.businessName, category: facts.category },
    request: {
      system: SYSTEM,
      json: true,
      maxTokens: 3000,
      messages: [
        {
          role: "user",
          content: `Plan the replacement website for this business.\n\n${factsBlock(facts)}`,
        },
      ],
    },
    parse: jsonParser((v) => validateBrief(v, "ai")),
  });

  const brief: WebsiteBrief = {
    ...outcome.value,
    generatedBy: outcome.isMock ? "mock:deterministic-composer" : `${outcome.provider}/${outcome.model}`,
  };

  const slug = slugify(`${prospect.business.name}-${prospect.business.city}`);
  const project = await prisma.websiteProject.upsert({
    where: { workspaceId_slug: { workspaceId, slug } },
    create: {
      workspaceId,
      prospectId,
      slug,
      path: path.join(appConfig.studio.projectsRoot, slug),
      status: "brief",
      briefJson: toJson(brief),
    },
    update: { briefJson: toJson(brief), status: "brief" },
  });

  await prisma.prospect.update({
    where: { id: prospectId },
    data: {
      stage: ["discovered", "qualified", "audited"].includes(prospect.stage)
        ? "concept"
        : prospect.stage,
    },
  });

  await logActivity({
    workspaceId,
    prospectId,
    type: "brief.generated",
    message: outcome.isMock
      ? "Website concept composed from stored data and industry priors."
      : `Website concept generated by ${outcome.provider}/${outcome.model}.`,
    meta: { projectId: project.id, isMock: outcome.isMock },
  });

  await refreshSuggestedTask(workspaceId, prospectId);
  return { project, brief, isMock: outcome.isMock };
}

export async function updateBrief(
  workspaceId: string,
  projectId: string,
  brief: WebsiteBrief,
) {
  const project = await prisma.websiteProject.findFirst({
    where: { id: projectId, workspaceId },
  });
  if (!project) {
    throw new AppError({
      kind: "not-found",
      message: "Project not found.",
      remedy: "Reopen the Website Studio.",
    });
  }
  const updated = await prisma.websiteProject.update({
    where: { id: projectId },
    data: { briefJson: toJson(brief) },
  });
  await logActivity({
    workspaceId,
    prospectId: project.prospectId,
    type: "brief.approved",
    message: "Website brief edited and saved.",
    meta: { projectId },
  });
  return updated;
}
