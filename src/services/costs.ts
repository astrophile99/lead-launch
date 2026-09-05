import { MODEL_CATALOG, type AIProviderId } from "@/config/ai";
import { prisma } from "@/db/client";
import { round } from "@/lib/utils";

/**
 * AI cost accounting.
 *
 * Token counts come from provider responses and are therefore real. Money is
 * only reported where a price has been configured for the model in
 * src/config/ai.ts; otherwise `costUsd` is null and the UI says "not priced"
 * rather than showing an invented figure. Half-priced data would be worse than
 * none, so a window with any unpriced job reports that count too.
 */

export type SpendWindow = {
  jobs: number;
  failed: number;
  mockJobs: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  /** Null when no job in the window had a configured price. */
  costUsd: number | null;
  /** Jobs that ran against a real provider but had no price configured. */
  unpricedJobs: number;
};

export type SpendByProvider = {
  provider: string;
  jobs: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
};

export type SpendByType = {
  type: string;
  jobs: number;
  costUsd: number | null;
  avgCostUsd: number | null;
};

export type SpendSummary = {
  today: SpendWindow;
  week: SpendWindow;
  month: SpendWindow;
  allTime: SpendWindow;
  byProvider: SpendByProvider[];
  byType: SpendByType[];
  /** Cost per unit of work, null until at least one priced job of that type exists. */
  unitCosts: {
    perProspect: number | null;
    perAudit: number | null;
    perWebsite: number | null;
    perOutreach: number | null;
  };
};

type JobRow = {
  provider: string | null;
  type: string;
  status: string;
  isMock: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCached: number | null;
  costUsd: number | null;
  createdAt: Date;
};

const EMPTY: SpendWindow = {
  jobs: 0,
  failed: 0,
  mockJobs: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokensCached: 0,
  costUsd: null,
  unpricedJobs: 0,
};

function summarise(jobs: JobRow[]): SpendWindow {
  if (jobs.length === 0) return { ...EMPTY };

  let cost = 0;
  let anyPriced = false;
  const w: SpendWindow = { ...EMPTY, jobs: jobs.length };

  for (const j of jobs) {
    if (j.status === "failed") w.failed++;
    if (j.isMock) w.mockJobs++;
    w.tokensIn += j.tokensIn ?? 0;
    w.tokensOut += j.tokensOut ?? 0;
    w.tokensCached += j.tokensCached ?? 0;
    if (j.costUsd != null) {
      cost += j.costUsd;
      anyPriced = true;
    } else if (!j.isMock) {
      w.unpricedJobs++;
    }
  }

  w.costUsd = anyPriced ? round(cost, 4) : null;
  return w;
}

function startOf(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export async function getSpendSummary(workspaceId: string): Promise<SpendSummary> {
  const monthStart = startOf(30);

  const [recent, allTimeAgg, prospectCount, auditCount, websiteCount, outreachCount] =
    await Promise.all([
      prisma.aIJob.findMany({
        where: { workspaceId, createdAt: { gte: monthStart } },
        select: {
          provider: true,
          type: true,
          status: true,
          isMock: true,
          tokensIn: true,
          tokensOut: true,
          tokensCached: true,
          costUsd: true,
          createdAt: true,
        },
      }),
      prisma.aIJob.aggregate({
        where: { workspaceId },
        _count: { _all: true },
        _sum: { costUsd: true, tokensIn: true, tokensOut: true, tokensCached: true },
      }),
      prisma.prospect.count({ where: { workspaceId } }),
      prisma.websiteAudit.count({ where: { prospect: { workspaceId }, status: "complete" } }),
      prisma.websiteVersion.count({ where: { project: { workspaceId } } }),
      prisma.outreachMessage.count({ where: { prospect: { workspaceId } } }),
    ]);

  const dayStart = startOf(0);
  const weekStart = startOf(7);

  const today = summarise(recent.filter((j) => j.createdAt >= dayStart));
  const week = summarise(recent.filter((j) => j.createdAt >= weekStart));
  const month = summarise(recent);

  const allTimeCost = allTimeAgg._sum.costUsd;
  const allTime: SpendWindow = {
    ...EMPTY,
    jobs: allTimeAgg._count._all,
    tokensIn: allTimeAgg._sum.tokensIn ?? 0,
    tokensOut: allTimeAgg._sum.tokensOut ?? 0,
    tokensCached: allTimeAgg._sum.tokensCached ?? 0,
    costUsd: allTimeCost != null ? round(allTimeCost, 4) : null,
  };

  // ---- by provider ---------------------------------------------------------
  const providerMap = new Map<string, { jobs: number; tIn: number; tOut: number; cost: number; priced: boolean }>();
  for (const j of recent) {
    const key = j.provider ?? "unknown";
    const e = providerMap.get(key) ?? { jobs: 0, tIn: 0, tOut: 0, cost: 0, priced: false };
    e.jobs++;
    e.tIn += j.tokensIn ?? 0;
    e.tOut += j.tokensOut ?? 0;
    if (j.costUsd != null) {
      e.cost += j.costUsd;
      e.priced = true;
    }
    providerMap.set(key, e);
  }

  const byProvider: SpendByProvider[] = [...providerMap.entries()]
    .map(([provider, e]) => ({
      provider,
      jobs: e.jobs,
      tokensIn: e.tIn,
      tokensOut: e.tOut,
      costUsd: e.priced ? round(e.cost, 4) : null,
    }))
    .sort((a, b) => b.jobs - a.jobs);

  // ---- by task type --------------------------------------------------------
  const typeMap = new Map<string, { jobs: number; cost: number; priced: number }>();
  for (const j of recent) {
    const e = typeMap.get(j.type) ?? { jobs: 0, cost: 0, priced: 0 };
    e.jobs++;
    if (j.costUsd != null) {
      e.cost += j.costUsd;
      e.priced++;
    }
    typeMap.set(j.type, e);
  }

  const byType: SpendByType[] = [...typeMap.entries()]
    .map(([type, e]) => ({
      type,
      jobs: e.jobs,
      costUsd: e.priced > 0 ? round(e.cost, 4) : null,
      avgCostUsd: e.priced > 0 ? round(e.cost / e.priced, 4) : null,
    }))
    .sort((a, b) => b.jobs - a.jobs);

  const per = (total: number | null, count: number) =>
    total != null && count > 0 ? round(total / count, 4) : null;

  return {
    today,
    week,
    month,
    allTime,
    byProvider,
    byType,
    unitCosts: {
      perProspect: per(allTime.costUsd, prospectCount),
      perAudit: per(allTime.costUsd, auditCount),
      perWebsite: per(allTime.costUsd, websiteCount),
      perOutreach: per(allTime.costUsd, outreachCount),
    },
  };
}

/* ------------------------------------------------------------ estimation */

export type CostEstimate = {
  /** Null when the chosen models have no configured price. */
  lowUsd: number | null;
  highUsd: number | null;
  calls: number;
  assumptions: string[];
  priced: boolean;
};

/** Rough token footprints per task, measured from the prompts this app sends. */
const TASK_TOKENS: Record<string, { in: number; out: number }> = {
  "opportunity.analyze": { in: 1400, out: 600 },
  "outreach.draft": { in: 900, out: 400 },
  "website.brief": { in: 1600, out: 1200 },
  "website.build": { in: 6000, out: 9000 },
  "visual.qa": { in: 2500, out: 700 },
  research: { in: 700, out: 400 },
};

/**
 * Estimates the cost of a batch of AI work before it runs.
 *
 * This is an estimate and the UI must say so: real usage depends on page size,
 * how much a model chooses to write, and retries.
 */
export function estimateCost(
  tasks: { type: string; count: number; provider: AIProviderId; model: string }[],
): CostEstimate {
  let low = 0;
  let high = 0;
  let calls = 0;
  let priced = false;
  const assumptions: string[] = [];

  for (const task of tasks) {
    calls += task.count;
    const shape = TASK_TOKENS[task.type] ?? { in: 1000, out: 500 };
    const spec = MODEL_CATALOG[task.provider]?.find((m) => m.id === task.model);

    if (spec?.usdPerMTokIn != null && spec.usdPerMTokOut != null) {
      priced = true;
      const unit =
        (shape.in / 1e6) * spec.usdPerMTokIn + (shape.out / 1e6) * spec.usdPerMTokOut;
      // The band reflects real variance in output length, not a guess at price.
      low += unit * task.count * 0.7;
      high += unit * task.count * 1.6;
      assumptions.push(
        `${task.count} × ${task.type} on ${task.model} (~${shape.in} in / ${shape.out} out tokens each)`,
      );
    } else {
      assumptions.push(
        `${task.count} × ${task.type} on ${task.model} — no price configured for this model`,
      );
    }
  }

  return {
    lowUsd: priced ? round(low, 3) : null,
    highUsd: priced ? round(high, 3) : null,
    calls,
    assumptions,
    priced,
  };
}

export type BudgetState = {
  budgetUsd: number | null;
  spentUsd: number | null;
  pct: number | null;
  status: "ok" | "warn-50" | "warn-80" | "blocked" | "unknown";
  message: string;
};

/** Evaluates the monthly budget. Unknown pricing never blocks work. */
export function evaluateBudget(spentUsd: number | null, budgetUsd: number | null): BudgetState {
  if (budgetUsd == null || budgetUsd <= 0) {
    return {
      budgetUsd,
      spentUsd,
      pct: null,
      status: "unknown",
      message: "No monthly budget set. Set one in Settings to get warnings before you overspend.",
    };
  }
  if (spentUsd == null) {
    return {
      budgetUsd,
      spentUsd,
      pct: null,
      status: "unknown",
      message:
        "Spend cannot be measured because no model prices are configured. Add prices in src/config/ai.ts.",
    };
  }

  const pct = Math.round((spentUsd / budgetUsd) * 100);
  if (pct >= 100) {
    return {
      budgetUsd,
      spentUsd,
      pct,
      status: "blocked",
      message: `The monthly AI budget of $${budgetUsd} is spent. Raise it in Settings to continue running AI jobs.`,
    };
  }
  if (pct >= 80) {
    return { budgetUsd, spentUsd, pct, status: "warn-80", message: `${pct}% of the monthly AI budget is spent.` };
  }
  if (pct >= 50) {
    return { budgetUsd, spentUsd, pct, status: "warn-50", message: `${pct}% of the monthly AI budget is spent.` };
  }
  return { budgetUsd, spentUsd, pct, status: "ok", message: `${pct}% of the monthly AI budget is spent.` };
}
