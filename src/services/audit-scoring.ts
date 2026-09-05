import { clamp } from "@/lib/utils";
import type { AuditScores, AuditSignals, FindingInput } from "@/types";

/**
 * Turns observed signals into scores and findings.
 *
 * Pure and deterministic: same signals in, same report out. Every deduction is
 * attached to a finding, so a score can always be explained by the list beneath
 * it - there is no hidden fudge factor.
 *
 * Scores are 0-100 where 100 means "nothing actionable found by this engine".
 * They are explicitly *not* a claim about visual design quality, which only the
 * visual review can judge.
 */

type Deduction = { points: number; finding: FindingInput };

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;

// ------------------------------------------------------------------ technical

function technical(s: AuditSignals): Deduction[] {
  const out: Deduction[] = [];

  if (!s.fetch.https) {
    out.push({
      points: 35,
      finding: {
        category: "technical",
        severity: "critical",
        title: "The site is served over plain HTTP",
        whatIsWrong: `The page resolved to ${s.fetch.finalUrl}, which is not encrypted.`,
        whyItMatters:
          "Browsers mark the site as “Not secure”, which visitors see before anything else. Any contact or booking form submitted here travels in the clear.",
        recommendation:
          "Install a TLS certificate and redirect all HTTP traffic to HTTPS permanently.",
        effort: "low",
        impact: "high",
        evidence: s.fetch.finalUrl,
      },
    });
  }

  if (!s.html.viewport) {
    out.push({
      points: 30,
      finding: {
        category: "technical",
        severity: "critical",
        title: "No mobile viewport is declared",
        whatIsWrong:
          "The document has no <meta name=\"viewport\"> tag, so mobile browsers render it at desktop width and scale it down.",
        whyItMatters:
          "Most local search happens on a phone. Text arrives roughly a third of its intended size and every tap target shrinks with it, so visitors pinch, zoom and leave.",
        recommendation:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1"> and rebuild the layout responsively.',
        effort: "medium",
        impact: "high",
      },
    });
  } else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(s.html.viewport)) {
    out.push({
      points: 8,
      finding: {
        category: "accessibility",
        severity: "medium",
        title: "Pinch-to-zoom is disabled",
        whatIsWrong: `The viewport is declared as "${s.html.viewport}".`,
        whyItMatters:
          "Visitors who need to enlarge text cannot. This is a WCAG failure and it disproportionately affects older customers.",
        recommendation: "Remove user-scalable=no and maximum-scale from the viewport tag.",
        effort: "low",
        impact: "medium",
        evidence: s.html.viewport,
      },
    });
  }

  if (!s.html.charset) {
    out.push({
      points: 5,
      finding: {
        category: "technical",
        severity: "low",
        title: "No character encoding declared",
        whatIsWrong: "The document declares no charset.",
        whyItMatters: "Names and prices with non-ASCII characters can render as mojibake.",
        recommendation: 'Add <meta charset="utf-8"> as the first element in <head>.',
        effort: "low",
        impact: "low",
      },
    });
  }

  if (s.scripts.jqueryDetected) {
    out.push({
      points: 6,
      finding: {
        category: "technical",
        severity: "medium",
        title: "Legacy jQuery-era front end",
        whatIsWrong: "jQuery is loaded, typically alongside a theme built for it.",
        whyItMatters:
          "It signals a codebase from a previous era: it adds weight before anything renders, and the surrounding theme is usually no longer receiving security updates.",
        recommendation:
          "Rebuild on a modern stack; the interactions in use here need no library at all.",
        effort: "high",
        impact: "medium",
      },
    });
  }

  const legacyPlatform = s.platform.detected.find((p) =>
    ["GoDaddy Website Builder", "Wix"].includes(p),
  );
  if (legacyPlatform) {
    out.push({
      points: 4,
      finding: {
        category: "technical",
        severity: "low",
        title: `Built on ${legacyPlatform}`,
        whatIsWrong: `Platform fingerprints for ${legacyPlatform} are present in the markup.`,
        whyItMatters:
          "Builder platforms cap performance and SEO control, and the monthly fee usually exceeds the running cost of a bespoke site.",
        recommendation: "Compare the current subscription against a one-off rebuild.",
        effort: "medium",
        impact: "low",
        evidence: s.platform.generator ?? legacyPlatform,
      },
    });
  }

  return out;
}

// --------------------------------------------------------------- performance

function performance(s: AuditSignals): Deduction[] {
  const out: Deduction[] = [];
  const lh = s.lighthouse;

  if (s.fetch.loadMs > 4000) {
    out.push({
      points: s.fetch.loadMs > 8000 ? 40 : 25,
      finding: {
        category: "performance",
        severity: s.fetch.loadMs > 8000 ? "critical" : "high",
        title: `The page took ${(s.fetch.loadMs / 1000).toFixed(1)}s to respond`,
        whatIsWrong: `Time to first byte plus document download measured ${s.fetch.loadMs}ms.`,
        whyItMatters:
          "On a phone this is the whole first impression. Abandonment climbs sharply past three seconds, and this is before images have started loading.",
        recommendation:
          "Move to a CDN-backed host, compress and resize images, and remove render-blocking scripts.",
        effort: "medium",
        impact: "high",
        evidence: `${s.fetch.loadMs}ms`,
      },
    });
  } else if (s.fetch.loadMs > 2000) {
    out.push({
      points: 10,
      finding: {
        category: "performance",
        severity: "medium",
        title: "Slow first response",
        whatIsWrong: `The document took ${s.fetch.loadMs}ms to arrive.`,
        whyItMatters: "It is not fatal, but it is the ceiling on every other metric.",
        recommendation: "Enable caching and compression at the host.",
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (s.scripts.renderBlockingCount > 2) {
    out.push({
      points: Math.min(18, s.scripts.renderBlockingCount * 3),
      finding: {
        category: "performance",
        severity: "high",
        title: `${s.scripts.renderBlockingCount} render-blocking scripts`,
        whatIsWrong:
          "Scripts in the document load without defer, async or type=module, so the browser stops parsing to fetch and run each one.",
        whyItMatters:
          "Nothing paints until they finish. On a mid-range Android over 4G this alone can cost several seconds of blank screen.",
        recommendation: "Defer non-critical scripts and drop the ones that are unused.",
        effort: "low",
        impact: "high",
        evidence: `${s.scripts.renderBlockingCount} of ${s.scripts.externalScriptCount} external scripts`,
      },
    });
  }

  if (s.media.legacyFormatImages >= 4) {
    out.push({
      points: Math.min(14, s.media.legacyFormatImages),
      finding: {
        category: "performance",
        severity: "medium",
        title: `${s.media.legacyFormatImages} images in legacy formats`,
        whatIsWrong: "JPEG/PNG/GIF assets are served with no modern format alternative.",
        whyItMatters:
          "WebP or AVIF typically cuts image weight by half or more, and images are almost always the heaviest part of a local business site.",
        recommendation: "Convert to WebP/AVIF and serve responsive sizes.",
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (s.media.imagesWithoutDimensions >= 3) {
    out.push({
      points: 8,
      finding: {
        category: "performance",
        severity: "medium",
        title: "Images have no intrinsic size",
        whatIsWrong: `${s.media.imagesWithoutDimensions} images declare neither width nor height.`,
        whyItMatters:
          "The page reflows as each image arrives. Visitors tap the wrong thing because the layout shifted under their thumb.",
        recommendation: "Set width and height (or aspect-ratio) on every image.",
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (lh?.lcpMs != null && lh.lcpMs > 2500) {
    out.push({
      points: lh.lcpMs > 4000 ? 20 : 10,
      finding: {
        category: "performance",
        severity: lh.lcpMs > 4000 ? "high" : "medium",
        title: `Largest Contentful Paint is ${(lh.lcpMs / 1000).toFixed(1)}s`,
        whatIsWrong: `Lighthouse measured LCP at ${lh.lcpMs}ms on mobile; the threshold for “good” is 2500ms.`,
        whyItMatters:
          "LCP is what the visitor experiences as “the page loaded”. It is also a ranking signal for local search.",
        recommendation: "Prioritise the hero image, preload it, and remove blocking resources.",
        effort: "medium",
        impact: "high",
        source: "lighthouse",
        evidence: lh.source,
      },
    });
  }

  if (lh?.cls != null && lh.cls > 0.1) {
    out.push({
      points: 8,
      finding: {
        category: "performance",
        severity: "medium",
        title: `Layout shifts during load (CLS ${lh.cls})`,
        whatIsWrong: `Cumulative Layout Shift measured ${lh.cls}; “good” is under 0.1.`,
        whyItMatters: "Content jumps as the page settles, causing mis-taps on mobile.",
        recommendation: "Reserve space for images, embeds and late-loading banners.",
        effort: "low",
        impact: "medium",
        source: "lighthouse",
      },
    });
  }

  return out;
}

// ---------------------------------------------------------------------- SEO

function seo(s: AuditSignals): Deduction[] {
  const out: Deduction[] = [];

  if (!s.html.title) {
    out.push({
      points: 30,
      finding: {
        category: "seo",
        severity: "critical",
        title: "The page has no title",
        whatIsWrong: "There is no <title> element.",
        whyItMatters:
          "The title is the clickable line in search results and the browser tab label. Without it the listing falls back to whatever Google can scrape.",
        recommendation:
          "Write a title of roughly 50-60 characters containing the business name, the service and the locality.",
        effort: "low",
        impact: "high",
      },
    });
  } else if (s.html.titleLength < 15 || s.html.titleLength > 65) {
    out.push({
      points: 8,
      finding: {
        category: "seo",
        severity: "medium",
        title:
          s.html.titleLength < 15 ? "The page title is too short" : "The page title is truncated in results",
        whatIsWrong: `The title is ${s.html.titleLength} characters: "${s.html.title}".`,
        whyItMatters:
          s.html.titleLength < 15
            ? "It carries no service or location keywords, so it competes for nothing."
            : "Google cuts titles around 60 characters, so the end of this one is never seen.",
        recommendation: "Rewrite to 50-60 characters, leading with the service and the locality.",
        effort: "low",
        impact: "medium",
        evidence: s.html.title,
      },
    });
  }

  if (!s.html.metaDescription) {
    out.push({
      points: 12,
      finding: {
        category: "seo",
        severity: "high",
        title: "No meta description",
        whatIsWrong: "The document declares no description.",
        whyItMatters:
          "Search engines then assemble a snippet from arbitrary page text, which rarely reads like an invitation to click.",
        recommendation:
          "Write a 140-160 character description that names the service, the area and the next step.",
        effort: "low",
        impact: "medium",
      },
    });
  } else if (s.html.metaDescriptionLength > 170) {
    out.push({
      points: 4,
      finding: {
        category: "seo",
        severity: "low",
        title: "Meta description is over-long",
        whatIsWrong: `The description is ${s.html.metaDescriptionLength} characters.`,
        whyItMatters: "It will be truncated mid-sentence in results.",
        recommendation: "Trim to about 155 characters.",
        effort: "low",
        impact: "low",
      },
    });
  }

  if (s.html.h1.length === 0) {
    out.push({
      points: 12,
      finding: {
        category: "seo",
        severity: "high",
        title: "No H1 heading",
        whatIsWrong: "The page contains no first-level heading.",
        whyItMatters:
          "The H1 states what the page is about to both search engines and screen readers. Without it the page has no declared subject.",
        recommendation: "Add exactly one H1 naming the service and the locality.",
        effort: "low",
        impact: "medium",
      },
    });
  } else if (s.html.h1.length > 1) {
    out.push({
      points: 5,
      finding: {
        category: "seo",
        severity: "low",
        title: `${s.html.h1.length} H1 headings on one page`,
        whatIsWrong: `Multiple H1s found: ${s.html.h1.slice(0, 3).map((h) => `"${h}"`).join(", ")}.`,
        whyItMatters: "The page's primary subject becomes ambiguous.",
        recommendation: "Keep one H1 and demote the rest to H2.",
        effort: "low",
        impact: "low",
      },
    });
  }

  if (!s.html.headingOrderValid) {
    out.push({
      points: 4,
      finding: {
        category: "accessibility",
        severity: "low",
        title: "Heading levels skip",
        whatIsWrong: "The heading sequence jumps a level (for example H2 straight to H4).",
        whyItMatters:
          "Screen-reader users navigate by heading level; skipped levels make the page structure read as incoherent.",
        recommendation: "Use heading levels in order and style them with CSS instead.",
        effort: "low",
        impact: "low",
      },
    });
  }

  if (!s.html.hasStructuredData) {
    out.push({
      points: 10,
      finding: {
        category: "seo",
        severity: "medium",
        title: "No LocalBusiness structured data",
        whatIsWrong: "The page publishes no schema.org markup.",
        whyItMatters:
          "Structured data is how opening hours, address, price range and ratings become eligible for rich results in local search.",
        recommendation:
          "Add LocalBusiness JSON-LD with address, geo, telephone, openingHours and sameAs links.",
        effort: "low",
        impact: "high",
      },
    });
  }

  if (!s.html.hasOpenGraph) {
    out.push({
      points: 5,
      finding: {
        category: "seo",
        severity: "low",
        title: "No Open Graph tags",
        whatIsWrong: "There are no og: meta tags.",
        whyItMatters:
          "Links shared on WhatsApp, Instagram or Facebook render as a bare URL with no image - a real cost for a business whose referrals travel by message.",
        recommendation: "Add og:title, og:description and a 1200x630 og:image.",
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (!s.html.canonical) {
    out.push({
      points: 3,
      finding: {
        category: "seo",
        severity: "low",
        title: "No canonical URL",
        whatIsWrong: "The page declares no canonical link.",
        whyItMatters: "Duplicate URLs (www, trailing slash, tracking parameters) compete with each other.",
        recommendation: "Emit a self-referencing canonical on every page.",
        effort: "low",
        impact: "low",
      },
    });
  }

  if (s.html.robots && /noindex/i.test(s.html.robots)) {
    out.push({
      points: 45,
      finding: {
        category: "seo",
        severity: "critical",
        title: "The page is marked noindex",
        whatIsWrong: `The robots meta tag is "${s.html.robots}".`,
        whyItMatters:
          "The site has explicitly asked search engines to exclude it. It cannot appear in results at all.",
        recommendation:
          "Remove noindex unless this is deliberate - it is usually a staging setting left in production.",
        effort: "low",
        impact: "high",
        evidence: s.html.robots,
      },
    });
  }

  if (s.html.wordCount < 150) {
    out.push({
      points: 10,
      finding: {
        category: "content",
        severity: "medium",
        title: "Very little page content",
        whatIsWrong: `The page contains roughly ${s.html.wordCount} words.`,
        whyItMatters:
          "There is not enough text to rank for anything specific, and not enough for a visitor to decide the business is right for them.",
        recommendation:
          "Write real service descriptions - what is done, who it suits, how long it takes, what it costs.",
        effort: "medium",
        impact: "high",
      },
    });
  }

  return out;
}

// ------------------------------------------------------------- accessibility

function accessibility(s: AuditSignals): Deduction[] {
  const out: Deduction[] = [];

  if (!s.html.lang) {
    out.push({
      points: 8,
      finding: {
        category: "accessibility",
        severity: "medium",
        title: "No language declared",
        whatIsWrong: "The <html> element has no lang attribute.",
        whyItMatters:
          "Screen readers pick a pronunciation from the page language. Without it, English is read with the wrong voice profile.",
        recommendation: 'Set <html lang="en"> (or the correct locale).',
        effort: "low",
        impact: "low",
      },
    });
  }

  if (s.media.imagesMissingAlt > 0) {
    const ratio = s.media.imageCount ? s.media.imagesMissingAlt / s.media.imageCount : 0;
    out.push({
      points: Math.min(20, Math.round(ratio * 25) + 4),
      finding: {
        category: "accessibility",
        severity: ratio > 0.5 ? "high" : "medium",
        title: `${s.media.imagesMissingAlt} of ${s.media.imageCount} images have no alt text`,
        whatIsWrong: "Images are missing the alt attribute entirely.",
        whyItMatters:
          "Screen-reader users hear the filename instead of the content, and search engines lose the only description of the image they have.",
        recommendation:
          'Describe what the image shows; use alt="" only for purely decorative graphics.',
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (s.accessibility.inputsWithoutLabels > 0) {
    out.push({
      points: Math.min(18, s.accessibility.inputsWithoutLabels * 5),
      finding: {
        category: "accessibility",
        severity: "high",
        title: `${s.accessibility.inputsWithoutLabels} form fields have no label`,
        whatIsWrong:
          "Inputs rely on placeholder text alone, with no <label>, aria-label or aria-labelledby.",
        whyItMatters:
          "The placeholder disappears the moment typing starts, so anyone interrupted mid-form loses the field's meaning - and screen readers announce nothing at all.",
        recommendation: "Attach a visible <label for=...> to every field.",
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (s.accessibility.linksWithoutText > 2) {
    out.push({
      points: 8,
      finding: {
        category: "accessibility",
        severity: "medium",
        title: `${s.accessibility.linksWithoutText} links have no accessible name`,
        whatIsWrong: "Links contain only an image or icon with no text, alt or aria-label.",
        whyItMatters: 'They are announced as "link" with no destination.',
        recommendation: "Give each link visible text or an aria-label.",
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (s.html.semanticLandmarks.length < 3) {
    out.push({
      points: 6,
      finding: {
        category: "accessibility",
        severity: "medium",
        title: "No semantic page structure",
        whatIsWrong: `Only ${s.html.semanticLandmarks.length || "no"} landmark element(s) found${
          s.html.semanticLandmarks.length ? ` (${s.html.semanticLandmarks.join(", ")})` : ""
        }; the layout is built from generic containers.`,
        whyItMatters:
          "Assistive technology has no way to skip to the main content or the navigation, and the markup carries no meaning for search engines either.",
        recommendation: "Use header, nav, main and footer to structure the page.",
        effort: "medium",
        impact: "medium",
      },
    });
  }

  if (s.accessibility.tabindexPositive > 0) {
    out.push({
      points: 4,
      finding: {
        category: "accessibility",
        severity: "low",
        title: "Positive tabindex values override focus order",
        whatIsWrong: `${s.accessibility.tabindexPositive} elements use tabindex greater than zero.`,
        whyItMatters: "Keyboard focus jumps around the page in an order that does not match the layout.",
        recommendation: "Use tabindex=0 or none at all and rely on DOM order.",
        effort: "low",
        impact: "low",
      },
    });
  }

  return out;
}

// ----------------------------------------------------------------------- UX

function ux(s: AuditSignals): Deduction[] {
  const out: Deduction[] = [];
  const c = s.conversion;

  const hasAnyContactPath =
    c.phoneLinks > 0 || c.mailtoLinks > 0 || c.whatsappLinks > 0 || c.formCount > 0;

  if (!hasAnyContactPath) {
    out.push({
      points: 40,
      finding: {
        category: "ux",
        severity: "critical",
        title: "There is no way to make contact from this page",
        whatIsWrong:
          "The page contains no tel: link, no mailto: link, no WhatsApp link and no form.",
        whyItMatters:
          "Every visitor who decides to get in touch has to leave the site and search for the number elsewhere. Most will not.",
        recommendation:
          "Put a tap-to-call link in the header and a short enquiry form above the fold.",
        effort: "low",
        impact: "high",
      },
    });
  } else if (c.phoneLinks === 0) {
    out.push({
      points: 14,
      finding: {
        category: "ux",
        severity: "high",
        title: "The phone number is not tap-to-call",
        whatIsWrong: "No tel: link appears anywhere on the page.",
        whyItMatters:
          "On a phone the number has to be memorised or copied by hand. For a local service business the call is the conversion.",
        recommendation: 'Wrap every phone number in <a href="tel:...">.',
        effort: "low",
        impact: "high",
      },
    });
  }

  if (!c.ctaAboveFold) {
    out.push({
      points: 16,
      finding: {
        category: "ux",
        severity: "high",
        title: "No call to action near the top of the page",
        whatIsWrong:
          "Neither the header nor the first section contains a booking, calling or enquiry action.",
        whyItMatters:
          "Visitors arriving from search already know what they want. Making them scroll past an introduction to find the next step loses the ones in a hurry - which on mobile is most of them.",
        recommendation:
          "Place the primary action in the header and repeat it at the end of each section.",
        effort: "low",
        impact: "high",
      },
    });
  }

  if (c.ctaCandidates.length === 0) {
    out.push({
      points: 12,
      finding: {
        category: "ux",
        severity: "high",
        title: "No recognisable call to action anywhere",
        whatIsWrong: "No link or button on the page uses action language.",
        whyItMatters: "The page describes the business but never asks for anything.",
        recommendation:
          "Add one primary action, phrased as the thing the visitor wants, not as “Submit”.",
        effort: "low",
        impact: "high",
      },
    });
  }

  if (c.bookingKeywords.length === 0 && c.formCount === 0) {
    out.push({
      points: 8,
      finding: {
        category: "ux",
        severity: "medium",
        title: "No booking or enquiry path",
        whatIsWrong: "The page mentions no booking, appointment or enquiry mechanism.",
        whyItMatters:
          "Visitors who prefer not to phone - which increasingly means anyone under forty - have no route at all.",
        recommendation: "Add online booking, or at minimum a short callback request form.",
        effort: "medium",
        impact: "high",
      },
    });
  }

  if (c.mapLinks === 0) {
    out.push({
      points: 5,
      finding: {
        category: "ux",
        severity: "low",
        title: "No directions link",
        whatIsWrong: "The page does not link to a map.",
        whyItMatters: "For a walk-in business, “how do I get there” is a top-three question.",
        recommendation: "Link the address to Google Maps and state nearby landmarks and parking.",
        effort: "low",
        impact: "medium",
      },
    });
  }

  if (c.socialLinks.length === 0) {
    out.push({
      points: 4,
      finding: {
        category: "ux",
        severity: "low",
        title: "No social profiles linked",
        whatIsWrong: "The page links to no social account.",
        whyItMatters:
          "Recent posts are how a visitor checks the business is still active. Their absence reads as abandonment.",
        recommendation: "Link the active profiles, and only the active ones.",
        effort: "low",
        impact: "low",
      },
    });
  }

  if (s.html.wordCount > 120 && !s.html.viewport) {
    out.push({
      points: 10,
      finding: {
        category: "ux",
        severity: "high",
        title: "Desktop-only layout on a content-heavy page",
        whatIsWrong:
          "A fixed-width layout carries a substantial amount of text with no responsive behaviour.",
        whyItMatters:
          "Body text arrives at roughly a third of its intended size on a phone, and every line requires horizontal scrolling to read.",
        recommendation: "Rebuild the layout mobile-first.",
        effort: "high",
        impact: "high",
      },
    });
  }

  return out;
}

// ------------------------------------------------------------------ assembly

function scoreFrom(deductions: Deduction[]): number {
  return clamp(100 - deductions.reduce((sum, d) => sum + d.points, 0));
}

export function interpretAudit(signals: AuditSignals): {
  scores: AuditScores;
  findings: FindingInput[];
} {
  const tech = technical(signals);
  const perf = performance(signals);
  const seoD = seo(signals);
  const a11y = accessibility(signals);
  const uxD = ux(signals);

  const lh = signals.lighthouse;

  // Where Lighthouse ran, trust it for the categories it measures directly and
  // blend our own deductions in as a secondary signal.
  const blend = (own: number, measured: number | null | undefined) =>
    measured == null ? own : Math.round(measured * 0.7 + own * 0.3);

  const scores: AuditScores = {
    performance: blend(scoreFrom(perf), lh?.performance),
    accessibility: blend(scoreFrom(a11y), lh?.accessibility),
    bestPractices: blend(scoreFrom(tech), lh?.bestPractices),
    seo: blend(scoreFrom(seoD), lh?.seo),
    ux: scoreFrom(uxD),
    technical: scoreFrom(tech),
    overall: 0,
  };

  // UX is weighted heaviest: for a local business the site exists to produce
  // enquiries, and a fast, accessible page that never asks for the booking is
  // worth less than a plain one that does.
  scores.overall = clamp(
    Math.round(
      scores.ux * 0.3 +
        scores.seo * 0.2 +
        scores.performance * 0.2 +
        scores.technical * 0.15 +
        scores.accessibility * 0.15,
    ),
  );

  const findings = [...tech, ...perf, ...seoD, ...a11y, ...uxD]
    .map((d) => ({ ...d.finding, source: d.finding.source ?? ("heuristic" as const) }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.category.localeCompare(b.category),
    );

  return { scores, findings };
}

/** Scores used when a business has no website at all. */
export const NO_WEBSITE_SCORES: AuditScores = {
  performance: 0,
  accessibility: 0,
  bestPractices: 0,
  seo: 0,
  ux: 0,
  technical: 0,
  overall: 0,
};

export function noWebsiteFindings(businessName: string): FindingInput[] {
  return [
    {
      category: "ux",
      severity: "critical",
      title: "The business has no website",
      whatIsWrong: `No website address is on record for ${businessName}.`,
      whyItMatters:
        "Every search for this business ends at a third-party listing the owner does not control. There is no place to explain services, publish prices, or take a booking, and no asset that compounds over time.",
      recommendation:
        "Build a focused site: services, proof, location and one obvious way to get in touch.",
      effort: "medium",
      impact: "high",
      source: "heuristic",
    },
    {
      category: "seo",
      severity: "critical",
      title: "No presence in organic search",
      whatIsWrong: "With no site there is nothing to rank beyond the map listing.",
      whyItMatters:
        "Competitors with even a modest site capture the searches that happen before anyone opens Maps.",
      recommendation:
        "Publish service pages targeting the locality, and add LocalBusiness structured data.",
      effort: "medium",
      impact: "high",
      source: "heuristic",
    },
  ];
}
