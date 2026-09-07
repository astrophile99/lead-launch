import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeArchivePath, createZip, safeFilename } from "@/lib/zip";
import { checkRate, resetRateLimits } from "@/lib/rate-limit";
import { assertSafePublicUrl } from "@/lib/safe-url";
import {
  parseRobots,
  robotsAllows,
  linkedPriorityPaths,
  type CrawlResult,
} from "@/services/crawler";
import { extractSite } from "@/services/research";
import { buildGateFor, normaliseStage, PIPELINE_STAGES } from "@/config/pipeline";
import { BUILD_QUALITY, BUILD_QUALITIES } from "@/config/build";
import { buildMime } from "@/providers/messaging/gmail";
import { withinReplayWindow } from "@/lib/meta-webhook";
import { QUEUE_STATES, parseQueueFilters } from "@/services/outreach-queue";
import { periodKey } from "@/services/provider-usage";

/* ============================================================================
 * The rule this whole release exists to enforce.
 * ========================================================================= */

describe("website generation never happens automatically", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  /**
   * A static check rather than a behavioural one, and deliberately so: the way
   * an accidental build gets shipped is that somebody adds one call in a
   * pipeline that already runs on its own. Asserting that these modules cannot
   * even reach the build entry point catches that at the import graph, before
   * anyone has to notice a surprise invoice.
   */
  const MUST_NOT_BUILD = [
    "src/services/discovery.ts",
    "src/services/audit.ts",
    "src/services/scoring.ts",
    "src/services/opportunity.ts",
    "src/services/outreach.ts",
    "src/services/outreach-queue.ts",
    "src/services/research.ts",
    "src/services/website-brief.ts",
    "src/services/tasks.ts",
  ];

  it.each(MUST_NOT_BUILD)("%s cannot start a build", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/from ["']\.\/website-build["']/);
    expect(source).not.toMatch(/from ["']@\/services\/website-build["']/);
    expect(source).not.toMatch(/\bstartBuild\s*\(/);
  });

  it("only website-build.ts creates a WebsiteBuild row", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        // `generated` is the Prisma client; it is not application code and it
        // defines the model, it does not call it.
        if (entry.isDirectory()) {
          if (entry.name !== "generated") walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (/websiteBuild\.create\(/.test(source)) {
            offenders.push(path.relative(process.cwd(), full).replace(/\\/g, "/"));
          }
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(offenders).toEqual(["src/services/website-build.ts"]);
  });

  it("the next-action engine never suggests building before a meeting", () => {
    // Duplicated from unit.test.ts on purpose: this is the rule, and it should
    // fail loudly from more than one direction if someone relaxes it.
    const source = read("src/services/tasks.ts");
    const beforeMeeting = source.slice(0, source.indexOf("meeting-completed"));
    expect(beforeMeeting.toLowerCase()).not.toMatch(/title: "build/i);
  });

  it("the build request type has no default, so a build cannot start by omission", () => {
    const source = read("src/services/website-build.ts");
    // `request` is required and positional. If it ever gains a default the
    // whole guarantee evaporates, because every caller becomes a build caller.
    expect(source).toMatch(/request: BuildRequest,/);
    expect(source).not.toMatch(/request: BuildRequest = /);
    expect(source).not.toMatch(/request\?: BuildRequest/);
  });
});

/* ============================================================================
 * Stage-aware build availability
 * ========================================================================= */

describe("build gate", () => {
  it("does not require an override once a meeting is on the record", () => {
    for (const stage of ["meeting-scheduled", "meeting-completed", "proposal", "won"]) {
      const gate = buildGateFor(stage);
      expect(gate.allowed).toBe(true);
      expect(gate.requiresOverride).toBe(false);
    }
  });

  it("requires a deliberate override before a conversation has happened", () => {
    for (const stage of ["new", "researched", "contacted", "responded", "qualified"]) {
      const gate = buildGateFor(stage);
      // Allowed, but only knowingly. Refusing outright would be the app
      // overruling its operator; defaulting to yes would be the app spending
      // their money.
      expect(gate.allowed).toBe(true);
      expect(gate.requiresOverride).toBe(true);
      expect(gate.reason.length).toBeGreaterThan(20);
    }
  });

  it("treats a closed prospect as needing an override too", () => {
    expect(buildGateFor("lost").requiresOverride).toBe(true);
    expect(buildGateFor("not-interested").requiresOverride).toBe(true);
  });

  it("maps every stage an earlier version wrote onto a current one", () => {
    for (const legacy of [
      "discovered",
      "audited",
      "concept",
      "building",
      "website-ready",
      "follow-up",
      "meeting",
    ]) {
      const mapped = normaliseStage(legacy);
      expect(PIPELINE_STAGES).toContain(mapped);
    }
    expect(normaliseStage("meeting")).toBe("meeting-scheduled");
    expect(normaliseStage("website-ready")).toBe("researched");
    expect(normaliseStage("nonsense")).toBe("new");
  });

  it("has no production stage left in the pipeline", () => {
    // Modelling "building" as a sales stage is what made an automatic build
    // look like ordinary progress. It must not come back.
    for (const stage of PIPELINE_STAGES) {
      expect(stage).not.toMatch(/build|website|concept/);
    }
  });
});

/* ============================================================================
 * Build quality modes actually differ
 * ========================================================================= */

describe("build quality modes", () => {
  it("are not three labels for the same thing", () => {
    const iterations = BUILD_QUALITIES.map((q) => BUILD_QUALITY[q].maxIterations);
    expect(new Set(iterations).size).toBe(BUILD_QUALITIES.length);

    const thresholds = BUILD_QUALITIES.map((q) => BUILD_QUALITY[q].gateThreshold);
    expect(new Set(thresholds).size).toBe(BUILD_QUALITIES.length);
  });

  it("escalate monotonically from fast to premium", () => {
    expect(BUILD_QUALITY.fast.maxIterations).toBeLessThan(BUILD_QUALITY.balanced.maxIterations);
    expect(BUILD_QUALITY.balanced.maxIterations).toBeLessThan(BUILD_QUALITY.premium.maxIterations);
    expect(BUILD_QUALITY.fast.maxOutputTokens).toBeLessThan(BUILD_QUALITY.premium.maxOutputTokens);
  });

  it("only skips the review pass on the fastest mode", () => {
    expect(BUILD_QUALITY.fast.runCodeReview).toBe(false);
    expect(BUILD_QUALITY.balanced.runCodeReview).toBe(true);
    expect(BUILD_QUALITY.premium.runCodeReview).toBe(true);
  });
});

/* ============================================================================
 * ZIP safety
 * ========================================================================= */

describe("archive path safety", () => {
  const dangerous = [
    "../escape.html",
    "a/../../escape.html",
    "/etc/passwd",
    "C:/Windows/system32/x.html",
    "dir\\file.html",
    "con.html",
    "NUL",
    "trailing./x.html",
    "trailing /x.html",
    "",
    "./x.html",
  ];

  it.each(dangerous)("refuses %j", (name) => {
    expect(() => assertSafeArchivePath(name)).toThrow();
  });

  it("refuses a path containing a control character", () => {
    expect(() => assertSafeArchivePath(`ok${String.fromCharCode(1)}.html`)).toThrow();
    expect(() => assertSafeArchivePath("ok\u0000.html")).toThrow();
  });

  it("accepts ordinary project paths", () => {
    for (const name of ["index.html", "styles.css", "assets/logo.svg", "README.md"]) {
      expect(assertSafeArchivePath(name)).toBe(name);
    }
  });

  it("produces a real archive with a valid local header and central directory", () => {
    const zip = createZip([
      { path: "index.html", content: "<!DOCTYPE html><title>x</title>" },
      { path: "styles.css", content: "body{color:red}".repeat(40) },
    ]);
    // Local file header, then the end-of-central-directory record.
    expect(zip.subarray(0, 4).toString("latin1")).toBe("PK\u0003\u0004");
    expect(zip.subarray(zip.length - 22, zip.length - 18).toString("latin1")).toBe("PK\u0005\u0006");
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2); // entries in the directory
  });

  it("refuses to write the same path twice", () => {
    expect(() =>
      createZip([
        { path: "index.html", content: "a" },
        { path: "index.html", content: "b" },
      ]),
    ).toThrow(/twice/i);
  });

  it("strips a download filename to something safe", () => {
    expect(safeFilename("Bandra Terra Dental / Centre v1")).toBe("Bandra-Terra-Dental-Centre-v1");
    expect(safeFilename("../../etc/passwd")).toBe("etcpasswd");
    expect(safeFilename("???")).toBe("website");
  });
});

/* ============================================================================
 * SSRF and crawler limits
 * ========================================================================= */

describe("SSRF guard", () => {
  const blocked = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.4.4/",
    "http://[::1]/",
    "http://internal.local/",
    "http://db.internal/",
    "file:///etc/passwd",
    "gopher://evil.example/",
    "http://user:pass@example.com/",
  ];

  it.each(blocked)("refuses %s", (url) => {
    expect(() => assertSafePublicUrl(url)).toThrow();
  });

  it("allows an ordinary public site", () => {
    expect(assertSafePublicUrl("https://example.com/about").hostname).toBe("example.com");
    expect(assertSafePublicUrl("example.com").protocol).toBe("https:");
  });
});

describe("crawler limits", () => {
  it("reads the Disallow rules that apply to us", () => {
    const rules = parseRobots(
      [
        "User-agent: Googlebot",
        "Disallow: /google-only",
        "",
        "User-agent: *",
        "Disallow: /admin",
        "Disallow: /cart   # comment",
      ].join("\n"),
    );
    expect(rules).toContain("/admin");
    expect(rules).toContain("/cart");
    expect(rules).not.toContain("/google-only");
  });

  it("honours a group naming our own agent", () => {
    const rules = parseRobots(["User-agent: LeadLaunchBot", "Disallow: /"].join("\n"));
    expect(robotsAllows("/anything", rules)).toBe(false);
  });

  it("blocks a path under a disallowed prefix", () => {
    expect(robotsAllows("/admin/users", ["/admin"])).toBe(false);
    expect(robotsAllows("/about", ["/admin"])).toBe(true);
  });

  it("follows only same-origin priority paths from the homepage", () => {
    const html = `
      <a href="/about">About</a>
      <a href="/contact/">Contact</a>
      <a href="https://evil.example/contact">Elsewhere</a>
      <a href="/blog/2024/some-post">Blog</a>
      <a href="/services">Services</a>
    `;
    const paths = linkedPriorityPaths(html, "https://client.example");
    expect(paths).toEqual(["/about", "/contact", "/services"]);
    // Not a priority path, so not fetched however prominently it is linked.
    expect(paths).not.toContain("/blog/2024/some-post");
  });
});

/* ============================================================================
 * Deterministic extraction
 * ========================================================================= */

describe("site extraction", () => {
  const page = (html: string): CrawlResult => ({
    origin: "https://client.example",
    pages: [
      {
        url: "https://client.example/",
        finalUrl: "https://client.example/",
        status: 200,
        bytes: html.length,
        contentType: "text/html",
        html: html as string | null,
        skippedReason: null as string | null,
        loadMs: 100,
      },
    ],
    requests: 1,
    bytes: html.length,
    durationMs: 100,
    robotsBlocked: [],
    error: null,
  });

  it("prefers declared contact details over ones scraped from prose", () => {
    const result = extractSite(
      page(`<a href="mailto:hello@client.example">Email</a><a href="tel:+919876543210">Call</a>`),
    );
    expect(result.emails).toContain("hello@client.example");
    expect(result.phones).toContain("+919876543210");
  });

  it("does not mistake a short number for a phone number", () => {
    const result = extractSite(page("<p>Established 1998. Suite 12. Open 9 to 5.</p>"));
    expect(result.phones).toEqual([]);
  });

  it("reads schema.org data without falling over on malformed JSON", () => {
    const result = extractSite(
      page(`
        <script type="application/ld+json">{"@type":"LocalBusiness","address":{"streetAddress":"12 Hill Rd","addressLocality":"Bandra"}}</script>
        <script type="application/ld+json">{ this is not json }</script>
      `),
    );
    expect(result.structuredData).toHaveLength(1);
    expect(result.addresses[0]).toContain("12 Hill Rd");
  });

  it("records social profiles by platform, once each", () => {
    const result = extractSite(
      page(`
        <a href="https://www.instagram.com/theclinic">IG</a>
        <a href="https://instagram.com/theclinic/posts">IG again</a>
        <a href="https://facebook.com/theclinic">FB</a>
      `),
    );
    expect(result.socials.filter((s) => s.platform === "instagram")).toHaveLength(1);
    expect(result.socials.map((s) => s.platform).sort()).toEqual(["facebook", "instagram"]);
  });

  it("reports a page that was fetched but not parsed, rather than treating it as empty", () => {
    const crawl = page("<h1>Home</h1>");
    crawl.pages.push({
      url: "https://client.example/brochure.pdf",
      finalUrl: "https://client.example/brochure.pdf",
      status: 200,
      bytes: 0,
      contentType: "application/pdf",
      html: null,
      skippedReason: "Not HTML (application/pdf).",
      loadMs: 20,
    });
    const result = extractSite(crawl);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/not html/i);
    expect(result.pageCount).toBe(1);
  });
});

/* ============================================================================
 * Outreach state machine
 * ========================================================================= */

describe("outreach queue states", () => {
  it("keeps approved and sent as separate states", () => {
    expect(QUEUE_STATES).toContain("approved");
    expect(QUEUE_STATES).toContain("sent");
    expect(QUEUE_STATES).toContain("sending");
    // A single "ready" state would let the UI conflate the two, which is the
    // exact failure this product must not have.
    expect(QUEUE_STATES.indexOf("approved")).toBeLessThan(QUEUE_STATES.indexOf("sent"));
  });

  it("defaults every filter to all", () => {
    expect(parseQueueFilters({})).toEqual({ state: "all", channel: "all", q: "" });
  });

  it("reads a state and a channel from the query string", () => {
    const f = parseQueueFilters({ state: "needs-review", channel: "whatsapp", q: "dental" });
    expect(f.state).toBe("needs-review");
    expect(f.channel).toBe("whatsapp");
    expect(f.q).toBe("dental");
  });

  it("ignores a state it does not recognise rather than trusting it", () => {
    expect(parseQueueFilters({ state: "; DROP TABLE" }).state).toBe("all");
    expect(parseQueueFilters({ channel: "carrier-pigeon" }).channel).toBe("all");
  });
});

describe("outreach services enforce the order of operations", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/services/outreach-queue.ts"),
    "utf8",
  );

  it("approve never transmits", () => {
    const approve = source.slice(
      source.indexOf("export async function approveForSend"),
      source.indexOf("export type SendResult"),
    );
    expect(approve).not.toMatch(/\.send\(/);
    expect(approve).not.toMatch(/sendDraft\(/);
    expect(approve).not.toMatch(/status: "sent"/);
  });

  it("editing an approved message returns it to draft", () => {
    const edit = source.slice(
      source.indexOf("export async function editMessage"),
      source.indexOf("export async function approveForSend"),
    );
    expect(edit).toMatch(/status: "draft"/);
    expect(edit).toMatch(/approvedAt: null/);
  });

  it("only a provider id promotes a message to sent", () => {
    // The guard immediately before the "sent" write.
    expect(source).toMatch(/if \(!externalId\) \{/);
    expect(source).toMatch(/did not return a message id/);
  });
});

/* ============================================================================
 * Gmail
 * ========================================================================= */

describe("Gmail", () => {
  it("asks for compose only, never for read access", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/providers/messaging/gmail.ts"),
      "utf8",
    );
    expect(source).toMatch(/auth\/gmail\.compose/);
    // A scope this app does not need must not appear in a request.
    expect(source).not.toMatch(/const SCOPES[^\]]*gmail\.readonly/);
    expect(source).not.toMatch(/const SCOPES[^\]]*gmail\.modify/);
    expect(source).not.toMatch(/const SCOPES[^\]]*mail\.google\.com/);
  });

  it("has no password field anywhere in the provider", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/providers/messaging/gmail.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bpassword\s*[:=]/i);
  });

  it("builds a MIME message that cannot carry an injected header", () => {
    const mime = buildMime({
      from: "me@example.com",
      fromName: "Me",
      // A newline in the subject would otherwise inject Bcc:.
      to: "them@example.com",
      subject: "Hello\r\nBcc: victim@example.com",
      body: "Body text",
      replyTo: null,
      signature: null,
    });
    // The injection is only an injection if it becomes its own header line.
    // Folding it into the Subject value is the correct, safe outcome.
    const headers = mime.slice(0, mime.indexOf("\r\n\r\n")).split("\r\n");
    expect(headers.some((line) => /^Bcc:/i.test(line))).toBe(false);
    expect(headers.filter((l) => /^Subject:/.test(l))).toHaveLength(1);
  });

  it("encodes a non-ASCII subject rather than emitting raw bytes", () => {
    const mime = buildMime({
      from: "me@example.com",
      fromName: null,
      to: "them@example.com",
      subject: "Café — booking",
      body: "x",
      replyTo: null,
      signature: null,
    });
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("appends a signature after a plain-text separator", () => {
    const mime = buildMime({
      from: "me@example.com",
      fromName: null,
      to: "them@example.com",
      subject: "x",
      body: "Body",
      replyTo: null,
      signature: "Atharva",
    });
    const body = Buffer.from(mime.slice(mime.indexOf("\r\n\r\n") + 4).replace(/\r\n/g, ""), "base64")
      .toString("utf8");
    expect(body).toBe("Body\n\n--\nAtharva");
  });
});

/* ============================================================================
 * Webhook replay and rate limiting
 * ========================================================================= */

describe("webhook replay protection", () => {
  it("accepts an event from a moment ago", () => {
    expect(withinReplayWindow(Math.floor(Date.now() / 1000))).toBe(true);
  });

  it("rejects an event from an hour ago", () => {
    expect(withinReplayWindow(Math.floor(Date.now() / 1000) - 3600)).toBe(false);
  });

  it("rejects a timestamp from the future", () => {
    expect(withinReplayWindow(Math.floor(Date.now() / 1000) + 3600)).toBe(false);
  });

  it("does not reject when there is no timestamp to check", () => {
    // Meta does not send one on every event type. Idempotency is the
    // protection there, so this must not reject by default.
    expect(withinReplayWindow(null)).toBe(true);
    expect(withinReplayWindow(Number.NaN)).toBe(true);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit and then refuses", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i += 1) {
      expect(checkRate("k", 3, 60_000).ok).toBe(true);
    }
    const over = checkRate("k", 3, 60_000);
    expect(over.ok).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keys are independent", () => {
    resetRateLimits();
    expect(checkRate("a", 1, 60_000).ok).toBe(true);
    expect(checkRate("b", 1, 60_000).ok).toBe(true);
    expect(checkRate("a", 1, 60_000).ok).toBe(false);
  });

  it("reports how many attempts remain", () => {
    resetRateLimits();
    expect(checkRate("c", 5, 60_000).remaining).toBe(4);
    expect(checkRate("c", 5, 60_000).remaining).toBe(3);
  });
});

/* ============================================================================
 * Cost accounting
 * ========================================================================= */

describe("provider usage", () => {
  it("keys a period by UTC year and month", () => {
    expect(periodKey(new Date("2026-09-07T23:30:00Z"))).toBe("2026-09");
    expect(periodKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

/* ============================================================================
 * Secrets never reach the browser
 * ========================================================================= */

describe("secret handling", () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "generated") walk(full, out);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  const files = walk(path.join(process.cwd(), "src"));

  it("never prefixes a server secret with NEXT_PUBLIC_", () => {
    const forbidden =
      /NEXT_PUBLIC_(ANTHROPIC|OPENAI|GEMINI|GOOGLE_OAUTH|GOOGLE_PLACES|RESEND|WHATSAPP|INSTAGRAM|META|VERCEL|NETLIFY|GITHUB|TOKEN_ENCRYPTION|SUPABASE_SERVICE)/;
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8")).not.toMatch(forbidden);
    }
  });

  it("reads process.env only in the config module", () => {
    const offenders = files
      .filter((f) => /process\.env/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f).replace(/\\/g, "/"));
    expect(offenders).toEqual(["src/config/app.ts"]);
  });

  it("no client component imports a service or the database", () => {
    // This is the "Can't resolve 'fs'" bug as a test: the typechecker does not
    // catch it, and only a production build does.
    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      if (!/^["']use client["']/m.test(source)) continue;
      // A type-only import is erased at compile time and cannot pull Prisma
      // into the bundle, so only value imports are a problem here.
      if (/(?<!import type )(?<!, )\bimport\s+(?!type\b)[^;]*from ["']@\/(services|db)\//.test(source)) {
        offenders.push(path.relative(process.cwd(), file).replace(/\\/g, "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the Gmail connection view carries no token field", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/providers/messaging/gmail.ts"),
      "utf8",
    );
    const view = source.slice(
      source.indexOf("export type GmailConnection = {"),
      source.indexOf("/** The only shape of a Gmail account"),
    );
    expect(view).toMatch(/hasRefreshToken: boolean/);
    expect(view).not.toMatch(/accessToken|refreshToken(?!Enc)\s*:/);
    expect(view).not.toMatch(/TokenEnc/);
  });
});
