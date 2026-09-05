import * as cheerio from "cheerio";
import { appConfig } from "@/config/app";
import { AppError, toAppError } from "@/lib/errors";
import { assertSafePublicUrl } from "@/lib/safe-url";
import type { AuditSignals } from "@/types";
import type { AuditProvider, AuditProviderResult } from "./types";

/**
 * The default auditor. It performs one real HTTP request and derives every
 * signal from the returned document - no headless browser required, so it runs
 * anywhere and stays fast enough for bulk audits.
 *
 * Everything in AuditSignals is *observed*. Interpretation (scores, findings)
 * happens later in src/services/audit-scoring.ts, which keeps this file honest
 * and the interpretation unit-testable against fixtures.
 */

const UA =
  "Mozilla/5.0 (compatible; LeadLaunchAudit/1.0; +https://github.com/lead-launch) AppleWebKit/537.36";

const BOOKING_WORDS = [
  "book", "appointment", "reserve", "schedule", "consultation", "enquire",
  "enquiry", "inquiry", "get a quote", "request a quote", "trial",
];

const CTA_WORDS = [
  "book", "call", "contact", "get", "request", "start", "enquire", "buy",
  "order", "schedule", "reserve", "download", "subscribe", "apply",
];

const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "linkedin.com", "twitter.com", "x.com",
  "youtube.com", "wa.me", "whatsapp.com",
];

function textBytes(s: string | undefined | null): number {
  return s ? Buffer.byteLength(s, "utf8") : 0;
}

export function extractSignals(
  html: string,
  meta: {
    url: string;
    finalUrl: string;
    httpStatus: number;
    loadMs: number;
    bytes: number;
    contentType: string | null;
    serverHeader: string | null;
  },
): AuditSignals {
  const $ = cheerio.load(html);
  const finalUrl = new URL(meta.finalUrl);

  // ---- headings -----------------------------------------------------------
  const h1 = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const headingLevels = $("h1,h2,h3,h4,h5,h6")
    .map((_, el) => Number(el.tagName.slice(1)))
    .get();
  let headingOrderValid = true;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] - headingLevels[i - 1] > 1) {
      headingOrderValid = false;
      break;
    }
  }

  // ---- structured data ----------------------------------------------------
  const structuredDataTypes: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const t = node?.["@type"];
        if (typeof t === "string") structuredDataTypes.push(t);
        else if (Array.isArray(t)) structuredDataTypes.push(...t.filter((x) => typeof x === "string"));
      }
    } catch {
      /* malformed JSON-LD is itself a finding, recorded via the empty type list */
    }
  });

  // ---- media --------------------------------------------------------------
  const images = $("img");
  let imagesMissingAlt = 0;
  let imagesWithoutDimensions = 0;
  let legacyFormatImages = 0;
  images.each((_, el) => {
    const $el = $(el);
    const alt = $el.attr("alt");
    if (alt == null || alt.trim() === "") {
      // Decorative images legitimately use alt="", so only a *missing* attr counts.
      if (alt == null) imagesMissingAlt++;
    }
    if (!$el.attr("width") || !$el.attr("height")) imagesWithoutDimensions++;
    const src = ($el.attr("src") ?? "").toLowerCase();
    if (/\.(jpe?g|png|gif|bmp)(\?|$)/.test(src)) legacyFormatImages++;
  });

  let largestInlineStyleBytes = 0;
  $("style").each((_, el) => {
    largestInlineStyleBytes = Math.max(largestInlineStyleBytes, textBytes($(el).text()));
  });

  // ---- scripts ------------------------------------------------------------
  const scripts = $("script");
  let inlineScriptBytes = 0;
  let externalScriptCount = 0;
  let jqueryDetected = false;
  let renderBlockingCount = 0;
  scripts.each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    if (src) {
      externalScriptCount++;
      if (/jquery/i.test(src)) jqueryDetected = true;
      const isDeferred = $el.attr("defer") != null || $el.attr("async") != null;
      const isModule = $el.attr("type") === "module";
      if (!isDeferred && !isModule) renderBlockingCount++;
    } else {
      inlineScriptBytes += textBytes($el.text());
      if (/jQuery|\$\(document\)\.ready/i.test($el.text())) jqueryDetected = true;
    }
  });
  const stylesheetCount = $('link[rel="stylesheet"]').length;

  // ---- conversion paths ---------------------------------------------------
  const anchors = $("a");
  let phoneLinks = 0;
  let mailtoLinks = 0;
  let whatsappLinks = 0;
  let mapLinks = 0;
  const socialLinks: string[] = [];
  const ctaCandidates: string[] = [];

  anchors.each((_, el) => {
    const $el = $(el);
    const href = ($el.attr("href") ?? "").trim();
    const label = $el.text().replace(/\s+/g, " ").trim();
    const lower = href.toLowerCase();

    if (lower.startsWith("tel:")) phoneLinks++;
    else if (lower.startsWith("mailto:")) mailtoLinks++;
    else if (lower.includes("wa.me") || lower.includes("api.whatsapp.com")) whatsappLinks++;
    else if (lower.includes("maps.google") || lower.includes("goo.gl/maps") || lower.includes("maps.app.goo.gl"))
      mapLinks++;

    for (const host of SOCIAL_HOSTS) {
      if (lower.includes(host) && !socialLinks.includes(host)) socialLinks.push(host);
    }

    if (label && label.length <= 40) {
      const l = label.toLowerCase();
      if (CTA_WORDS.some((w) => l.startsWith(w) || l.includes(` ${w} `))) {
        if (!ctaCandidates.includes(label)) ctaCandidates.push(label);
      }
    }
  });

  $("button").each((_, el) => {
    const label = $(el).text().replace(/\s+/g, " ").trim();
    if (label && label.length <= 40) {
      const l = label.toLowerCase();
      if (CTA_WORDS.some((w) => l.startsWith(w) || l.includes(` ${w} `))) {
        if (!ctaCandidates.includes(label)) ctaCandidates.push(label);
      }
    }
  });

  const bodyText = $("body").text().replace(/\s+/g, " ").toLowerCase();
  const bookingKeywords = BOOKING_WORDS.filter((w) => bodyText.includes(w));

  // "Above the fold" is approximated structurally: a CTA inside the header,
  // nav, or the first section/hero element of the body.
  const foldScope = $("header, nav, body > main > *:first-child, body > section:first-of-type, .hero, #hero");
  let ctaAboveFold = false;
  foldScope.find("a, button").each((_, el) => {
    const l = $(el).text().toLowerCase();
    const href = ($(el).attr("href") ?? "").toLowerCase();
    if (href.startsWith("tel:") || CTA_WORDS.some((w) => l.includes(w))) ctaAboveFold = true;
  });

  // ---- accessibility ------------------------------------------------------
  let inputsWithoutLabels = 0;
  $("input, select, textarea").each((_, el) => {
    const $el = $(el);
    const type = ($el.attr("type") ?? "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
    const id = $el.attr("id");
    const labelled =
      Boolean($el.attr("aria-label")) ||
      Boolean($el.attr("aria-labelledby")) ||
      Boolean($el.attr("title")) ||
      (id ? $(`label[for="${id.replace(/"/g, '\\"')}"]`).length > 0 : false) ||
      $el.parents("label").length > 0;
    if (!labelled) inputsWithoutLabels++;
  });

  let linksWithoutText = 0;
  anchors.each((_, el) => {
    const $el = $(el);
    const hasText = $el.text().trim().length > 0;
    const hasLabel = Boolean($el.attr("aria-label") || $el.attr("title"));
    const imgAlt = $el.find("img[alt]").filter((_i, im) => ($(im).attr("alt") ?? "").trim() !== "").length > 0;
    if (!hasText && !hasLabel && !imgAlt) linksWithoutText++;
  });

  let buttonsWithoutText = 0;
  $("button").each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && !$el.attr("aria-label") && !$el.attr("title")) buttonsWithoutText++;
  });

  const landmarks = ["header", "nav", "main", "footer", "aside", "section", "article"].filter(
    (tag) => $(tag).length > 0,
  );

  // ---- platform detection -------------------------------------------------
  const generator = $('meta[name="generator"]').attr("content") ?? null;
  const detected: string[] = [];
  const rawLower = html.toLowerCase();
  const fingerprints: [string, RegExp][] = [
    ["WordPress", /wp-content|wp-includes|wordpress/],
    ["Wix", /wix\.com|wixstatic/],
    ["Squarespace", /squarespace/],
    ["Shopify", /cdn\.shopify|shopify\.com/],
    ["Webflow", /webflow/],
    ["GoDaddy Website Builder", /godaddy|websitebuilder/],
    ["Next.js", /__next|\/_next\//],
    ["React", /react(-dom)?[.@]/],
    ["Bootstrap", /bootstrap(\.min)?\.css/],
    ["Elementor", /elementor/],
  ];
  for (const [name, re] of fingerprints) if (re.test(rawLower)) detected.push(name);

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  return {
    fetch: {
      url: meta.url,
      finalUrl: meta.finalUrl,
      httpStatus: meta.httpStatus,
      https: finalUrl.protocol === "https:",
      redirected: meta.url !== meta.finalUrl,
      loadMs: meta.loadMs,
      bytes: meta.bytes,
      contentType: meta.contentType,
      serverHeader: meta.serverHeader,
    },
    html: {
      title,
      titleLength: title?.length ?? 0,
      metaDescription,
      metaDescriptionLength: metaDescription?.length ?? 0,
      canonical: $('link[rel="canonical"]').attr("href") ?? null,
      lang: $("html").attr("lang") ?? null,
      charset:
        $("meta[charset]").attr("charset") ??
        $('meta[http-equiv="Content-Type"]').attr("content") ??
        null,
      viewport: $('meta[name="viewport"]').attr("content") ?? null,
      robots: $('meta[name="robots"]').attr("content") ?? null,
      h1,
      h2Count: $("h2").length,
      headingOrderValid,
      wordCount,
      hasFavicon: $('link[rel*="icon"]').length > 0,
      hasOpenGraph: $('meta[property^="og:"]').length > 0,
      hasTwitterCard: $('meta[name^="twitter:"]').length > 0,
      hasStructuredData: structuredDataTypes.length > 0,
      structuredDataTypes: [...new Set(structuredDataTypes)],
      semanticLandmarks: landmarks,
    },
    media: {
      imageCount: images.length,
      imagesMissingAlt,
      imagesWithoutDimensions,
      legacyFormatImages,
      largestInlineStyleBytes,
    },
    scripts: {
      scriptCount: scripts.length,
      inlineScriptBytes,
      externalScriptCount,
      stylesheetCount,
      jqueryDetected,
      renderBlockingCount,
    },
    conversion: {
      phoneLinks,
      mailtoLinks,
      whatsappLinks,
      mapLinks,
      formCount: $("form").length,
      bookingKeywords,
      ctaCandidates: ctaCandidates.slice(0, 12),
      ctaAboveFold,
      socialLinks,
    },
    accessibility: {
      inputsWithoutLabels,
      linksWithoutText,
      buttonsWithoutText,
      hasSkipLink: $('a[href^="#"]')
        .toArray()
        .some((el) => /skip/i.test($(el).text())),
      tabindexPositive: $("[tabindex]")
        .toArray()
        .filter((el) => Number($(el).attr("tabindex")) > 0).length,
      ariaLandmarkCount: $("[role]").length,
    },
    platform: { generator, detected },
    lighthouse: null,
  };
}

export class FetchHeuristicAuditProvider implements AuditProvider {
  readonly id = "fetch-heuristic";
  readonly label = "Built-in fetch auditor";
  readonly isMock = false;

  isConfigured(): boolean {
    return true;
  }

  async inspect(rawUrl: string): Promise<AuditProviderResult> {
    const url = assertSafePublicUrl(rawUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), appConfig.audit.fetchTimeoutMs);
    const started = Date.now();

    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9",
        },
      });

      const contentType = res.headers.get("content-type");
      const html = await res.text();
      const loadMs = Date.now() - started;

      if (res.status >= 400) {
        throw new AppError({
          kind: res.status === 403 || res.status === 401 ? "blocked" : "unreachable",
          message: `The site returned HTTP ${res.status}.`,
          remedy:
            res.status === 403
              ? "The site is blocking automated requests. Audit it manually, or record the finding by hand."
              : "Confirm the website address on the business record is current.",
          retryable: res.status >= 500,
          detail: `${res.status} ${res.statusText}`,
        });
      }

      if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
        throw new AppError({
          kind: "invalid-input",
          message: `The URL returned "${contentType}" rather than an HTML page.`,
          remedy: "Point the business record at the site's landing page.",
        });
      }

      return {
        engine: this.id,
        isMock: false,
        signals: extractSignals(html, {
          url: url.toString(),
          finalUrl: res.url || url.toString(),
          httpStatus: res.status,
          loadMs,
          bytes: Buffer.byteLength(html, "utf8"),
          contentType,
          serverHeader: res.headers.get("server"),
        }),
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof Error && e.name === "AbortError") {
        throw new AppError({
          kind: "timeout",
          message: `The site did not respond within ${appConfig.audit.fetchTimeoutMs}ms.`,
          remedy:
            "A very slow site is itself a finding. Retry, or raise AUDIT_FETCH_TIMEOUT_MS.",
          retryable: true,
        });
      }
      throw toAppError(
        e,
        "The host could not be reached. Check the address, or the site may be offline.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
