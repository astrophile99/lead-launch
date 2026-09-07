import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";

/**
 * External provider call counters.
 *
 * Google Places is billed per request past a monthly free allowance, and the
 * failure mode of not tracking it is a bill nobody expected. This counts
 * requests and cache hits per provider per month, so the app can answer "how
 * much of the free allowance is left" with a number rather than a shrug.
 *
 * What it does not do is invent a price. `estimatedUsd` is only set where a
 * per-request price is actually configured; everywhere else the UI reports the
 * call count and says the money figure is unknown, in line with the same rule
 * that governs AI spend.
 */

/** USD per request, where the provider publishes a simple per-call price. */
const UNIT_PRICE: Record<string, number | null> = {
  "google-places": null,
  overpass: 0, // Free, open data. Zero is a fact here, not a guess.
  crawl: 0, // Our own bandwidth.
  pagespeed: 0, // Free tier; a key only raises the quota.
  gmail: 0,
  meta: null,
};

export function periodKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function recordUsage(
  workspaceId: string,
  provider: string,
  delta: { requests?: number; cachedHits?: number; errors?: number },
): Promise<void> {
  const period = periodKey();
  const requests = delta.requests ?? 0;
  const price = UNIT_PRICE[provider];

  await prisma.providerUsage.upsert({
    where: { workspaceId_provider_period: { workspaceId, provider, period } },
    create: {
      workspaceId,
      provider,
      period,
      requests,
      cachedHits: delta.cachedHits ?? 0,
      errors: delta.errors ?? 0,
      estimatedUsd: price != null ? requests * price : null,
      lastRequestAt: requests > 0 ? new Date() : null,
    },
    update: {
      requests: { increment: requests },
      cachedHits: { increment: delta.cachedHits ?? 0 },
      errors: { increment: delta.errors ?? 0 },
      ...(price != null ? { estimatedUsd: { increment: requests * price } } : {}),
      ...(requests > 0 ? { lastRequestAt: new Date() } : {}),
    },
  });
}

export type UsageRow = {
  provider: string;
  label: string;
  period: string;
  requests: number;
  cachedHits: number;
  errors: number;
  estimatedUsd: number | null;
  priced: boolean;
  /** Null where the provider has no published free allowance we track. */
  freeAllowance: number | null;
  freeRemaining: number | null;
  lastRequestAt: string | null;
  note: string;
};

const LABELS: Record<string, string> = {
  "google-places": "Google Places",
  overpass: "OpenStreetMap (Overpass)",
  crawl: "Direct website crawl",
  pagespeed: "PageSpeed Insights",
  gmail: "Gmail API",
  meta: "Meta Graph API",
};

const NOTES: Record<string, string> = {
  "google-places":
    "Billed per request past the free allowance. Cached results and the free layers below it exist to keep this number low.",
  overpass:
    "Free and open. Rate-limited by the operators rather than priced, so the app throttles rather than pays.",
  crawl: "Our own bandwidth only. The cheapest and most accurate source of what a business offers.",
  pagespeed: "Free. A key raises the quota rather than unlocking the API.",
  gmail: "Free within Google's per-account sending limits.",
  meta: "Conversation-priced by Meta for WhatsApp; Instagram messaging is not billed per message.",
};

export async function getUsage(workspaceId: string, period = periodKey()): Promise<UsageRow[]> {
  const rows = await prisma.providerUsage.findMany({
    where: { workspaceId, period },
    orderBy: { requests: "desc" },
  });

  return rows.map((r) => {
    const freeAllowance =
      r.provider === "google-places" ? appConfig.research.googleFreeCallsPerMonth : null;
    return {
      provider: r.provider,
      label: LABELS[r.provider] ?? r.provider,
      period: r.period,
      requests: r.requests,
      cachedHits: r.cachedHits,
      errors: r.errors,
      estimatedUsd: r.estimatedUsd,
      priced: UNIT_PRICE[r.provider] != null,
      freeAllowance,
      freeRemaining: freeAllowance != null ? Math.max(0, freeAllowance - r.requests) : null,
      lastRequestAt: r.lastRequestAt?.toISOString() ?? null,
      note: NOTES[r.provider] ?? "",
    };
  });
}

/**
 * How much work the cache saved.
 *
 * Reported as a ratio rather than as money, because the money it saved depends
 * on a Google price this app does not have.
 */
export async function cacheEffectiveness(workspaceId: string, period = periodKey()) {
  const rows = await prisma.providerUsage.findMany({ where: { workspaceId, period } });
  const requests = rows.reduce((n, r) => n + r.requests, 0);
  const cached = rows.reduce((n, r) => n + r.cachedHits, 0);
  const total = requests + cached;
  return {
    requests,
    cached,
    hitRate: total > 0 ? Math.round((cached / total) * 100) : null,
  };
}
