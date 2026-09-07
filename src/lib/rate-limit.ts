import { AppError } from "@/lib/errors";

/**
 * In-process fixed-window rate limiting.
 *
 * Honest about what it is: this counts requests in the memory of one Node
 * process. It stops a runaway loop, a misbehaving webhook sender and casual
 * brute force on a single instance. It does not survive a restart and it does
 * not coordinate across instances, so the moment this app runs more than one
 * replica the store below must be swapped for Redis or Postgres. That is a
 * ten-line change confined to this file, which is why the interface is here.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Bounded so a hostile caller cannot grow the map without limit. */
const MAX_KEYS = 10_000;

function sweep(now: number): void {
  if (windows.size < MAX_KEYS) return;
  for (const [k, w] of windows) {
    if (w.resetAt <= now) windows.delete(k);
  }
  if (windows.size >= MAX_KEYS) {
    // Still full of live windows: drop the oldest half rather than refuse work.
    const sorted = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [k] of sorted.slice(0, Math.floor(sorted.length / 2))) windows.delete(k);
  }
}

export type RateVerdict = {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function checkRate(key: string, limit: number, windowMs: number): RateVerdict {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    const w = { count: 1, resetAt: now + windowMs };
    windows.set(key, w);
    return { ok: true, remaining: limit - 1, resetAt: w.resetAt, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const ok = existing.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: ok ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/** Throws a structured, retryable error when the window is exhausted. */
export function assertRate(
  key: string,
  limit: number,
  windowMs: number,
  what: string,
): RateVerdict {
  const verdict = checkRate(key, limit, windowMs);
  if (!verdict.ok) {
    throw new AppError({
      kind: "rate-limited",
      message: `Too many ${what} requests.`,
      remedy: `Wait ${verdict.retryAfterSeconds}s and try again.`,
      retryable: true,
    });
  }
  return verdict;
}

/** Test hook. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Per-host politeness for the crawler, as a promise queue rather than a
 * rejection: we want to slow down, not fail.
 */
const lastHit = new Map<string, number>();

export async function throttleHost(host: string, minIntervalMs: number): Promise<void> {
  const now = Date.now();
  const previous = lastHit.get(host) ?? 0;
  const wait = previous + minIntervalMs - now;
  lastHit.set(host, wait > 0 ? previous + minIntervalMs : now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
