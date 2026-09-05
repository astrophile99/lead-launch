import { describe, expect, it } from "vitest";
import { dedupeKey, hostOf, normalisePhone, normaliseUrl, seededRandom, slugify } from "@/lib/utils";
import { extractJson, fromJson } from "@/lib/json";
import { assertSafePublicUrl, isReservedExampleHost } from "@/lib/safe-url";
import { AppError } from "@/lib/errors";
import { extractSignals } from "@/providers/audit/fetch-heuristic";
import { interpretAudit, noWebsiteFindings } from "@/services/audit-scoring";
import { scoreOpportunity, type ScoringInput } from "@/services/scoring";
import { DEFAULT_SCORING_WEIGHTS, SCORING_FACTORS } from "@/config/scoring";
import { suggestNextAction, type ProspectState } from "@/services/tasks";
import { MockBusinessDataProvider } from "@/providers/business-data/mock";
import { MockAIProvider } from "@/providers/ai/mock";
import { runQualityGate } from "@/agents/website-builder/quality-gate";
import { generateSite } from "@/agents/website-builder/generator";
import { resolveIndustry } from "@/config/industries";
import type { AuditSignals, WebsiteBrief } from "@/types";

/* --------------------------------------------------------------------- utils */

describe("identity and de-duplication", () => {
  it("prefers phone, then domain, then name+city", () => {
    expect(dedupeKey({ name: "A", city: "Mumbai", phone: "+91 98765 43210" })).toBe("tel:9876543210");
    expect(dedupeKey({ name: "A", city: "Mumbai", website: "https://www.foo.com/x" })).toBe("web:foo.com");
    expect(dedupeKey({ name: "Dr. Rao Dental", city: "Pune" })).toBe("nm:dr-rao-dental|pune");
  });

  it("treats formatting differences in a phone number as the same business", () => {
    const a = dedupeKey({ name: "Clinic A", city: "Mumbai", phone: "+91 98765 43210" });
    const b = dedupeKey({ name: "Clinic A (Bandra)", city: "Mumbai", phone: "098765-43210" });
    expect(a).toBe(b);
  });

  it("rejects phone numbers that are too short to identify anything", () => {
    expect(normalisePhone("1234")).toBeNull();
  });

  it("normalises URLs and rejects non-web schemes", () => {
    expect(normaliseUrl("example.com")).toBe("https://example.com/");
    expect(normaliseUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseUrl("not a url")).toBeNull();
    expect(hostOf("https://WWW.Example.COM/path")).toBe("example.com");
  });

  it("slugifies to a filesystem-safe form", () => {
    expect(slugify("Dr. Kapoor's Dental Studio")).toBe("dr-kapoor-s-dental-studio");
  });

  it("produces a stable sequence for the same seed", () => {
    const a = Array.from({ length: 5 }, seededRandom("x"));
    const b = Array.from({ length: 5 }, seededRandom("x"));
    expect(a).toEqual(b);
  });
});

describe("json helpers", () => {
  it("never throws on malformed input", () => {
    expect(fromJson("{oops", { a: 1 })).toEqual({ a: 1 });
    expect(fromJson(null, [])).toEqual([]);
  });

  it("extracts JSON from a fenced or chatty model response", () => {
    expect(extractJson<{ a: number }>('here you go:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson<{ a: string }>('{"a":"has } brace"} trailing')).toEqual({ a: "has } brace" });
    expect(extractJson("no json at all")).toBeNull();
  });
});

/* ------------------------------------------------------------------- ssrf */

describe("SSRF guard", () => {
  it("accepts ordinary public URLs", () => {
    expect(assertSafePublicUrl("https://example.org/x").hostname).toBe("example.org");
  });

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://192.168.0.1/",
    "http://172.16.5.5/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://printer.local/",
  ])("refuses %s", (url) => {
    expect(() => assertSafePublicUrl(url)).toThrow(AppError);
  });

  it("refuses embedded credentials and non-http schemes", () => {
    expect(() => assertSafePublicUrl("https://user:pass@example.com")).toThrow(AppError);
    expect(() => assertSafePublicUrl("ftp://example.com")).toThrow(AppError);
  });

  it("recognises reserved demo hostnames", () => {
    expect(isReservedExampleHost("foo.example")).toBe(true);
    expect(isReservedExampleHost("foo.com")).toBe(false);
  });
});

/* ------------------------------------------------------------------ audit */

const GOOD_PAGE = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bandra Dental Centre — Book an appointment</title>
<meta name="description" content="Bandra Dental Centre offers implants, orthodontics and hygiene appointments with published pricing. Book online in under a minute.">
<link rel="canonical" href="https://x.test/"><link rel="icon" href="/f.svg">
<meta property="og:title" content="Bandra Dental Centre">
<script type="application/ld+json">{"@type":"LocalBusiness","name":"X"}</script>
</head><body>
<header><nav><a href="/">Home</a></nav><a href="tel:+912200000000">Call</a><a href="/book">Book appointment</a></header>
<main><h1>Bandra Dental Centre</h1><h2>Services</h2>
<p>${"Careful dentistry with prices published up front and same-week appointments. ".repeat(6)}</p>
<img src="a.webp" alt="Reception" width="800" height="600">
<form><label for="n">Name</label><input id="n" type="text"><button type="submit">Request a slot</button></form>
<a href="https://maps.google.com/?q=x">Directions</a><a href="https://instagram.com/x">Instagram</a>
</main><footer><p>&copy; 2026</p></footer></body></html>`;

const BAD_PAGE = `<html><head><title>Home</title>
<script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></head>
<body><table><tr><td><font size="5">Welcome</font>
<img src="a.jpg"><img src="b.jpg"><img src="c.png"><img src="d.gif">
<p>We are a trusted name.</p></td></tr></table></body></html>`;

function signalsFor(html: string, loadMs = 500, https = true): AuditSignals {
  return extractSignals(html, {
    url: https ? "https://x.test/" : "http://x.test/",
    finalUrl: https ? "https://x.test/" : "http://x.test/",
    httpStatus: 200,
    loadMs,
    bytes: Buffer.byteLength(html),
    contentType: "text/html",
    serverHeader: null,
  });
}

describe("audit signal extraction", () => {
  it("reads the document, conversion and accessibility signals of a good page", () => {
    const s = signalsFor(GOOD_PAGE);
    expect(s.html.title).toContain("Bandra Dental Centre");
    expect(s.html.viewport).toBe("width=device-width, initial-scale=1");
    expect(s.html.h1).toEqual(["Bandra Dental Centre"]);
    expect(s.html.structuredDataTypes).toContain("LocalBusiness");
    expect(s.html.hasOpenGraph).toBe(true);
    expect(s.conversion.phoneLinks).toBe(1);
    expect(s.conversion.mapLinks).toBe(1);
    expect(s.conversion.formCount).toBe(1);
    expect(s.conversion.ctaAboveFold).toBe(true);
    expect(s.accessibility.inputsWithoutLabels).toBe(0);
    expect(s.media.imagesMissingAlt).toBe(0);
    expect(s.scripts.renderBlockingCount).toBe(0);
  });

  it("reads the absences on a legacy page", () => {
    const s = signalsFor(BAD_PAGE, 6000);
    expect(s.html.viewport).toBeNull();
    expect(s.html.metaDescription).toBeNull();
    expect(s.html.h1).toEqual([]);
    expect(s.html.hasStructuredData).toBe(false);
    expect(s.conversion.phoneLinks).toBe(0);
    expect(s.conversion.ctaAboveFold).toBe(false);
    expect(s.media.imagesMissingAlt).toBe(4);
    expect(s.media.legacyFormatImages).toBe(4);
    expect(s.scripts.renderBlockingCount).toBe(3);
  });

  it("counts alt=\"\" as a deliberate decorative choice, not a missing alt", () => {
    const s = signalsFor(`<html><body><img src="a.png" alt=""><img src="b.png"></body></html>`);
    expect(s.media.imagesMissingAlt).toBe(1);
  });
});

describe("audit interpretation", () => {
  it("scores a well-built page highly and finds little to say", () => {
    const { scores, findings } = interpretAudit(signalsFor(GOOD_PAGE));
    expect(scores.overall).toBeGreaterThan(80);
    expect(scores.ux).toBeGreaterThan(80);
    expect(findings.filter((f) => f.severity === "critical")).toHaveLength(0);
  });

  it("scores a legacy page poorly and explains every deduction", () => {
    const { scores, findings } = interpretAudit(signalsFor(BAD_PAGE, 9000));
    expect(scores.overall).toBeLessThan(45);
    expect(findings.length).toBeGreaterThan(8);
    for (const f of findings) {
      expect(f.whatIsWrong.length).toBeGreaterThan(10);
      expect(f.whyItMatters.length).toBeGreaterThan(10);
      expect(f.recommendation.length).toBeGreaterThan(10);
    }
    expect(findings.some((f) => /viewport/i.test(f.title))).toBe(true);
    expect(findings.some((f) => /contact/i.test(f.title))).toBe(true);
  });

  it("treats plain HTTP as critical", () => {
    const { findings } = interpretAudit(signalsFor(GOOD_PAGE, 500, false));
    expect(findings.some((f) => f.severity === "critical" && /HTTP/.test(f.title))).toBe(true);
  });

  it("trusts Lighthouse for the categories it measures", () => {
    const base = signalsFor(BAD_PAGE, 9000);
    const withLh: AuditSignals = {
      ...base,
      lighthouse: {
        performance: 90,
        accessibility: 95,
        bestPractices: 90,
        seo: 92,
        lcpMs: 1200,
        cls: 0.02,
        tbtMs: 40,
        source: "test",
      },
    };
    const plain = interpretAudit(base);
    const blended = interpretAudit(withLh);
    expect(blended.scores.performance).toBeGreaterThan(plain.scores.performance);
  });

  it("produces grounded findings when there is no website at all", () => {
    const findings = noWebsiteFindings("Acme Dental");
    expect(findings).toHaveLength(2);
    expect(findings[0].whatIsWrong).toContain("Acme Dental");
  });
});

/* ---------------------------------------------------------------- scoring */

function scoringInput(over: Partial<ScoringInput["business"]> = {}, audit: ScoringInput["audit"] = null): ScoringInput {
  return {
    business: {
      name: "Test Clinic",
      category: "Dental",
      rating: 4.6,
      reviewCount: 240,
      website: "https://x.test/",
      email: "a@x.test",
      phone: "+91 98765 43210",
      instagram: null,
      facebook: null,
      linkedin: null,
      services: ["Implants", "Braces"],
      ...over,
    },
    audit,
  };
}

const WEAK_AUDIT: NonNullable<ScoringInput["audit"]> = {
  scores: { performance: 20, accessibility: 30, bestPractices: 25, seo: 30, ux: 20, technical: 25, overall: 25 },
  findingCounts: { critical: 3, high: 4, medium: 2, low: 1, info: 0 },
  hasBookingPath: false,
  hasCtaAboveFold: false,
  isMock: false,
};

describe("opportunity scoring", () => {
  it("explains every factor it uses", () => {
    const r = scoreOpportunity(scoringInput({}, WEAK_AUDIT));
    for (const f of SCORING_FACTORS) {
      expect(r.breakdown[f].note.length).toBeGreaterThan(5);
      expect(r.breakdown[f].weight).toBeGreaterThan(0);
    }
    expect(r.reasons.length).toBeGreaterThanOrEqual(SCORING_FACTORS.length);
  });

  it("ranks a strong business with a weak site above one with a good site", () => {
    const weak = scoreOpportunity(scoringInput({}, WEAK_AUDIT));
    const strong = scoreOpportunity(
      scoringInput({}, {
        ...WEAK_AUDIT,
        scores: { performance: 92, accessibility: 95, bestPractices: 90, seo: 90, ux: 88, technical: 90, overall: 90 },
        findingCounts: { critical: 0, high: 0, medium: 1, low: 2, info: 0 },
        hasBookingPath: true,
        hasCtaAboveFold: true,
      }),
    );
    expect(weak.score).toBeGreaterThan(strong.score);
  });

  it("gives an unwebsited, well-reviewed business the maximum website-weakness score", () => {
    const r = scoreOpportunity(scoringInput({ website: null }));
    expect(r.breakdown.websiteWeakness.raw).toBe(100);
    expect(r.labels).toContain("No website / established business");
  });

  it("does not call a high scorer immediate when nobody can be reached", () => {
    const r = scoreOpportunity(
      scoringInput({ email: null, phone: null, instagram: null, facebook: null, linkedin: null }, WEAK_AUDIT),
    );
    expect(r.contactability).toBe(0);
    expect(r.tier).not.toBe("immediate");
  });

  it("normalises weights that do not sum to one", () => {
    const doubled = Object.fromEntries(
      SCORING_FACTORS.map((f) => [f, DEFAULT_SCORING_WEIGHTS[f] * 2]),
    ) as typeof DEFAULT_SCORING_WEIGHTS;
    const a = scoreOpportunity(scoringInput({}, WEAK_AUDIT), DEFAULT_SCORING_WEIGHTS);
    const b = scoreOpportunity(scoringInput({}, WEAK_AUDIT), doubled);
    expect(b.score).toBe(a.score);
  });

  it("flags mock audits in the reasoning", () => {
    const r = scoreOpportunity(scoringInput({}, { ...WEAK_AUDIT, isMock: true }));
    expect(r.reasons[0].text).toMatch(/demo data/i);
  });

  it("stays within 0-100 for any input", () => {
    const r = scoreOpportunity(
      scoringInput({ rating: 5, reviewCount: 100_000 }, { ...WEAK_AUDIT, findingCounts: { critical: 99, high: 99, medium: 0, low: 0, info: 0 } }),
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

/* ------------------------------------------------------------------ tasks */

describe("next action engine", () => {
  const base: ProspectState = {
    id: "p1",
    stage: "discovered",
    hasWebsite: true,
    hasAudit: false,
    hasOpportunity: false,
    hasBrief: false,
    hasReadyWebsite: false,
    hasDraftMessage: false,
    hasApprovedMessage: false,
    hasSentMessage: false,
    lastContactAt: null,
  };

  it("always starts with the audit", () => {
    expect(suggestNextAction(base).title).toMatch(/audit/i);
  });

  it("prioritises an unapproved draft over anything else", () => {
    expect(
      suggestNextAction({ ...base, hasAudit: true, hasOpportunity: true, hasDraftMessage: true }).title,
    ).toMatch(/approve/i);
  });

  it("asks to send once a message is approved", () => {
    expect(
      suggestNextAction({
        ...base,
        hasAudit: true,
        hasOpportunity: true,
        hasBrief: true,
        hasReadyWebsite: true,
        hasDraftMessage: true,
        hasApprovedMessage: true,
      }).title,
    ).toMatch(/send/i);
  });
});

/* ------------------------------------------------- mock discovery provider */

describe("mock discovery provider", () => {
  const provider = new MockBusinessDataProvider();
  const query = {
    category: "Dental",
    country: "India",
    city: "Mumbai",
    area: "Bandra",
    limit: 10,
    minRating: null,
    minReviews: null,
    websiteFilter: "any" as const,
    keywords: null,
  };

  it("is deterministic for the same query", async () => {
    const a = await provider.search(query);
    const b = await provider.search(query);
    expect(a.records.map((r) => r.name)).toEqual(b.records.map((r) => r.name));
  });

  it("labels itself as mock", async () => {
    const res = await provider.search(query);
    expect(res.isMock).toBe(true);
    expect(res.providerId).toBe("mock");
  });

  it("honours the rating floor", async () => {
    const res = await provider.search({ ...query, minRating: 4.5 });
    expect(res.records.length).toBeGreaterThan(0);
    for (const r of res.records) expect(r.rating).toBeGreaterThanOrEqual(4.5);
  });

  it("honours the review floor", async () => {
    const res = await provider.search({ ...query, minReviews: 100 });
    for (const r of res.records) expect(r.reviewCount).toBeGreaterThanOrEqual(100);
  });

  it("returns only businesses without a site when asked", async () => {
    const res = await provider.search({ ...query, websiteFilter: "none" });
    expect(res.records.length).toBeGreaterThan(0);
    for (const r of res.records) expect(r.website).toBeNull();
  });

  it("uses reserved hostnames so nothing can hit a real site", async () => {
    const res = await provider.search(query);
    for (const r of res.records) {
      if (r.website) expect(new URL(r.website).hostname.endsWith(".example")).toBe(true);
    }
  });

  it("pages without repeating records", async () => {
    // Display names can legitimately collide (common surnames, chain branches);
    // identity is the external id, which is what de-duplication keys on.
    const first = await provider.search({ ...query, limit: 5 });
    const second = await provider.search({ ...query, limit: 5, cursor: first.nextCursor });
    expect(first.records).toHaveLength(5);
    expect(second.records).toHaveLength(5);
    const overlap = first.records.filter((r) =>
      second.records.some((s) => s.externalId === r.externalId),
    );
    expect(overlap).toHaveLength(0);
  });

  it("gives every record on a page a distinct identity", async () => {
    const res = await provider.search({ ...query, limit: 20 });
    const ids = new Set(res.records.map((r) => r.externalId));
    expect(ids.size).toBe(res.records.length);
  });
});

/* ------------------------------------------------------------ mock AI provider */

describe("deterministic AI composer", () => {
  const provider = new MockAIProvider();

  it("only ever uses facts it was given", async () => {
    const res = await provider.complete("mock-deterministic", {
      capability: "analysis",
      system: "",
      messages: [
        {
          role: "user",
          content: `<facts>${JSON.stringify({
            businessName: "Nimbus Dental",
            rating: 4.7,
            reviewCount: 312,
            website: "https://nimbus.example/",
            topFindings: ["The phone number is not tappable"],
          })}</facts>`,
        },
      ],
    });
    const parsed = JSON.parse(res.text);
    expect(res.isMock).toBe(true);
    expect(parsed.whyThisLead).toContain("Nimbus Dental");
    expect(parsed.whyThisLead).toContain("312");
    expect(parsed.groundedIn.join(" ")).toContain("nimbus.example");
  });

  it("refuses to fake code generation rather than emitting plausible code", async () => {
    const res = await provider.complete("mock-deterministic", {
      capability: "codeGeneration",
      system: "",
      messages: [{ role: "user", content: "build a site" }],
    });
    expect(JSON.parse(res.text).error).toBe("not-available");
  });

  it("survives a prompt with no facts block", async () => {
    const res = await provider.complete("mock-deterministic", {
      capability: "summarization",
      system: "",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(() => JSON.parse(res.text)).not.toThrow();
  });
});

/* ---------------------------------------------------- generator + quality gate */

const BRIEF: WebsiteBrief = {
  positioning: "Nimbus Dental: an established dental practice in Bandra.",
  targetAudience: "People searching for a dentist near Bandra.",
  primaryGoal: "Book an appointment",
  secondaryGoals: ["Call the clinic"],
  brandPersonality: ["Direct"],
  colorDirection: "One accent",
  typographyDirection: "One family",
  designStyle: "Editorial",
  pages: [{ name: "Home", purpose: "Convert", sections: ["Hero"] }],
  ctaStrategy: "Header and per section",
  trustElements: ["Reviews"],
  socialProof: "4.7 stars across 312 reviews.",
  contentStrategy: "Real service copy",
  seoStrategy: "Locality plus service",
  animationDirection: "Restrained",
  mobileStrategy: "375 first",
  requiresClientInput: ["Current pricing"],
  generatedBy: "test",
};

const BUSINESS = {
  name: "Nimbus Dental",
  category: "Dental",
  subcategory: null,
  description: "Dental practice in Bandra.",
  address: "12 Hill Road, Bandra, Mumbai",
  city: "Mumbai",
  area: "Bandra",
  country: "India",
  lat: 19.05,
  lng: 72.83,
  phone: "+91 98765 43210",
  email: "hello@nimbus.example",
  website: "https://nimbus.example/",
  googleUrl: "https://maps.google.com/?q=nimbus",
  instagram: "https://instagram.com/nimbus",
  facebook: null,
  linkedin: null,
  rating: 4.7,
  reviewCount: 312,
  hours: { Monday: "09:30 – 19:00" },
  services: ["Implants", "Braces"],
  images: [],
  logoUrl: null,
};

describe("site generator", () => {
  const files = generateSite({ business: BUSINESS, brief: BRIEF, watermark: true });
  const html = files.find((f) => f.path === "index.html")!.content;

  it("emits a complete static project", () => {
    expect(files.map((f) => f.path).sort()).toEqual(
      ["favicon.svg", "index.html", "robots.txt", "sitemap.xml", "styles.css"],
    );
  });

  it("never invents facts it was not given", () => {
    expect(html).not.toMatch(/award|certified|voted|#1|best in/i);
    // Unknowns are rendered as visible markers instead of filler copy.
    expect(html).toContain("class=\"todo\"");
    expect(html).toContain("review 1 — paste a real review, verbatim");
  });

  it("uses only the real contact details on record", () => {
    expect(html).toContain("tel:+919876543210");
    expect(html).toContain("hello@nimbus.example");
    expect(html).toContain("12 Hill Road, Bandra, Mumbai");
  });

  it("escapes business data into the document", () => {
    const risky = generateSite({
      business: { ...BUSINESS, name: 'Evil <script>alert("x")</script>' },
      brief: BRIEF,
      watermark: false,
    }).find((f) => f.path === "index.html")!.content;
    expect(risky).not.toContain("<script>alert");
    expect(risky).toContain("&lt;script&gt;");
  });

  it("references assets relatively so it works under the preview route and at a domain root", () => {
    expect(html).toContain('href="styles.css"');
    expect(html).toContain('href="favicon.svg"');
    expect(html).not.toContain('href="/styles.css"');
  });

  it("does not advertise an Open Graph image it never generates", () => {
    expect(html).not.toContain("og:image");
  });

  it("emits valid definition lists", () => {
    // <dl> children must be div/dt/dd - never <li>.
    const dlBlocks = html.match(/<dl[\s\S]*?<\/dl>/g) ?? [];
    expect(dlBlocks.length).toBeGreaterThan(0);
    for (const block of dlBlocks) expect(block).not.toContain("<li");
  });

  it("renders fully without JavaScript", () => {
    // Reveal animation is opt-in via a class the script adds, so a sandboxed
    // preview or a no-JS visitor still sees every section.
    const css = files.find((f) => f.path === "styles.css")!.content;
    expect(css).toContain(".js .reveal{opacity:0");
    expect(css).not.toMatch(/(?<!\.js )\.reveal\{opacity:0/);
  });

  it("leads with the business name, not a strategy sentence", () => {
    expect(html).toContain("<h1>Nimbus Dental</h1>");
  });

  it("chooses a palette from the industry", () => {
    const css = files.find((f) => f.path === "styles.css")!.content;
    const dental = resolveIndustry("Dental");
    expect(dental.id).toBe("dental");
    expect(css).toContain("--accent:");
  });
});

describe("build quality gate", () => {
  const files = generateSite({ business: BUSINESS, brief: BRIEF, watermark: true });

  it("passes the generated site on the checks it can actually make", () => {
    const report = runQualityGate(files, { visualQaAvailable: false, iterations: 1 });
    expect(report.score).toBeGreaterThanOrEqual(95);
    expect(report.checks.filter((c) => c.status === "fail")).toHaveLength(0);
  });

  it("reports rendered visual checks as skipped, never as passed", () => {
    const report = runQualityGate(files, { visualQaAvailable: false, iterations: 1 });
    const visual = report.checks.filter((c) => c.group === "visual");
    const screenshotCheck = visual.find((c) => c.id === "visual.screenshot-review");
    expect(screenshotCheck?.status).toBe("skipped");
    expect(screenshotCheck?.detail).toMatch(/browser/i);
  });

  it("fails a document that is missing the essentials", () => {
    const broken = [
      { path: "index.html", content: "<!DOCTYPE html><html><body><div>hi</div></body></html>" },
      { path: "styles.css", content: "body{width:1200px}" },
    ];
    const report = runQualityGate(broken, { visualQaAvailable: false, iterations: 1 });
    expect(report.score).toBeLessThan(50);
    expect(report.remainingIssues.length).toBeGreaterThan(5);
    expect(report.checks.find((c) => c.id === "resp.no-fixed-width")?.status).toBe("fail");
    expect(report.checks.find((c) => c.id === "a11y.lang")?.status).toBe("fail");
  });
});
