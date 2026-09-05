import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import type { AuditScores, AuditSignals, OpportunityReason, SalesAngle } from "@/types";
import { factsBlock, jsonParser, runAIJob } from "./ai-jobs";
import { logActivity } from "./activity";
import { getSettings } from "./settings";
import { scoreOpportunity, type ScoringInput } from "./scoring";
import { syncSuggestedTask, type ProspectState } from "./tasks";
import type { PipelineStage } from "@/config/pipeline";

/**
 * Rule-based scoring runs on every material change and needs no AI at all. The
 * AI layer only adds the *sales angle* on top of an already-explained score, so
 * the number a user sees is never dependent on a model being available.
 */

type SeverityCounts = Record<"critical" | "high" | "medium" | "low" | "info", number>;

async function buildScoringInput(prospectId: string): Promise<ScoringInput> {
  const prospect = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: {
      business: true,
      audits: {
        where: { status: "complete" },
        orderBy: { startedAt: "desc" },
        take: 1,
        include: { findings: true },
      },
    },
  });
  if (!prospect) {
    throw new AppError({
      kind: "not-found",
      message: "Prospect not found.",
      remedy: "Refresh the list.",
    });
  }

  const audit = prospect.audits[0] ?? null;
  const signals = audit ? fromJson<AuditSignals | null>(audit.signalsJson, null) : null;

  const findingCounts: SeverityCounts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of audit?.findings ?? []) {
    const key = f.severity as keyof SeverityCounts;
    if (key in findingCounts) findingCounts[key] += 1;
  }

  return {
    business: {
      name: prospect.business.name,
      category: prospect.business.category,
      rating: prospect.business.rating,
      reviewCount: prospect.business.reviewCount,
      website: prospect.business.website,
      email: prospect.business.email,
      phone: prospect.business.phone,
      instagram: prospect.business.instagram,
      facebook: prospect.business.facebook,
      linkedin: prospect.business.linkedin,
      services: fromJson<string[]>(prospect.business.servicesJson, []),
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
          } satisfies AuditScores,
          findingCounts,
          hasBookingPath:
            (signals?.conversion.bookingKeywords.length ?? 0) > 0 ||
            (signals?.conversion.formCount ?? 0) > 0,
          hasCtaAboveFold: signals?.conversion.ctaAboveFold ?? false,
          isMock: audit.isMock,
        }
      : null,
  };
}

/** Recomputes and stores the opportunity for one prospect. */
export async function rescoreProspect(workspaceId: string, prospectId: string) {
  const settings = await getSettings(workspaceId);
  const input = await buildScoringInput(prospectId);
  const result = scoreOpportunity(input, settings.scoringWeights);

  // Preserve any sales angle already produced for this prospect.
  const previous = await prisma.opportunity.findFirst({
    where: { prospectId },
    orderBy: { createdAt: "desc" },
  });

  await prisma.opportunity.create({
    data: {
      prospectId,
      score: result.score,
      tier: result.tier,
      labelsJson: toJson(result.labels),
      reasonsJson: toJson(result.reasons),
      breakdownJson: toJson(result.breakdown),
      salesAngleJson: previous?.salesAngleJson ?? null,
      generatedBy: "rules",
    },
  });

  await prisma.prospect.update({
    where: { id: prospectId },
    data: {
      opportunityScore: result.score,
      contactabilityScore: result.contactability,
      estimatedValue: result.estimatedValue,
    },
  });

  await logActivity({
    workspaceId,
    prospectId,
    type: "opportunity.scored",
    message: `Opportunity scored ${result.score}/100 (${result.tier}).`,
    meta: { score: result.score, tier: result.tier, labels: result.labels },
  });

  await refreshSuggestedTask(workspaceId, prospectId);
  return result;
}

export async function rescoreAll(workspaceId: string): Promise<number> {
  const prospects = await prisma.prospect.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  for (const p of prospects) await rescoreProspect(workspaceId, p.id);
  return prospects.length;
}

/** Latest opportunity row with JSON decoded. */
export async function latestOpportunity(prospectId: string) {
  const row = await prisma.opportunity.findFirst({
    where: { prospectId },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return null;
  return {
    ...row,
    labels: fromJson<string[]>(row.labelsJson, []),
    reasons: fromJson<OpportunityReason[]>(row.reasonsJson, []),
    breakdown: fromJson<Record<string, { raw: number; weight: number; weighted: number; note: string }>>(
      row.breakdownJson,
      {},
    ),
    salesAngle: fromJson<SalesAngle | null>(row.salesAngleJson, null),
  };
}

// ----------------------------------------------------------- AI sales angle

const SALES_ANGLE_SYSTEM = `You are a senior web consultant preparing a freelance developer for a first conversation with a local business.

Rules you must not break:
- Use only the facts given in the <facts> block. Never invent metrics, competitor names, awards, revenue figures or traffic numbers.
- If something is unknown, say it is unknown rather than estimating it.
- Write like a practitioner, not a marketer. No hype, no "unlock", no "leverage".
- Observations must be specific enough that the business owner would recognise them as true of their own site.

Return a single JSON object with exactly these keys:
whyThisLead, whatToPitch, whatNotToSay (array of strings), openingLine, biggestProblem,
suggestedSolution, estimatedScope, suggestedPricing {low, high, currency, rationale},
recommendedChannel (one of email|whatsapp|instagram|linkedin|phone), groundedIn (array of the
facts you actually used).`;

function validateSalesAngle(v: unknown): SalesAngle {
  const o = v as Record<string, unknown>;
  const s = (k: string, fallback = "") =>
    typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : fallback;
  const arr = (k: string) =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const pricing = (o.suggestedPricing ?? {}) as Record<string, unknown>;

  return {
    whyThisLead: s("whyThisLead", "Not stated."),
    whatToPitch: s("whatToPitch", "Not stated."),
    whatNotToSay: arr("whatNotToSay"),
    openingLine: s("openingLine", ""),
    biggestProblem: s("biggestProblem", "Not stated."),
    suggestedSolution: s("suggestedSolution", "Not stated."),
    estimatedScope: s("estimatedScope", "Not stated."),
    suggestedPricing: {
      low: typeof pricing.low === "number" ? pricing.low : 0,
      high: typeof pricing.high === "number" ? pricing.high : 0,
      currency: typeof pricing.currency === "string" ? pricing.currency : "INR",
      rationale: typeof pricing.rationale === "string" ? pricing.rationale : "",
    },
    recommendedChannel: (["email", "whatsapp", "instagram", "linkedin", "phone"].includes(
      String(o.recommendedChannel),
    )
      ? o.recommendedChannel
      : "email") as SalesAngle["recommendedChannel"],
    groundedIn: arr("groundedIn"),
  };
}

/** Generates the AI sales angle for a prospect and attaches it to the opportunity. */
export async function analyseOpportunity(workspaceId: string, prospectId: string) {
  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, workspaceId },
    include: {
      business: true,
      audits: {
        where: { status: "complete" },
        orderBy: { startedAt: "desc" },
        take: 1,
        include: { findings: { orderBy: { severity: "asc" }, take: 8 } },
      },
      competitors: true,
    },
  });
  if (!prospect) {
    throw new AppError({
      kind: "not-found",
      message: "Prospect not found.",
      remedy: "Refresh the list.",
    });
  }

  const opportunity = await latestOpportunity(prospectId);
  if (!opportunity) {
    throw new AppError({
      kind: "conflict",
      message: "This prospect has not been scored yet.",
      remedy: "Run the audit first; scoring happens automatically afterwards.",
    });
  }

  const audit = prospect.audits[0] ?? null;
  const topFindings = (audit?.findings ?? []).map((f) => f.title);

  const facts = {
    businessName: prospect.business.name,
    category: prospect.business.category,
    city: prospect.business.city,
    area: prospect.business.area,
    rating: prospect.business.rating,
    reviewCount: prospect.business.reviewCount,
    website: prospect.business.website,
    hasEmail: Boolean(prospect.business.email),
    hasPhone: Boolean(prospect.business.phone),
    hasInstagram: Boolean(prospect.business.instagram),
    services: fromJson<string[]>(prospect.business.servicesJson, []),
    websiteScore: audit?.scoreOverall ?? null,
    uxScore: audit?.scoreUx ?? null,
    seoScore: audit?.scoreSeo ?? null,
    performanceScore: audit?.scorePerformance ?? null,
    auditIsMock: audit?.isMock ?? null,
    topFindings,
    findingDetail: (audit?.findings ?? []).map((f) => ({
      title: f.title,
      whatIsWrong: f.whatIsWrong,
      whyItMatters: f.whyItMatters,
      severity: f.severity,
    })),
    opportunityScore: opportunity.score,
    tier: opportunity.tier,
    labels: opportunity.labels,
    valueLow: Math.round((prospect.estimatedValue ?? 50_000) * 0.8),
    valueHigh: Math.round((prospect.estimatedValue ?? 50_000) * 1.4),
    currency: "INR",
    recommendedChannel: prospect.business.email ? "email" : prospect.business.instagram ? "instagram" : "phone",
    verifiedCompetitors: prospect.competitors.filter((c) => c.verified).map((c) => c.name),
  };

  const outcome = await runAIJob<SalesAngle>({
    workspaceId,
    type: "opportunity.analyze",
    capability: "analysis",
    entityType: "prospect",
    entityId: prospectId,
    inputSummary: { businessName: facts.businessName, opportunityScore: facts.opportunityScore },
    request: {
      system: SALES_ANGLE_SYSTEM,
      json: true,
      maxTokens: 2000,
      messages: [
        {
          role: "user",
          content: `Prepare the sales angle for this prospect.\n\n${factsBlock(facts)}`,
        },
      ],
    },
    parse: jsonParser(validateSalesAngle),
  });

  await prisma.opportunity.update({
    where: { id: opportunity.id },
    data: {
      salesAngleJson: toJson(outcome.value),
      generatedBy: outcome.isMock ? "mock:composer" : `ai:${outcome.provider}`,
    },
  });

  await logActivity({
    workspaceId,
    prospectId,
    type: "opportunity.analyzed",
    message: outcome.isMock
      ? "Sales angle composed from stored data (no AI provider configured)."
      : `Sales angle generated by ${outcome.provider}/${outcome.model}.`,
    meta: { jobId: outcome.jobId, isMock: outcome.isMock },
  });

  await refreshSuggestedTask(workspaceId, prospectId);
  return { salesAngle: outcome.value, isMock: outcome.isMock, jobId: outcome.jobId };
}

// ------------------------------------------------------------- task syncing

export async function refreshSuggestedTask(workspaceId: string, prospectId: string) {
  const p = await prisma.prospect.findUnique({
    where: { id: prospectId },
    include: {
      business: { select: { website: true } },
      audits: { where: { status: "complete" }, select: { id: true }, take: 1 },
      opportunities: { select: { id: true }, take: 1 },
      projects: { select: { status: true, briefJson: true } },
      messages: { select: { status: true } },
    },
  });
  if (!p) return;

  const state: ProspectState = {
    id: p.id,
    stage: p.stage as PipelineStage,
    hasWebsite: Boolean(p.business.website),
    hasAudit: p.audits.length > 0,
    hasOpportunity: p.opportunities.length > 0,
    hasBrief: p.projects.some((pr) => Boolean(pr.briefJson)),
    hasReadyWebsite: p.projects.some((pr) => pr.status === "ready" || pr.status === "deployed"),
    hasDraftMessage: p.messages.some((m) => m.status === "draft"),
    hasApprovedMessage: p.messages.some((m) => m.status === "approved"),
    hasSentMessage: p.messages.some((m) => m.status === "sent" || m.status === "replied"),
    lastContactAt: p.lastContactAt,
  };

  await syncSuggestedTask(workspaceId, state);
}
