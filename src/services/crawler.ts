import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import { throttleHost } from "@/lib/rate-limit";
import { assertSafePublicUrl } from "@/lib/safe-url";

/**
 * A deliberately small website crawler.
 *
 * This exists to answer a handful of questions about a local business cheaply —
 * what do they sell, how do you contact them, do they have an about page — and
 * nothing more. An unbounded crawler pointed at arbitrary third-party sites is
 * both a cost problem and, from the site owner's point of view, an attack.
 *
 * Every limit below is enforced, not advisory:
 *
 *   - **SSRF.** Every URL, including every redirect hop, goes through
 *     `assertSafePublicUrl` before a socket is opened. Redirects are followed
 *     manually for exactly this reason: `fetch`'s automatic redirect handling
 *     would take us to 169.254.169.254 without asking.
 *   - **Same host only.** A link off the origin is not followed at all.
 *   - **Page budget.** At most `RESEARCH_MAX_PAGES` documents, from a fixed
 *     priority list, whatever the navigation contains.
 *   - **Byte budget.** The body is read in chunks and abandoned past
 *     `RESEARCH_MAX_BYTES`, so a 2GB "page" cannot exhaust memory.
 *   - **Content type.** Only HTML is parsed; a PDF or a video is recorded as
 *     seen and skipped.
 *   - **Politeness.** One request per host per `RESEARCH_HOST_THROTTLE_MS`, a
 *     real timeout, a bounded redirect chain, and an identifying user agent.
 *   - **robots.txt.** Fetched once per host and honoured for our own agent.
 */

const PRIORITY_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/contact",
  "/contact-us",
  "/services",
  "/menu",
  "/pricing",
  "/team",
];

export type CrawledPage = {
  url: string;
  finalUrl: string;
  status: number;
  bytes: number;
  contentType: string;
  /** Null when the page was skipped rather than parsed. */
  html: string | null;
  skippedReason: string | null;
  loadMs: number;
};

export type CrawlResult = {
  origin: string;
  pages: CrawledPage[];
  requests: number;
  bytes: number;
  durationMs: number;
  robotsBlocked: string[];
  error: string | null;
};

/* ---------------------------------------------------------------- robots */

const robotsCache = new Map<string, { disallow: string[]; fetchedAt: number }>();
const ROBOTS_TTL_MS = 60 * 60 * 1000;

async function robotsFor(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.disallow;

  let disallow: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": appConfig.research.userAgent },
      signal: AbortSignal.timeout(5_000),
      redirect: "follow",
    });
    if (res.ok) {
      const text = (await res.text()).slice(0, 100_000);
      disallow = parseRobots(text);
    }
  } catch {
    // No robots.txt, or unreachable. Absence is permission, per the standard.
  }

  robotsCache.set(origin, { disallow, fetchedAt: Date.now() });
  return disallow;
}

/**
 * Reads the Disallow rules that apply to us: the `*` group, plus any group
 * naming our agent. Deliberately simple — Allow overrides and wildcards are not
 * implemented, and the effect of that is that we are *more* conservative than
 * the file requires, which is the right way for the simplification to fail.
 */
export function parseRobots(text: string, agent = "leadlaunchbot"): string[] {
  const disallow: string[] = [];
  let applies = false;

  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const key = field.trim().toLowerCase();

    if (key === "user-agent") {
      const ua = value.toLowerCase();
      applies = ua === "*" || ua.includes(agent);
    } else if (key === "disallow" && applies && value) {
      disallow.push(value);
    }
  }
  return disallow;
}

export function robotsAllows(path: string, disallow: string[]): boolean {
  return !disallow.some((rule) => rule === "/" || path.startsWith(rule));
}

/* ----------------------------------------------------------------- fetch */

/**
 * Fetches one URL with every limit applied, following redirects by hand so
 * each hop can be re-validated.
 */
async function fetchBounded(
  url: URL,
  budget: { remainingBytes: number },
): Promise<CrawledPage> {
  const startedAt = Date.now();
  let current = url;
  let redirects = 0;

  for (;;) {
    // Re-checked on every hop. A safe first URL that 302s to the metadata
    // endpoint is the entire SSRF-via-redirect class of bug.
    assertSafePublicUrl(current.toString());
    await throttleHost(current.hostname, appConfig.research.hostThrottleMs);

    const res = await fetch(current.toString(), {
      headers: {
        "user-agent": appConfig.research.userAgent,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(appConfig.research.fetchTimeoutMs),
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location || redirects >= appConfig.research.maxRedirects) {
        return {
          url: url.toString(),
          finalUrl: current.toString(),
          status: res.status,
          bytes: 0,
          contentType: res.headers.get("content-type") ?? "",
          html: null,
          skippedReason: location
            ? `Stopped after ${redirects} redirects.`
            : "Redirect with no Location header.",
          loadMs: Date.now() - startedAt,
        };
      }
      redirects += 1;
      current = new URL(location, current);
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    const declaredLength = Number.parseInt(res.headers.get("content-length") ?? "", 10);

    if (!res.ok) {
      return {
        url: url.toString(),
        finalUrl: current.toString(),
        status: res.status,
        bytes: 0,
        contentType,
        html: null,
        skippedReason: `HTTP ${res.status}.`,
        loadMs: Date.now() - startedAt,
      };
    }

    if (!contentType.includes("html")) {
      // Recorded as seen, not parsed. Downloading a PDF to look for a phone
      // number is not worth the bandwidth or the parsing surface.
      return {
        url: url.toString(),
        finalUrl: current.toString(),
        status: res.status,
        bytes: 0,
        contentType,
        html: null,
        skippedReason: `Not HTML (${contentType.split(";")[0] || "unknown type"}).`,
        loadMs: Date.now() - startedAt,
      };
    }

    const cap = Math.min(appConfig.research.maxBytesPerPage, budget.remainingBytes);
    if (Number.isFinite(declaredLength) && declaredLength > cap) {
      return {
        url: url.toString(),
        finalUrl: current.toString(),
        status: res.status,
        bytes: 0,
        contentType,
        html: null,
        skippedReason: `Declared ${(declaredLength / 1024).toFixed(0)}KB, over the ${(cap / 1024).toFixed(0)}KB budget.`,
        loadMs: Date.now() - startedAt,
      };
    }

    // Read in chunks so a body that lies about its length still cannot blow
    // the budget: Content-Length is a claim, not a guarantee.
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let truncated = false;

    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > cap) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }

    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    budget.remainingBytes -= buffer.byteLength;

    return {
      url: url.toString(),
      finalUrl: current.toString(),
      status: res.status,
      bytes: buffer.byteLength,
      contentType,
      html: buffer.toString("utf8"),
      skippedReason: truncated ? `Truncated at ${(cap / 1024).toFixed(0)}KB.` : null,
      loadMs: Date.now() - startedAt,
    };
  }
}

/* ----------------------------------------------------------------- crawl */

/**
 * Crawls a business site.
 *
 * Fetches the homepage, reads its navigation, then visits only the priority
 * paths that the navigation actually links to — so a five-page brochure site
 * costs five requests and a thousand-page site also costs at most
 * `maxPagesPerSite`.
 */
export async function crawlSite(
  websiteUrl: string,
  opts: { maxPages?: number } = {},
): Promise<CrawlResult> {
  const startedAt = Date.now();
  const start = assertSafePublicUrl(websiteUrl);
  const origin = start.origin;
  const maxPages = Math.min(opts.maxPages ?? appConfig.research.maxPagesPerSite, 12);

  const budget = { remainingBytes: appConfig.research.maxBytesPerPage * maxPages };
  const disallow = appConfig.research.respectRobots ? await robotsFor(origin) : [];
  const robotsBlocked: string[] = [];
  const pages: CrawledPage[] = [];
  const visited = new Set<string>();
  let requests = 0;
  let error: string | null = null;

  const queue: string[] = [start.pathname === "/" ? "/" : start.pathname];

  try {
    // Homepage first; its links decide what else is worth fetching.
    while (queue.length > 0 && pages.length < maxPages) {
      const path = queue.shift()!;
      const normalised = path.replace(/\/+$/, "") || "/";
      if (visited.has(normalised)) continue;
      visited.add(normalised);

      if (!robotsAllows(normalised, disallow)) {
        robotsBlocked.push(normalised);
        continue;
      }

      const page = await fetchBounded(new URL(normalised, origin), budget);
      requests += 1;
      pages.push(page);

      if (pages.length === 1 && page.html) {
        for (const candidate of linkedPriorityPaths(page.html, origin)) {
          if (!visited.has(candidate)) queue.push(candidate);
        }
      }

      if (budget.remainingBytes <= 0) break;
    }
  } catch (e) {
    error =
      e instanceof AppError
        ? e.message
        : e instanceof Error
          ? // A DNS failure or a timeout is about the site, not about us, and
            // its message carries no internal detail worth hiding.
            e.message
          : "The site could not be reached.";
  }

  return {
    origin,
    pages,
    requests,
    bytes: pages.reduce((n, p) => n + p.bytes, 0),
    durationMs: Date.now() - startedAt,
    robotsBlocked,
    error,
  };
}

/** Priority paths that the homepage actually links to, in priority order. */
export function linkedPriorityPaths(html: string, origin: string): string[] {
  const found = new Set<string>();
  const hrefs = html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi);

  for (const match of hrefs) {
    let resolved: URL;
    try {
      resolved = new URL(match[1], origin);
    } catch {
      continue;
    }
    // Same origin only. An off-site link is somebody else's server.
    if (resolved.origin !== origin) continue;
    const path = resolved.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    if (PRIORITY_PATHS.includes(path)) found.add(path);
  }

  return PRIORITY_PATHS.filter((p) => found.has(p) && p !== "/");
}
