import { prisma } from "@/db/client";
import { OPEN_STAGES, PIPELINE_STAGES, type PipelineStage } from "@/config/pipeline";

/**
 * Every figure below is a query against stored rows. There are no estimates,
 * no extrapolations and no placeholder numbers - if something has not happened
 * yet the metric is zero and the UI says the sample is too small to read.
 */

export type Overview = {
  totalProspects: number;
  newThisWeek: number;
  highOpportunity: number;
  websitesAudited: number;
  auditsFailed: number;
  websitesGenerated: number;
  websitesDeployed: number;
  outreachDrafted: number;
  outreachSent: number;
  replies: number;
  meetings: number;
  won: number;
  pipelineValue: number;
  wonValue: number;
  mockProspects: number;
};

export async function getOverview(workspaceId: string): Promise<Overview> {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [
    totalProspects,
    newThisWeek,
    highOpportunity,
    websitesAudited,
    auditsFailed,
    websitesGenerated,
    websitesDeployed,
    outreachDrafted,
    outreachSent,
    replies,
    meetings,
    won,
    mockProspects,
    openValue,
    wonValueAgg,
  ] = await Promise.all([
    prisma.prospect.count({ where: { workspaceId } }),
    prisma.prospect.count({ where: { workspaceId, createdAt: { gte: weekAgo } } }),
    prisma.prospect.count({ where: { workspaceId, opportunityScore: { gte: 70 } } }),
    prisma.websiteAudit.count({ where: { prospect: { workspaceId }, status: "complete" } }),
    prisma.websiteAudit.count({ where: { prospect: { workspaceId }, status: "failed" } }),
    prisma.websiteVersion.count({ where: { project: { workspaceId } } }),
    prisma.deployment.count({ where: { project: { workspaceId }, status: "ready" } }),
    prisma.outreachMessage.count({ where: { prospect: { workspaceId } } }),
    prisma.outreachMessage.count({
      where: { prospect: { workspaceId }, status: { in: ["sent", "replied"] } },
    }),
    prisma.outreachMessage.count({ where: { prospect: { workspaceId }, status: "replied" } }),
    prisma.prospect.count({ where: { workspaceId, stage: "meeting" } }),
    prisma.prospect.count({ where: { workspaceId, stage: "won" } }),
    prisma.prospect.count({ where: { workspaceId, business: { isMock: true } } }),
    prisma.prospect.aggregate({
      where: { workspaceId, stage: { in: OPEN_STAGES } },
      _sum: { estimatedValue: true },
    }),
    prisma.prospect.aggregate({
      where: { workspaceId, stage: "won" },
      _sum: { estimatedValue: true },
    }),
  ]);

  return {
    totalProspects,
    newThisWeek,
    highOpportunity,
    websitesAudited,
    auditsFailed,
    websitesGenerated,
    websitesDeployed,
    outreachDrafted,
    outreachSent,
    replies,
    meetings,
    won,
    pipelineValue: openValue._sum.estimatedValue ?? 0,
    wonValue: wonValueAgg._sum.estimatedValue ?? 0,
    mockProspects,
  };
}

export type OpportunitySignal = {
  id: string;
  text: string;
  count: number;
  href: string;
};

/** The Overview feed. Each line is a count of rows that actually match. */
export async function getOpportunityFeed(workspaceId: string): Promise<OpportunitySignal[]> {
  const [noWebsite, weakSites, poorMobile, strongButUnconverted, awaitingApproval, staleFollowUps, failedAudits, unaudited] =
    await Promise.all([
      prisma.prospect.count({ where: { workspaceId, business: { website: null } } }),
      prisma.prospect.count({ where: { workspaceId, websiteScore: { lt: 50, not: null } } }),
      prisma.websiteAudit.count({
        where: {
          prospect: { workspaceId, business: { rating: { gte: 4.3 } } },
          status: "complete",
          scoreUx: { lt: 55 },
        },
      }),
      prisma.prospect.count({
        where: {
          workspaceId,
          business: { reviewCount: { gte: 100 } },
          websiteScore: { lt: 60, not: null },
        },
      }),
      prisma.outreachMessage.count({ where: { prospect: { workspaceId }, status: "draft" } }),
      prisma.task.count({
        where: { workspaceId, status: "open", dueAt: { lt: new Date() } },
      }),
      prisma.websiteAudit.count({ where: { prospect: { workspaceId }, status: "failed" } }),
      prisma.prospect.count({ where: { workspaceId, websiteScore: null } }),
    ]);

  const feed: OpportunitySignal[] = [
    {
      id: "no-website",
      text: `${noWebsite} business${noWebsite === 1 ? "" : "es"} with no website`,
      count: noWebsite,
      href: "/prospects?website=none",
    },
    {
      id: "weak-sites",
      text: `${weakSites} website${weakSites === 1 ? "" : "s"} scoring below 50/100`,
      count: weakSites,
      href: "/prospects?score=weak",
    },
    {
      id: "poor-mobile",
      text: `${poorMobile} well-rated business${poorMobile === 1 ? "" : "es"} with poor mobile UX`,
      count: poorMobile,
      href: "/radar?tier=immediate",
    },
    {
      id: "strong-reviews",
      text: `${strongButUnconverted} prospect${strongButUnconverted === 1 ? "" : "s"} with strong reviews but a weak conversion path`,
      count: strongButUnconverted,
      href: "/radar",
    },
    {
      id: "awaiting-approval",
      text: `${awaitingApproval} outreach draft${awaitingApproval === 1 ? "" : "s"} awaiting your approval`,
      count: awaitingApproval,
      href: "/outreach?status=draft",
    },
    {
      id: "overdue",
      text: `${staleFollowUps} task${staleFollowUps === 1 ? "" : "s"} past their due date`,
      count: staleFollowUps,
      href: "/pipeline",
    },
    {
      id: "failed-audits",
      text: `${failedAudits} audit${failedAudits === 1 ? "" : "s"} failed and need a retry`,
      count: failedAudits,
      href: "/audit?status=failed",
    },
    {
      id: "unaudited",
      text: `${unaudited} prospect${unaudited === 1 ? "" : "s"} not yet audited`,
      count: unaudited,
      href: "/audit?status=pending",
    },
  ];

  return feed.filter((f) => f.count > 0).sort((a, b) => b.count - a.count);
}

export type FunnelStep = { id: string; label: string; count: number; rate: number | null };

export async function getFunnel(workspaceId: string): Promise<FunnelStep[]> {
  const rows = await prisma.prospect.groupBy({
    by: ["stage"],
    where: { workspaceId },
    _count: { _all: true },
  });
  const byStage = new Map(rows.map((r) => [r.stage as PipelineStage, r._count._all]));
  const count = (stages: PipelineStage[]) =>
    stages.reduce((s, st) => s + (byStage.get(st) ?? 0), 0);

  const discovered = count([...PIPELINE_STAGES]);
  const qualified = count(
    PIPELINE_STAGES.filter((s) => s !== "discovered") as PipelineStage[],
  );

  // A funnel step must count everyone who reached it *or moved past it*, from
  // either source of evidence: a message we actually sent, or a stage a person
  // moved the prospect into. Counting only messages made the funnel widen
  // further down, because a prospect can be advanced by hand after a phone call
  // that this app never saw.
  const contactedStages: PipelineStage[] = [
    "contacted", "follow-up", "meeting", "proposal", "negotiation", "won", "lost",
  ];
  const repliedStages: PipelineStage[] = ["meeting", "proposal", "negotiation", "won"];

  const sentCount = await prisma.prospect.count({
    where: {
      workspaceId,
      OR: [
        { messages: { some: { status: { in: ["sent", "replied"] } } } },
        { stage: { in: contactedStages } },
      ],
    },
  });
  const repliedCount = await prisma.prospect.count({
    where: {
      workspaceId,
      OR: [{ messages: { some: { status: "replied" } } }, { stage: { in: repliedStages } }],
    },
  });

  const steps: FunnelStep[] = [
    { id: "discovered", label: "Discovered", count: discovered, rate: null },
    { id: "qualified", label: "Qualified", count: qualified, rate: null },
    { id: "contacted", label: "Contacted", count: sentCount, rate: null },
    { id: "replied", label: "Replied", count: repliedCount, rate: null },
    {
      id: "meeting",
      label: "Meeting",
      count: count(["meeting", "proposal", "negotiation", "won"]),
      rate: null,
    },
    { id: "proposal", label: "Proposal", count: count(["proposal", "negotiation", "won"]), rate: null },
    { id: "won", label: "Won", count: count(["won"]), rate: null },
  ];

  return steps.map((s, i) => ({
    ...s,
    rate: i === 0 ? null : steps[i - 1].count > 0 ? s.count / steps[i - 1].count : null,
  }));
}

export type CategoryStat = {
  category: string;
  prospects: number;
  avgOpportunity: number | null;
  avgWebsiteScore: number | null;
};

export async function getCategoryBreakdown(workspaceId: string): Promise<CategoryStat[]> {
  const prospects = await prisma.prospect.findMany({
    where: { workspaceId },
    select: {
      opportunityScore: true,
      websiteScore: true,
      business: { select: { category: true } },
    },
  });

  const map = new Map<string, { n: number; opp: number[]; site: number[] }>();
  for (const p of prospects) {
    const key = p.business.category;
    const entry = map.get(key) ?? { n: 0, opp: [], site: [] };
    entry.n++;
    if (p.opportunityScore != null) entry.opp.push(p.opportunityScore);
    if (p.websiteScore != null) entry.site.push(p.websiteScore);
    map.set(key, entry);
  }

  const avg = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

  return [...map.entries()]
    .map(([category, e]) => ({
      category,
      prospects: e.n,
      avgOpportunity: avg(e.opp),
      avgWebsiteScore: avg(e.site),
    }))
    .sort((a, b) => b.prospects - a.prospects);
}

export type AIUsage = {
  totalJobs: number;
  failed: number;
  mockJobs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  byProvider: { provider: string; jobs: number; tokensOut: number }[];
};

export async function getAIUsage(workspaceId: string): Promise<AIUsage> {
  const jobs = await prisma.aIJob.findMany({
    where: { workspaceId },
    select: {
      provider: true,
      status: true,
      isMock: true,
      tokensIn: true,
      tokensOut: true,
      costUsd: true,
    },
  });

  const byProvider = new Map<string, { jobs: number; tokensOut: number }>();
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let anyCost = false;

  for (const j of jobs) {
    const key = j.provider ?? "unknown";
    const e = byProvider.get(key) ?? { jobs: 0, tokensOut: 0 };
    e.jobs++;
    e.tokensOut += j.tokensOut ?? 0;
    byProvider.set(key, e);
    tokensIn += j.tokensIn ?? 0;
    tokensOut += j.tokensOut ?? 0;
    if (j.costUsd != null) {
      cost += j.costUsd;
      anyCost = true;
    }
  }

  return {
    totalJobs: jobs.length,
    failed: jobs.filter((j) => j.status === "failed").length,
    mockJobs: jobs.filter((j) => j.isMock).length,
    tokensIn,
    tokensOut,
    costUsd: anyCost ? cost : null,
    byProvider: [...byProvider.entries()]
      .map(([provider, e]) => ({ provider, ...e }))
      .sort((a, b) => b.jobs - a.jobs),
  };
}
