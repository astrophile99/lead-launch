import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import { startJob } from "@/lib/logger";
import { throttleHost } from "@/lib/rate-limit";
import { assertSafePublicUrl } from "@/lib/safe-url";

/**
 * Transport for the Overpass API: one query in, elements out, with the retry
 * and failover that public Overpass infrastructure actually requires.
 *
 * ## Why this exists
 *
 * `overpass-api.de` is a DNS round-robin over two FOSSGIS machines. When one
 * of them is unhealthy it answers *every* request with
 * `504 ... Dispatcher_Client::request_read_and_idx::timeout`, including a
 * three-node bounding-box query the healthy machine serves in under two
 * seconds. Measured directly against both backends:
 *
 *     lambert.openstreetmap.de  trivial query  200  1.7s
 *     gall.openstreetmap.de     trivial query  504  6.1s
 *
 * So a client that sends one request to one hostname and gives up fails about
 * half the time for reasons that have nothing to do with the query. Six
 * sequential attempts on the round-robin hostname returned
 * `504, 200, 429, 504, 504, 200`, which also shows that retrying too eagerly
 * trips the two-slot rate limit and makes matters worse.
 *
 * That measurement dictates the design below: retry, because a retry re-rolls
 * the round-robin; back off, because we can rate-limit ourselves; fail over to
 * named endpoints, because the round-robin can keep landing on the broken
 * half; and bound everything, because this is volunteer-run infrastructure we
 * are guests on.
 *
 * ## What it will not do
 *
 * It never returns partial or substitute data. A caller either gets elements
 * an Overpass server really sent, or an `AppError` naming every endpoint tried
 * and how each one failed.
 */

export type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** One recorded attempt. Carried into logs and into the final error. */
export type OverpassAttempt = {
  /** Hostname only; the full URL adds nothing and makes log lines unreadable. */
  host: string;
  attempt: number;
  status: number | null;
  durationMs: number;
  outcome: "ok" | "retryable" | "fatal";
  /** Short and human-readable. Never a raw response body. */
  reason: string;
};

export type OverpassOutcome = {
  elements: OverpassElement[];
  /** Hostname that actually answered. */
  host: string;
  /** Full URL of that endpoint, to hand back as `preferEndpoint` next time. */
  endpoint: string;
  attempts: OverpassAttempt[];
  /** Overpass's own remark, where it sent one. */
  remark: string | null;
  durationMs: number;
};

type Classification = {
  outcome: "ok" | "retryable" | "fatal";
  reason: string;
  /** Honoured for a 429 carrying Retry-After. */
  retryAfterMs?: number;
  /**
   * Whether a second attempt at *this same host* is worth making.
   *
   * True when the server actually answered: `overpass-api.de` is a DNS
   * round-robin, so asking again may reach its healthy sibling.
   *
   * False when the request timed out with no response, which usually means
   * queueing rather than failure. Overpass grants two concurrent slots per
   * client and *holds* requests beyond that until a slot frees - its status
   * endpoint will say "slot available after 57 seconds" while our fetch sits
   * there and eventually aborts. Retrying the same host in that state takes
   * another slot and makes the queue longer for everyone, so we move on.
   */
  retrySameHost: boolean;
};

/** Keeps a response excerpt short and single-line for logs. */
export function snippet(text: string, max = 180): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Pulls the human-readable error out of an Overpass HTML error page, which is
 * how it reports both malformed queries and an unavailable dispatcher.
 */
export function overpassErrorText(body: string): string | null {
  const m = body.match(/<strong[^>]*>\s*Error\s*<\/strong>\s*:?\s*([^<]+)/i);
  return m ? snippet(m[1], 220) : null;
}

/**
 * Decides whether a response is worth another attempt.
 *
 * The distinction that matters: a 400 means we wrote a bad query and no amount
 * of retrying will fix it, so it surfaces immediately with the server's own
 * explanation. A 504 from Overpass does not mean "gateway" in the usual sense.
 * It is how the dispatcher reports being unavailable, and it is by far the
 * most common transient failure here.
 */
export function classifyOverpassResponse(res: {
  status: number;
  contentType: string | null;
  body: string;
  retryAfter?: string | null;
}): Classification {
  const { status, body } = res;
  const ct = (res.contentType ?? "").toLowerCase();

  if (status === 400) {
    const detail = overpassErrorText(body);
    return {
      outcome: "fatal",
      reason: detail
        ? `HTTP 400 rejected the query: ${detail}`
        : "HTTP 400 - Overpass rejected the query as malformed.",
      retrySameHost: false,
    };
  }

  if (status === 429) {
    const secs = Number.parseInt(res.retryAfter ?? "", 10);
    return {
      outcome: "retryable",
      reason: "HTTP 429 - rate limited; every query slot is in use.",
      retryAfterMs: Number.isFinite(secs) && secs > 0 ? Math.min(secs, 30) * 1000 : undefined,
      // A different endpoint has its own limit; this one has said no.
      retrySameHost: false,
    };
  }

  // 504 is Overpass's "dispatcher unavailable"; 502 and 503 are ordinary outages.
  if (status === 502 || status === 503 || status === 504) {
    const detail = overpassErrorText(body);
    return {
      outcome: "retryable",
      reason: detail ? `HTTP ${status} - ${detail}` : `HTTP ${status} - endpoint unavailable.`,
      retrySameHost: true,
    };
  }

  if (status >= 500) {
    return { outcome: "retryable", reason: `HTTP ${status} - server error.`, retrySameHost: true };
  }

  if (status >= 400) {
    // 403, 404 and friends: not something a retry fixes, but another endpoint
    // may be perfectly fine, so this does not end the run.
    return {
      outcome: "retryable",
      reason: `HTTP ${status} - endpoint refused the request.`,
      retrySameHost: false,
    };
  }

  // 2xx from here on. Some instances answer 200 with an HTML error page.
  if (!ct.includes("json")) {
    const detail = overpassErrorText(body);
    return {
      outcome: "retryable",
      reason: detail
        ? `HTTP ${status} but ${ct || "unknown content type"}: ${detail}`
        : `HTTP ${status} but content type was ${ct || "unknown"}, not JSON.`,
      retrySameHost: true,
    };
  }

  return { outcome: "ok", reason: "ok", retrySameHost: false };
}

/** Network-level failures, which never carry a status. */
function classifyThrown(e: unknown): Classification {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  const code = err?.cause?.code;

  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return { outcome: "retryable", reason: "timed out with no response", retrySameHost: false };
  }
  if (code === "CERT_HAS_EXPIRED" || code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
    // Another endpoint may be fine, so the run continues. Never by disabling
    // certificate verification.
    return {
      outcome: "retryable",
      reason: `TLS certificate rejected (${code})`,
      retrySameHost: false,
    };
  }
  if (code) {
    return { outcome: "retryable", reason: `network error (${code})`, retrySameHost: false };
  }
  return {
    outcome: "retryable",
    reason: `network error (${err?.message ?? "unknown"})`,
    retrySameHost: false,
  };
}

function backoffMs(attempt: number, floor: number | undefined): number {
  // 1s, 2s, 4s... with jitter, so concurrent runs do not resynchronise onto
  // the same public server.
  const base = Math.min(1_000 * 2 ** (attempt - 1), 8_000);
  const jitter = Math.random() * 400;
  return Math.max(floor ?? 0, base + jitter);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Shortest attempt worth starting.
 *
 * An idle Overpass answers a city-sized query in under two seconds, but a
 * loaded one is much slower: the same query measured 1.9s, 7.4s and 9.2s
 * against the same host within an hour. Cutting an attempt off at four seconds
 * therefore abandons servers that were about to answer, so the floor is set
 * above the observed slow case rather than the fast one.
 */
const MIN_ATTEMPT_MS = 10_000;

/**
 * How long a single attempt may take.
 *
 * What is left of the budget is shared between the endpoints still to be
 * tried, rather than letting the first one spend all of it. This is not
 * hypothetical: configured against a host that blackholes connections, an
 * earlier version burned the full 45s on two attempts at that one host and
 * never reached the fallbacks - failing with "did not respond after 2 attempts
 * across 1 of 3 endpoints" while two healthy servers went untried. A dead
 * primary must not starve the list behind it.
 *
 * The floor is itself capped by what remains, so a deliberately small budget
 * produces a short attempt rather than no attempt.
 */
export function attemptTimeout(
  remainingMs: number,
  endpointsLeft: number,
  triesLeftHere: number,
): number {
  const configured = appConfig.research.overpassTimeoutMs;
  const fairShare = Math.floor(remainingMs / Math.max(1, endpointsLeft) / Math.max(1, triesLeftHere));
  const floor = Math.max(1_000, Math.min(MIN_ATTEMPT_MS, remainingMs));
  return Math.max(floor, Math.min(configured, fairShare));
}

/**
 * Runs one Overpass QL query, trying each configured endpoint in turn.
 *
 * Attempts are bounded by `overpassMaxAttempts` and by a wall-clock deadline,
 * whichever comes first. No new request starts once the budget is spent, so
 * this cannot outlive the serverless function waiting on it.
 */
export async function runOverpassQuery(
  query: string,
  opts: {
    label?: string;
    deadlineAt?: number;
    preferEndpoint?: string;
    /**
     * Endpoints that already failed earlier in this same search. Mutated as
     * more fail, so a caller running several queries learns as it goes.
     */
    failedEndpoints?: Set<string>;
  } = {},
): Promise<OverpassOutcome> {
  const endpoints = orderEndpoints(
    appConfig.research.overpassUrls,
    opts.preferEndpoint,
    opts.failedEndpoints,
  );
  const maxAttempts = Math.max(1, appConfig.research.overpassMaxAttempts);
  // A caller making several related queries passes one shared deadline so the
  // whole sequence stays inside a single budget rather than each leg getting
  // a fresh one.
  const deadline = opts.deadlineAt ?? Date.now() + appConfig.research.overpassDeadlineMs;
  const startedAt = Date.now();

  const log = startJob("discovery.overpass", {
    label: opts.label ?? "query",
    endpoints: endpoints.length,
    maxAttempts,
  });

  if (endpoints.length === 0) {
    const err = new AppError({
      kind: "not-configured",
      message: "No Overpass endpoint is configured.",
      remedy: "Set OVERPASS_API_URL (or OVERPASS_API_URLS) and run the campaign again.",
      retryable: false,
    });
    log.fail(err);
    throw err;
  }

  const attempts: OverpassAttempt[] = [];
  let attemptNo = 0;
  let endpointIndex = 0;

  for (const endpoint of endpoints) {
    const endpointsLeft = endpoints.length - endpointIndex;
    endpointIndex++;
    // The primary is worth a second try because a retry re-rolls the DNS
    // round-robin. Named fallbacks resolve to a single machine, so retrying
    // one only burns budget that another endpoint could use.
    const isPrimary = endpoint === endpoints[0];
    const triesHere = isPrimary ? 2 : 1;

    let url: URL;
    try {
      url = assertSafePublicUrl(endpoint);
    } catch {
      attempts.push({
        host: snippet(endpoint, 60),
        attempt: ++attemptNo,
        status: null,
        durationMs: 0,
        outcome: "fatal",
        reason: "endpoint is not a valid public URL",
      });
      continue;
    }

    for (let i = 0; i < triesHere; i++) {
      if (attemptNo >= maxAttempts) break;
      if (Date.now() >= deadline) break;

      // Never skip the *first* attempt. A budget smaller than the floor
      // should still produce one real request: silently making no request at
      // all and reporting "0 attempts across 0 endpoints" is the worst of both
      // worlds, and it is what a short OVERPASS_DEADLINE_MS used to cause.
      if (attempts.length > 0 && deadline - Date.now() < MIN_ATTEMPT_MS) break;

      attemptNo++;
      // One in-flight request per host. Overpass grants two slots and we
      // should not be occupying both.
      await throttleHost(url.hostname, 1_000);

      const t0 = Date.now();
      let classification: Classification;
      let status: number | null = null;
      let payload: { elements?: OverpassElement[]; remark?: string } | null = null;

      try {
        const remaining = deadline - Date.now();
        const timeout = attemptTimeout(remaining, endpointsLeft, triesHere - i);

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
            "user-agent": appConfig.research.userAgent,
          },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(timeout),
        });

        status = res.status;
        const body = await res.text();
        classification = classifyOverpassResponse({
          status: res.status,
          contentType: res.headers.get("content-type"),
          body,
          retryAfter: res.headers.get("retry-after"),
        });

        if (classification.outcome === "ok") {
          try {
            payload = JSON.parse(body) as { elements?: OverpassElement[]; remark?: string };
          } catch {
            classification = {
              outcome: "retryable",
              reason: "response claimed JSON but did not parse",
              retrySameHost: true,
            };
          }
        }

        // A server-side query timeout arrives as 200 with a remark and an
        // empty element list. Reporting that as "found nothing" would be a
        // lie, so it is a retryable failure instead.
        if (payload && typeof payload.remark === "string") {
          if (/timed out|out of memory|runtime error/i.test(payload.remark)) {
            classification = {
              outcome: "retryable",
              reason: `server remark: ${snippet(payload.remark, 140)}`,
              retrySameHost: true,
            };
            payload = null;
          }
        }
      } catch (e) {
        classification = classifyThrown(e);
      }

      const durationMs = Date.now() - t0;
      attempts.push({
        host: url.hostname,
        attempt: attemptNo,
        status,
        durationMs,
        outcome: classification.outcome,
        reason: classification.reason,
      });

      if (classification.outcome === "ok" && payload) {
        opts.failedEndpoints?.delete(endpoint);
        log.done({
          host: url.hostname,
          attempt: attemptNo,
          status,
          elements: payload.elements?.length ?? 0,
        });
        return {
          elements: payload.elements ?? [],
          host: url.hostname,
          endpoint,
          attempts,
          remark: payload.remark ?? null,
          durationMs: Date.now() - startedAt,
        };
      }

      opts.failedEndpoints?.add(endpoint);

      log.warn("attempt-failed", {
        host: url.hostname,
        attempt: attemptNo,
        status,
        durationMs,
        outcome: classification.outcome,
        reason: classification.reason,
      });

      // A malformed query is our bug. Every endpoint would reject it the same
      // way, so stop rather than asking four servers to agree.
      if (classification.outcome === "fatal") {
        const err = new AppError({
          kind: "provider-error",
          message: `OpenStreetMap rejected the discovery query. ${classification.reason}`,
          remedy:
            "This is a bug in how the query is built rather than something you can fix. Try a different category or city, and report the campaign id.",
          retryable: false,
          detail: describeAttempts(attempts),
        });
        log.fail(err, { host: url.hostname });
        throw err;
      }

      // Asking this host again would only lengthen its queue.
      if (!classification.retrySameHost) break;

      const budgetLeft = attemptNo < maxAttempts;
      if (budgetLeft && i + 1 < triesHere && Date.now() < deadline) {
        await sleep(backoffMs(i + 1, classification.retryAfterMs));
      }
    }

    if (attemptNo >= maxAttempts || Date.now() >= deadline) break;
  }

  throw exhausted(attempts, endpoints.length, log);
}

/**
 * Puts an endpoint that just worked at the front of the list.
 *
 * A caller running several queries in sequence would otherwise start each one
 * at the configured primary - and if that primary is unreachable, pay its
 * timeout again on every query until the budget is gone. Measured against a
 * blackholed primary, the second query in a two-query sequence never got past
 * it. Whichever server answered a moment ago is the best guess for the next
 * one; the rest of the list still follows in its configured order.
 */
function orderEndpoints(
  endpoints: string[],
  prefer: string | undefined,
  failed: Set<string> | undefined,
): string[] {
  const preferred = prefer && endpoints.includes(prefer) ? [prefer] : [];
  const rest = endpoints.filter((e) => !preferred.includes(e));
  if (!failed?.size) return [...preferred, ...rest];
  // Known-bad endpoints go last rather than being dropped: one that timed out
  // a moment ago may still be the only one left, and refusing to try it would
  // turn a slow search into a failed one.
  return [...preferred, ...rest.filter((e) => !failed.has(e)), ...rest.filter((e) => failed.has(e))];
}

function describeAttempts(attempts: OverpassAttempt[]): string {
  return attempts.map((a) => `${a.host} #${a.attempt}: ${a.reason} (${a.durationMs}ms)`).join(" | ");
}

/**
 * Builds the single error the user sees when nothing worked.
 *
 * It names the dominant failure rather than the last one, because "rate
 * limited" and "unreachable" ask different things of the reader.
 */
function exhausted(
  attempts: OverpassAttempt[],
  endpointCount: number,
  log: ReturnType<typeof startJob>,
): AppError {
  const hosts = new Set(attempts.map((a) => a.host)).size;
  const rateLimited = attempts.filter((a) => a.status === 429).length;
  const timedOut = attempts.filter((a) => a.reason.includes("timed out")).length;
  const tried = `${attempts.length} attempt${attempts.length === 1 ? "" : "s"} across ${hosts} of ${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}`;

  let err: AppError;

  if (rateLimited > 0 && rateLimited >= attempts.length / 2) {
    err = new AppError({
      kind: "rate-limited",
      message: `OpenStreetMap asked us to slow down — every query slot was busy after ${tried}.`,
      remedy:
        "Wait a minute and run the campaign again. Overpass is volunteer-run and grants two slots at a time, so the app backs off rather than pushing harder.",
      retryable: true,
      detail: describeAttempts(attempts),
    });
  } else if (attempts.length > 0 && timedOut === attempts.length) {
    err = new AppError({
      kind: "timeout",
      message: `OpenStreetMap did not respond after ${tried}.`,
      remedy:
        "These endpoints are reachable from some networks and not others. Check this server's outbound access, or set OVERPASS_API_URLS to an instance it can reach.",
      retryable: true,
      detail: describeAttempts(attempts),
    });
  } else {
    err = new AppError({
      kind: "unreachable",
      message: `OpenStreetMap could not be reached after ${tried}.`,
      remedy:
        "Public Overpass servers go down regularly and usually recover within minutes. Set OVERPASS_API_URLS to add an endpoint of your own, or switch discovery to Google Places in Settings.",
      retryable: true,
      detail: describeAttempts(attempts),
    });
  }

  log.fail(err, { attempts: attempts.length, hosts });
  return err;
}
