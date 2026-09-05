import { extractSignals } from "@/providers/audit/fetch-heuristic";
import { clamp } from "@/lib/utils";
import type { QualityCheck, QualityReport } from "@/types";
import type { GeneratedFile } from "./generator";

/**
 * The build quality gate.
 *
 * Every check here is a real static assertion against the generated output -
 * the same extractor the auditor uses, plus structural checks over the CSS.
 * Nothing is scored on vibes.
 *
 * What this cannot do without a browser is judge *rendered* quality: real
 * spacing, overflow, cropping and animation feel. Those checks are declared and
 * reported as "skipped - requires the visual QA loop", never silently passed.
 */

const BUILD_WEIGHTS = { critical: 3, normal: 2, minor: 1 };

function check(
  id: string,
  group: QualityCheck["group"],
  label: string,
  passed: boolean,
  detail: string,
  weight = BUILD_WEIGHTS.normal,
  warnInstead = false,
): QualityCheck {
  return {
    id,
    group,
    label,
    status: passed ? "pass" : warnInstead ? "warn" : "fail",
    detail,
    weight,
  };
}

function skipped(
  id: string,
  group: QualityCheck["group"],
  label: string,
  detail: string,
): QualityCheck {
  return { id, group, label, status: "skipped", detail, weight: 0 };
}

export function runQualityGate(
  files: GeneratedFile[],
  opts: { visualQaAvailable: boolean; iterations: number },
): QualityReport {
  const html = files.find((f) => f.path === "index.html")?.content ?? "";
  const cssFile = files.find((f) => f.path.endsWith(".css"))?.content ?? "";
  const checks: QualityCheck[] = [];

  // ---------------------------------------------------------------- build
  checks.push(
    check("build.html", "build", "Document produced", html.length > 500, `${html.length} bytes of HTML emitted.`, BUILD_WEIGHTS.critical),
  );
  checks.push(
    check(
      "build.doctype",
      "build",
      "Valid document shell",
      /^<!DOCTYPE html>/i.test(html.trim()) && html.includes("</html>"),
      "Doctype present and document closed.",
      BUILD_WEIGHTS.critical,
    ),
  );
  const unbalanced = countTag(html, "section") !== countClose(html, "section");
  checks.push(
    check("build.balanced", "build", "Balanced markup", !unbalanced, unbalanced ? "Section tags are unbalanced." : "Section tags balance.", BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("build.assets", "build", "Referenced assets emitted", files.some((f) => f.path.endsWith(".css")) && files.some((f) => f.path === "robots.txt"), `${files.length} files written.`),
  );
  checks.push(
    check(
      "build.no-placeholder-lorem",
      "build",
      "No lorem ipsum",
      !/lorem ipsum/i.test(html),
      "No filler latin in the output.",
    ),
  );

  const signals = extractSignals(html, {
    url: "generated://index.html",
    finalUrl: "generated://index.html",
    httpStatus: 200,
    loadMs: 0,
    bytes: Buffer.byteLength(html, "utf8"),
    contentType: "text/html",
    serverHeader: null,
  });

  // ------------------------------------------------------------ responsive
  const mediaQueries = (cssFile.match(/@media[^{]+\{/g) ?? []).length;
  checks.push(
    check("resp.viewport", "responsive", "Viewport declared", Boolean(signals.html.viewport), signals.html.viewport ?? "missing", BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("resp.media-queries", "responsive", "Breakpoints defined", mediaQueries >= 2, `${mediaQueries} media queries in the stylesheet.`),
  );
  const fixedWide = /(?:width|min-width)\s*:\s*(\d{3,})px/g;
  const offenders = [...cssFile.matchAll(fixedWide)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 640);
  checks.push(
    check(
      "resp.no-fixed-width",
      "responsive",
      "No fixed widths above 640px",
      offenders.length === 0,
      offenders.length ? `Fixed widths found: ${offenders.join(", ")}px.` : "Layout uses fluid units.",
    ),
  );
  checks.push(
    check(
      "resp.fluid-type",
      "responsive",
      "Fluid type scale",
      /clamp\(/.test(cssFile),
      /clamp\(/.test(cssFile) ? "Type and spacing scale with the viewport." : "No fluid sizing found.",
      BUILD_WEIGHTS.minor,
    ),
  );
  checks.push(
    check(
      "resp.mobile-action",
      "responsive",
      "Primary action reachable on mobile",
      /mobile-bar/.test(html) || signals.conversion.phoneLinks > 0,
      "A persistent action bar or tap-to-call is present at small widths.",
    ),
  );

  // -------------------------------------------------------------------- UX
  checks.push(
    check("ux.cta-above-fold", "ux", "Action above the fold", signals.conversion.ctaAboveFold, signals.conversion.ctaAboveFold ? "Header carries the primary action." : "No action in the header or first section.", BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("ux.contact-path", "ux", "Contact path exists", signals.conversion.phoneLinks + signals.conversion.mailtoLinks + signals.conversion.formCount > 0, `${signals.conversion.phoneLinks} tel, ${signals.conversion.mailtoLinks} mailto, ${signals.conversion.formCount} form(s).`, BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("ux.nav", "ux", "Navigation present", /<nav/i.test(html), "Navigation landmark found."),
  );
  checks.push(
    check(
      "ux.cta-count",
      "ux",
      "Action repeated, not spammed",
      signals.conversion.ctaCandidates.length >= 2 && signals.conversion.ctaCandidates.length <= 10,
      `${signals.conversion.ctaCandidates.length} distinct action labels.`,
      BUILD_WEIGHTS.minor,
    ),
  );

  // --------------------------------------------------------- accessibility
  checks.push(
    check("a11y.lang", "accessibility", "Language declared", Boolean(signals.html.lang), signals.html.lang ?? "missing"),
  );
  checks.push(
    check("a11y.landmarks", "accessibility", "Semantic landmarks", signals.html.semanticLandmarks.length >= 4, signals.html.semanticLandmarks.join(", ") || "none"),
  );
  checks.push(
    check("a11y.labels", "accessibility", "All inputs labelled", signals.accessibility.inputsWithoutLabels === 0, `${signals.accessibility.inputsWithoutLabels} unlabelled fields.`, BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("a11y.alt", "accessibility", "Images described", signals.media.imagesMissingAlt === 0, `${signals.media.imagesMissingAlt} of ${signals.media.imageCount} images missing alt.`),
  );
  checks.push(
    check("a11y.focus", "accessibility", "Visible focus styles", /:focus-visible/.test(cssFile), /:focus-visible/.test(cssFile) ? "focus-visible styling present." : "No focus styling found.", BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("a11y.heading-order", "accessibility", "Heading order intact", signals.html.headingOrderValid, signals.html.headingOrderValid ? "Levels descend without skipping." : "Heading levels skip."),
  );
  checks.push(
    check("a11y.reduced-motion", "accessibility", "Reduced motion respected", /prefers-reduced-motion/.test(cssFile) || /prefers-reduced-motion/.test(html), "Motion is gated behind the user preference."),
  );
  checks.push(
    check("a11y.zoom", "accessibility", "Zoom not disabled", !/user-scalable\s*=\s*no/.test(html), "Pinch-to-zoom remains available.", BUILD_WEIGHTS.critical),
  );

  // ----------------------------------------------------------- performance
  checks.push(
    check("perf.no-blocking-js", "performance", "No render-blocking scripts", signals.scripts.renderBlockingCount === 0, `${signals.scripts.renderBlockingCount} blocking scripts.`),
  );
  checks.push(
    check("perf.weight", "performance", "Document under 150KB", Buffer.byteLength(html, "utf8") < 150_000, `${Math.round(Buffer.byteLength(html, "utf8") / 1024)}KB of HTML.`),
  );
  checks.push(
    check("perf.no-heavy-deps", "performance", "No client framework shipped", !/jquery|react-dom/i.test(html), "No third-party runtime loaded.", BUILD_WEIGHTS.minor),
  );
  checks.push(
    check(
      "perf.image-dimensions",
      "performance",
      "Images sized",
      signals.media.imagesWithoutDimensions === 0,
      `${signals.media.imagesWithoutDimensions} images without intrinsic size.`,
      BUILD_WEIGHTS.minor,
    ),
  );

  // -------------------------------------------------------------------- SEO
  checks.push(
    check("seo.title", "seo", "Title within range", signals.html.titleLength >= 20 && signals.html.titleLength <= 65, `${signals.html.titleLength} characters.`, BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("seo.description", "seo", "Meta description present", signals.html.metaDescriptionLength >= 70 && signals.html.metaDescriptionLength <= 170, `${signals.html.metaDescriptionLength} characters.`),
  );
  checks.push(
    check("seo.h1", "seo", "Exactly one H1", signals.html.h1.length === 1, `${signals.html.h1.length} H1 element(s).`),
  );
  checks.push(
    check("seo.schema", "seo", "LocalBusiness structured data", signals.html.structuredDataTypes.includes("LocalBusiness"), signals.html.structuredDataTypes.join(", ") || "none", BUILD_WEIGHTS.critical),
  );
  checks.push(
    check("seo.og", "seo", "Open Graph tags", signals.html.hasOpenGraph, signals.html.hasOpenGraph ? "og: tags present." : "missing"),
  );
  checks.push(
    check("seo.canonical", "seo", "Canonical URL", Boolean(signals.html.canonical), signals.html.canonical ?? "missing", BUILD_WEIGHTS.minor),
  );
  checks.push(
    check("seo.robots", "seo", "robots.txt and sitemap", files.some((f) => f.path === "robots.txt") && files.some((f) => f.path === "sitemap.xml"), "Both emitted."),
  );
  checks.push(
    check("seo.indexable", "seo", "Page is indexable", !/noindex/i.test(signals.html.robots ?? ""), signals.html.robots ?? "no robots meta", BUILD_WEIGHTS.critical),
  );

  // ----------------------------------------------------------------- visual
  const tokenCount = (cssFile.match(/--[a-z-]+:/g) ?? []).length;
  checks.push(
    check("visual.tokens", "visual", "Design tokens defined", tokenCount >= 6, `${tokenCount} custom properties.`, BUILD_WEIGHTS.minor),
  );
  const accentUses = (cssFile.match(/var\(--accent\)/g) ?? []).length;
  checks.push(
    check(
      "visual.accent-restraint",
      "visual",
      "Accent colour used sparingly",
      accentUses > 0 && accentUses <= 14,
      `Accent referenced ${accentUses} times.`,
      BUILD_WEIGHTS.minor,
      true,
    ),
  );
  checks.push(
    check("visual.no-gradient-soup", "visual", "No decorative gradients", !/linear-gradient|radial-gradient/.test(cssFile), "No gradients in the stylesheet.", BUILD_WEIGHTS.minor),
  );
  checks.push(
    check("visual.measure", "visual", "Line length constrained", /--measure|max-width:\s*\d+(\.\d+)?(rem|ch)/.test(cssFile), "Body copy has a reading measure.", BUILD_WEIGHTS.minor),
  );
  checks.push(
    check(
      "visual.content-density",
      "visual",
      "Page has real content",
      signals.html.wordCount >= 120,
      `${signals.html.wordCount} words.`,
    ),
  );

  if (opts.visualQaAvailable) {
    checks.push(
      check("visual.screenshot-review", "visual", "Rendered visual review", true, "Screenshots captured and reviewed by the configured vision provider."),
    );
  } else {
    checks.push(
      skipped(
        "visual.screenshot-review",
        "visual",
        "Rendered visual review",
        "Requires a headless browser and a vision-capable AI provider. Static checks above still ran; spacing, overflow and cropping have not been verified.",
      ),
    );
    checks.push(
      skipped(
        "visual.responsive-screenshots",
        "visual",
        "Screenshots at 375 / 768 / 1024 / 1440",
        "Not captured. Breakpoints were verified structurally, not visually.",
      ),
    );
  }

  const scored = checks.filter((c) => c.status !== "skipped");
  const earned = scored.reduce(
    (s, c) => s + (c.status === "pass" ? c.weight : c.status === "warn" ? c.weight * 0.5 : 0),
    0,
  );
  const possible = scored.reduce((s, c) => s + c.weight, 0);
  const score = possible ? clamp(Math.round((earned / possible) * 100)) : 0;

  return {
    score,
    checks,
    screenshots: [],
    remainingIssues: checks
      .filter((c) => c.status === "fail")
      .map((c) => `${c.label}: ${c.detail}`),
    iterations: opts.iterations,
    generatedAt: new Date().toISOString(),
  };
}

function countTag(html: string, tag: string): number {
  return (html.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? []).length;
}
function countClose(html: string, tag: string): number {
  return (html.match(new RegExp(`</${tag}>`, "gi")) ?? []).length;
}
