import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import { startJob } from "@/lib/logger";
import { crawlSite, type CrawlResult } from "./crawler";
import { logActivity } from "./activity";
import { recordUsage } from "./provider-usage";

/**
 * Research: what we know about a business, and what it cost to find out.
 *
 * ## The cost rule
 *
 * Research is the recurring expense in this product, so it is layered cheapest
 * first and every layer is cached:
 *
 *   1. **The business's own website.** Free apart from bandwidth, and by far
 *      the most accurate source of what a business actually offers. Bounded by
 *      `crawler.ts`.
 *   2. **OpenStreetMap / Overpass.** Free, open data, no key. Used for
 *      discovery and for filling address and category gaps.
 *   3. **Google Places.** Paid past the free allowance, so it is a fallback for
 *      what the first two could not answer, and every call is counted.
 *
 * ## The AI rule
 *
 * Nothing here sends a raw page to a model. Deterministic parsing answers the
 * questions it can — phone numbers, emails, headings, schema.org, navigation,
 * CTAs — and a model is only worth paying for on the questions parsing cannot
 * answer, like "what does this business actually do". That ordering is the
 * difference between a few cents and a few dollars per prospect.
 *
 * ## Caching
 *
 * A ResearchRecord holds the extracted result, its source, when it was
 * fetched, what was fetched, and a hash of the content. Nothing is re-fetched
 * because a page happened to be opened; refreshing is a thing the user asks
 * for, and when they do, the hash says whether anything actually changed.
 */

export type ExtractedSite = {
  title: string | null;
  description: string | null;
  headings: string[];
  emails: string[];
  phones: string[];
  socials: { platform: string; url: string }[];
  navigation: string[];
  services: string[];
  addresses: string[];
  hasContactForm: boolean;
  hasBooking: boolean;
  ctas: string[];
  images: number;
  favicon: string | null;
  structuredData: Record<string, unknown>[];
  pageCount: number;
  brokenLinks: { url: string; status: number }[];
  /** Pages that were fetched but not parsed, and why. */
  skipped: { url: string; reason: string }[];
};

/* ------------------------------------------------------------- extraction */

const TAG = /<[^>]+>/g;
const SCRIPT_STYLE = /<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi;

function text(html: string): string {
  return html
    .replace(SCRIPT_STYLE, " ")
    .replace(TAG, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/g;
// Loose enough for international formats, tight enough not to match every
// number on the page. Anything shorter than 8 digits is not a phone number.
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,17}\d)/g;

const SOCIAL_HOSTS: Record<string, string> = {
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "linkedin.com": "linkedin",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "youtube.com": "youtube",
  "wa.me": "whatsapp",
};

const SERVICE_HINTS = /\b(service|treatment|package|plan|offer|menu|course|class)\b/i;
const BOOKING_HINTS = /\b(book|appointment|reserve|schedule|enquire|enquiry|consultation)\b/i;

/**
 * Turns crawled HTML into structured facts. Pure and unit-testable: it takes
 * the pages and returns what was observed, with no network and no inference.
 */
export function extractSite(crawl: CrawlResult): ExtractedSite {
  const parsed = crawl.pages.filter((p) => p.html);
  const home = parsed[0];
  const all = parsed.map((p) => p.html!).join("\n");

  const emails = new Set<string>();
  const phones = new Set<string>();
  const socials = new Map<string, string>();
  const headings: string[] = [];
  const navigation = new Set<string>();
  const services = new Set<string>();
  const addresses = new Set<string>();
  const ctas = new Set<string>();
  const structuredData: Record<string, unknown>[] = [];

  // mailto: and tel: are declarations, not guesses — take them first.
  for (const m of all.matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)) {
    emails.add(m[1].trim().toLowerCase());
  }
  for (const m of all.matchAll(/href\s*=\s*["']tel:([^"']+)/gi)) {
    phones.add(m[1].replace(/[^\d+]/g, ""));
  }

  const visible = text(all);
  for (const m of visible.matchAll(EMAIL_RE)) emails.add(m[0].toLowerCase());
  for (const m of visible.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length >= 8) phones.add(digits);
  }

  for (const m of all.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    try {
      const url = new URL(m[1]);
      const host = url.hostname.replace(/^www\./, "");
      const platform = SOCIAL_HOSTS[host];
      if (platform && !socials.has(platform)) socials.set(platform, url.toString());
    } catch {
      /* an unparseable href tells us nothing */
    }
  }

  for (const m of all.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const value = text(m[2]);
    if (value && value.length < 160) headings.push(value);
  }

  if (home?.html) {
    for (const nav of home.html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi)) {
      for (const link of nav[1].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
        const label = text(link[1]);
        if (label && label.length < 40) navigation.add(label);
      }
    }
  }

  for (const heading of headings) {
    if (SERVICE_HINTS.test(heading)) services.add(heading);
  }
  for (const m of all.matchAll(/<li\b[^>]*>([\s\S]{3,90}?)<\/li>/gi)) {
    const value = text(m[1]);
    if (value && SERVICE_HINTS.test(value)) services.add(value);
  }

  for (const m of all.matchAll(/<(?:a|button)\b([^>]*)>([\s\S]{2,60}?)<\/(?:a|button)>/gi)) {
    const label = text(m[2]);
    if (label && BOOKING_HINTS.test(label)) ctas.add(label);
  }

  for (const m of all.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsedJson = JSON.parse(m[1].trim()) as unknown;
      for (const node of Array.isArray(parsedJson) ? parsedJson : [parsedJson]) {
        if (node && typeof node === "object") structuredData.push(node as Record<string, unknown>);
      }
    } catch {
      // Malformed JSON-LD is extremely common. Not an error worth surfacing.
    }
  }

  for (const node of structuredData) {
    const address = node.address as Record<string, unknown> | string | undefined;
    if (typeof address === "string") addresses.add(address);
    else if (address && typeof address === "object") {
      const parts = [
        address.streetAddress,
        address.addressLocality,
        address.addressRegion,
        address.postalCode,
      ].filter((p): p is string => typeof p === "string");
      if (parts.length) addresses.add(parts.join(", "));
    }
  }
  for (const m of all.matchAll(/<address\b[^>]*>([\s\S]*?)<\/address>/gi)) {
    const value = text(m[1]);
    if (value) addresses.add(value);
  }

  const titleMatch = home?.html?.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = home?.html?.match(
    /<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i,
  );
  const iconMatch = home?.html?.match(/<link\b[^>]*rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i);

  return {
    title: titleMatch ? text(titleMatch[1]).slice(0, 200) : null,
    description: descMatch ? attr(descMatch[0], "content")?.slice(0, 400) ?? null : null,
    headings: [...new Set(headings)].slice(0, 30),
    emails: [...emails].slice(0, 10),
    phones: [...phones].slice(0, 10),
    socials: [...socials.entries()].map(([platform, url]) => ({ platform, url })),
    navigation: [...navigation].slice(0, 20),
    services: [...services].slice(0, 20),
    addresses: [...addresses].slice(0, 5),
    hasContactForm: /<form\b/i.test(all) && /email|message|name/i.test(visible),
    hasBooking: ctas.size > 0,
    ctas: [...ctas].slice(0, 10),
    images: (all.match(/<img\b/gi) ?? []).length,
    favicon: iconMatch ? attr(iconMatch[0], "href") : null,
    structuredData: structuredData.slice(0, 5),
    pageCount: parsed.length,
    brokenLinks: crawl.pages
      .filter((p) => p.status >= 400)
      .map((p) => ({ url: p.url, status: p.status })),
    skipped: crawl.pages
      .filter((p) => p.skippedReason)
      .map((p) => ({ url: p.url, reason: p.skippedReason! })),
  };
}

/* ------------------------------------------------------------------ cache */

export type ResearchView = {
  id: string;
  source: string;
  url: string | null;
  status: string;
  error: string | null;
  data: ExtractedSite | null;
  pages: { url: string; status: number; bytes: number }[];
  requests: number;
  bytesFetched: number;
  fetchedAt: string;
  expiresAt: string | null;
  stale: boolean;
};

function ttlMs(): number {
  return appConfig.research.cacheTtlDays * 86_400_000;
}

export async function getResearch(
  workspaceId: string,
  businessId: string,
): Promise<ResearchView[]> {
  const rows = await prisma.researchRecord.findMany({
    where: { workspaceId, businessId },
    orderBy: { fetchedAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    url: r.url,
    status: r.status,
    error: r.error,
    data: fromJson<ExtractedSite | null>(r.dataJson, null),
    pages: fromJson<{ url: string; status: number; bytes: number }[]>(r.pagesJson, []),
    requests: r.requests,
    bytesFetched: r.bytesFetched,
    fetchedAt: r.fetchedAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    stale: r.expiresAt ? r.expiresAt.getTime() < Date.now() : false,
  }));
}

/**
 * Researches a business's own website, using the cache unless told otherwise.
 *
 * `force` is what the "Refresh research" button sends. Without it, a fresh
 * record is returned untouched and no request is made — opening a prospect
 * page must never cost anything.
 */
export async function researchWebsite(
  workspaceId: string,
  businessId: string,
  opts: { force?: boolean } = {},
): Promise<{ record: ResearchView; fromCache: boolean; changed: boolean }> {
  const business = await prisma.business.findFirst({
    where: { id: businessId, workspaceId },
  });
  if (!business) {
    throw new AppError({
      kind: "not-found",
      message: "Business not found.",
      remedy: "Refresh the prospect list.",
    });
  }
  if (!business.website) {
    throw new AppError({
      kind: "conflict",
      message: `${business.name} has no website on record, so there is nothing to crawl.`,
      remedy:
        "Add a website to the business record, or rely on the map listing and the audit instead.",
    });
  }

  const existing = await prisma.researchRecord.findUnique({
    where: { businessId_source: { businessId, source: "crawl" } },
  });

  const fresh =
    existing &&
    existing.status !== "failed" &&
    existing.expiresAt &&
    existing.expiresAt.getTime() > Date.now();

  if (fresh && !opts.force) {
    const [view] = (await getResearch(workspaceId, businessId)).filter((r) => r.source === "crawl");
    return { record: view, fromCache: true, changed: false };
  }

  const log = startJob("research.crawl", { businessId, url: business.website });
  const crawl = await crawlSite(business.website);
  const extracted = extractSite(crawl);
  const hash = sha256(JSON.stringify(extracted));
  const changed = Boolean(existing?.contentHash && existing.contentHash !== hash);

  const status = crawl.error
    ? "failed"
    : crawl.pages.some((p) => p.html)
      ? crawl.pages.some((p) => p.skippedReason)
        ? "partial"
        : "ok"
      : "blocked";

  const saved = await prisma.researchRecord.upsert({
    where: { businessId_source: { businessId, source: "crawl" } },
    create: {
      workspaceId,
      businessId,
      source: "crawl",
      url: business.website,
      status,
      error: crawl.error,
      dataJson: toJson(extracted),
      pagesJson: toJson(
        crawl.pages.map((p) => ({ url: p.url, status: p.status, bytes: p.bytes })),
      ),
      contentHash: hash,
      bytesFetched: crawl.bytes,
      requests: crawl.requests,
      durationMs: crawl.durationMs,
      expiresAt: new Date(Date.now() + ttlMs()),
    },
    update: {
      url: business.website,
      status,
      error: crawl.error,
      dataJson: toJson(extracted),
      pagesJson: toJson(
        crawl.pages.map((p) => ({ url: p.url, status: p.status, bytes: p.bytes })),
      ),
      contentHash: hash,
      bytesFetched: crawl.bytes,
      requests: crawl.requests,
      durationMs: crawl.durationMs,
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlMs()),
    },
  });

  await recordUsage(workspaceId, "crawl", { requests: crawl.requests, errors: crawl.error ? 1 : 0 });
  log.done({ pages: crawl.pages.length, bytes: crawl.bytes });

  // Fill gaps on the business record from what was observed, but never
  // overwrite something a discovery provider already asserted.
  const patch: Record<string, string> = {};
  if (!business.email && extracted.emails[0]) patch.email = extracted.emails[0];
  if (!business.phone && extracted.phones[0]) patch.phone = extracted.phones[0];
  for (const s of extracted.socials) {
    if (s.platform === "instagram" && !business.instagram) patch.instagram = s.url;
    if (s.platform === "facebook" && !business.facebook) patch.facebook = s.url;
    if (s.platform === "linkedin" && !business.linkedin) patch.linkedin = s.url;
  }
  if (Object.keys(patch).length > 0) {
    await prisma.business.update({ where: { id: businessId }, data: patch });
  }

  const prospect = await prisma.prospect.findUnique({
    where: { businessId },
    select: { id: true },
  });
  if (prospect) {
    await logActivity({
      workspaceId,
      prospectId: prospect.id,
      type: crawl.error ? "research.failed" : "research.completed",
      message: crawl.error
        ? `Research failed: ${crawl.error}`
        : `Researched ${crawl.pages.length} page(s) in ${crawl.requests} request(s)${
            changed ? " — the site has changed since last time." : "."
          }`,
      meta: { source: "crawl", bytes: crawl.bytes, changed },
    });
  }

  const [view] = (await getResearch(workspaceId, businessId)).filter((r) => r.id === saved.id);
  return { record: view, fromCache: false, changed };
}

/** How stale the research on a prospect is, for the "Last researched" line. */
export async function researchFreshness(workspaceId: string, businessId: string) {
  const row = await prisma.researchRecord.findUnique({
    where: { businessId_source: { businessId, source: "crawl" } },
    select: { fetchedAt: true, expiresAt: true, status: true, requests: true },
  });
  if (!row) return null;
  return {
    fetchedAt: row.fetchedAt.toISOString(),
    stale: row.expiresAt ? row.expiresAt.getTime() < Date.now() : true,
    status: row.status,
    requests: row.requests,
  };
}
