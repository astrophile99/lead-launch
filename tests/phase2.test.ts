import { describe, expect, it } from "vitest";
import { estimateCost, evaluateBudget } from "@/services/costs";
import { identifierFor } from "@/services/optouts";
import { voiceInstructions, type Voice } from "@/services/voice";
import { verifySignature } from "@/lib/meta-webhook";
import { buildPresence } from "@/components/features/DigitalPresence";
import {
  CHANNEL_LIMITS,
  REFINEMENTS,
  REFINEMENT_INSTRUCTION,
  REFINEMENT_LABEL,
  TONES,
  TONE_HINT,
} from "@/config/outreach";
import { parseFilters } from "@/services/prospects";
import { ok, fail } from "@/lib/api";
import { AppError } from "@/lib/errors";

/* -------------------------------------------------------------- cost model */

describe("cost estimation", () => {
  it("returns no price when the model has none configured", () => {
    // The shipped catalogue deliberately has no prices, because a guessed
    // number is worse than an absent one.
    const estimate = estimateCost([
      { type: "opportunity.analyze", count: 50, provider: "anthropic", model: "claude-sonnet-5" },
    ]);
    expect(estimate.priced).toBe(false);
    expect(estimate.lowUsd).toBeNull();
    expect(estimate.highUsd).toBeNull();
    expect(estimate.calls).toBe(50);
    expect(estimate.assumptions.join(" ")).toMatch(/no price configured/i);
  });

  it("prices work when the model does have a price", () => {
    const estimate = estimateCost([
      { type: "opportunity.analyze", count: 10, provider: "mock", model: "mock-deterministic" },
    ]);
    // The mock model is priced at zero, which is true rather than unknown.
    expect(estimate.priced).toBe(true);
    expect(estimate.lowUsd).toBe(0);
  });

  it("counts calls even for unpriced models", () => {
    const estimate = estimateCost([
      { type: "website.build", count: 3, provider: "openai", model: "gpt-5" },
      { type: "outreach.draft", count: 7, provider: "openai", model: "gpt-5" },
    ]);
    expect(estimate.calls).toBe(10);
  });

  it("gives an empty estimate for no work", () => {
    const estimate = estimateCost([]);
    expect(estimate.calls).toBe(0);
    expect(estimate.priced).toBe(false);
  });
});

describe("budget evaluation", () => {
  it("does not block when no budget is set", () => {
    expect(evaluateBudget(120, null).status).toBe("unknown");
  });

  it("does not block when spend cannot be measured", () => {
    // Unpriced models must never stop work: the number is unknown, not zero.
    const state = evaluateBudget(null, 100);
    expect(state.status).toBe("unknown");
    expect(state.message).toMatch(/no model prices/i);
  });

  it.each([
    [10, 100, "ok"],
    [55, 100, "warn-50"],
    [85, 100, "warn-80"],
    [100, 100, "blocked"],
    [140, 100, "blocked"],
  ])("classifies $%d of $%d as %s", (spent, budget, expected) => {
    expect(evaluateBudget(spent, budget).status).toBe(expected);
  });

  it("reports the percentage it used to decide", () => {
    expect(evaluateBudget(42, 100).pct).toBe(42);
  });
});

/* ---------------------------------------------------------------- opt-outs */

describe("opt-out identifiers", () => {
  it("normalises a phone number so formatting cannot bypass the block", () => {
    const a = identifierFor("whatsapp", { phone: "+91 98765 43210" });
    const b = identifierFor("whatsapp", { phone: "098765-43210" });
    expect(a).toBe(b);
    expect(a).toBe("9876543210");
  });

  it("lower-cases email addresses", () => {
    expect(identifierFor("email", { email: " Hello@Example.COM " })).toBe("hello@example.com");
  });

  it("reduces an Instagram URL to the handle", () => {
    expect(identifierFor("instagram", { instagram: "https://instagram.com/MyStudio" })).toBe(
      "mystudio",
    );
  });

  it("returns null when the channel has no usable identifier", () => {
    expect(identifierFor("email", { phone: "+919876543210" })).toBeNull();
    expect(identifierFor("linkedin", { email: "a@b.com" })).toBeNull();
  });
});

/* ------------------------------------------------------------------- voice */

const BASE_VOICE: Voice = {
  id: "v1",
  name: "Test",
  isDefault: true,
  tone: "direct",
  length: "short",
  salesIntensity: "soft",
  formality: "low",
  personality: ["observant"],
  customInstructions: "Never sound desperate.",
  exampleMessages: [],
  analysis: null,
  analysedAt: null,
};

describe("voice instructions", () => {
  it("renders the dials into prompt text", () => {
    const text = voiceInstructions(BASE_VOICE);
    expect(text).toContain("Tone: direct");
    expect(text).toContain("under 60 words");
    expect(text).toContain("Make the ask easy to ignore");
    expect(text).toContain("Never sound desperate.");
  });

  it("folds a learned style profile in, including what never to write", () => {
    const text = voiceInstructions({
      ...BASE_VOICE,
      analysis: {
        avgSentenceWords: 11,
        vocabulary: "plain",
        formality: "low",
        salesPressure: "low",
        openingStyle: "Straight into the observation.",
        ctaStyle: "Asks for ten minutes.",
        usesEmoji: false,
        usesContractions: true,
        signaturePhrases: ["quick one"],
        avoid: ["circle back"],
      analysedAt: null,
        summary: "Short and plain.",
      } as never,
    });
    expect(text).toContain("about 11 words per sentence");
    expect(text).toContain("They never use emoji.");
    expect(text).toContain("Never write: circle back.");
    expect(text).toContain("quick one");
  });

  it("has a hint for every tone offered in the UI", () => {
    for (const tone of TONES) {
      expect(TONE_HINT[tone]).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------- refinements */

describe("message refinements", () => {
  it("has a label and an instruction for every refinement", () => {
    for (const r of REFINEMENTS) {
      expect(REFINEMENT_LABEL[r]).toBeTruthy();
      expect(REFINEMENT_INSTRUCTION[r].length).toBeGreaterThan(20);
    }
  });

  it("never instructs the model to add new facts", () => {
    for (const r of REFINEMENTS) {
      expect(REFINEMENT_INSTRUCTION[r]).not.toMatch(/\badd (a )?(new )?(fact|detail|claim)/i);
    }
  });

  it("defines a character limit for every channel", () => {
    for (const [channel, limit] of Object.entries(CHANNEL_LIMITS)) {
      expect(limit.maxChars).toBeGreaterThan(100);
      expect(limit.note.length).toBeGreaterThan(10);
      expect(channel).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------- webhook security */

describe("Meta webhook signature verification", () => {
  const body = JSON.stringify({ entry: [{ id: "1" }] });

  it("rejects a payload when no signature header is present", () => {
    expect(verifySignature(body, null)).toBe(false);
  });

  it("rejects a wrong signature", () => {
    expect(verifySignature(body, "sha256=deadbeef")).toBe(false);
  });

  it("rejects everything when no app secret is configured", () => {
    // The shipped test environment has no META_APP_SECRET, and an unverified
    // webhook must never be trusted just because verification is impossible.
    expect(verifySignature(body, "sha256=anything")).toBe(false);
  });
});

/* ------------------------------------------------------- digital presence */

describe("digital presence", () => {
  const base = {
    website: null,
    googleUrl: null,
    instagram: null,
    facebook: null,
    linkedin: null,
    email: null,
    phone: null,
    source: "mock",
  };

  it("marks a field available when it has a value", () => {
    const channels = buildPresence({ ...base, website: "https://x.test/", phone: "+91 98765 43210" });
    expect(channels.find((c) => c.id === "website")?.state).toBe("available");
    expect(channels.find((c) => c.id === "phone")?.state).toBe("available");
  });

  it("never claims a field is missing when the provider cannot return it", () => {
    // Google Places exposes no email or social handles; calling those "missing"
    // would be a claim about the business rather than about our data.
    const channels = buildPresence({ ...base, source: "google-places" });
    expect(channels.find((c) => c.id === "email")?.state).toBe("unknown");
    expect(channels.find((c) => c.id === "instagram")?.state).toBe("unknown");
    expect(channels.find((c) => c.id === "email")?.note).toMatch(/does not expose/i);
  });

  it("does mark a field missing when the provider could have returned it", () => {
    const channels = buildPresence({ ...base, source: "mock" });
    expect(channels.find((c) => c.id === "email")?.state).toBe("missing");
    expect(channels.find((c) => c.id === "website")?.state).toBe("missing");
  });

  it("builds a tel: link rather than a bare number", () => {
    const channels = buildPresence({ ...base, phone: "+91 98765 43210" });
    expect(channels.find((c) => c.id === "phone")?.href).toBe("tel:+919876543210");
  });
});

/* ---------------------------------------------------------------- filters */

describe("prospect filter parsing", () => {
  it("defaults every filter to all", () => {
    const f = parseFilters({});
    expect(f).toMatchObject({
      q: "",
      website: "all",
      score: "all",
      stage: "all",
      contact: "all",
      recency: "all",
      tag: "all",
      campaign: "all",
    });
  });

  it("reads values from the query string", () => {
    const f = parseFilters({ q: "dental", website: "none", score: "high", stage: "contacted" });
    expect(f.q).toBe("dental");
    expect(f.website).toBe("none");
    expect(f.score).toBe("high");
    expect(f.stage).toBe("contacted");
  });

  it("takes the first value when a parameter repeats", () => {
    expect(parseFilters({ q: ["a", "b"] }).q).toBe("a");
  });
});

/* ------------------------------------------------------------ API shape */

describe("API response envelope", () => {
  it("wraps success in a stable shape", async () => {
    const res = ok({ hello: "world" });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, data: { hello: "world" } });
  });

  it("maps an AppError onto its HTTP status and keeps the remedy", async () => {
    const res = fail(
      new AppError({
        kind: "rate-limited",
        message: "Too many requests.",
        remedy: "Wait for the window to reset.",
        retryable: true,
      }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error: {
        code: "rate-limited",
        message: "Too many requests.",
        remedy: "Wait for the window to reset.",
        retryable: true,
      },
    });
  });

  it("never leaks a stack trace to the caller", async () => {
    const res = fail(new Error("connect ECONNREFUSED 127.0.0.1:5432 at Socket._onError"));
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(JSON.stringify(body)).not.toMatch(/at Socket|stack/i);
    expect(body.error.remedy).toBeTruthy();
  });
});
