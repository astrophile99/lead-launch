/**
 * Website build configuration.
 *
 * Client-safe: the build modal imports these, so nothing here may reach into
 * `src/services` or `src/db` (see AGENTS.md, "Client/server boundary").
 *
 * The quality modes are not decoration. Each one is read by the builder and
 * changes the number of implement/fix iterations, whether the code-review pass
 * runs, how deep the quality gate goes, and the token ceiling per call. A mode
 * that changed nothing but a label would be exactly the fake setting this
 * product is supposed to not have.
 */

import type { AICapability, AIProviderId } from "./ai";

export const BUILD_QUALITIES = ["fast", "balanced", "premium"] as const;
export type BuildQuality = (typeof BUILD_QUALITIES)[number];

export type QualitySpec = {
  id: BuildQuality;
  label: string;
  summary: string;
  /** Implement → review → fix cycles. 1 means "generate once, no fix pass". */
  maxIterations: number;
  /** Whether a separate codeReview capability call critiques the output. */
  runCodeReview: boolean;
  /** How strict the quality gate is before it reports the build unfinished. */
  gateThreshold: number;
  /** Output ceiling per model call. */
  maxOutputTokens: number;
  /** Preferred model tier when recommending a model for this mode. */
  preferredTier: "fast" | "balanced" | "premium";
  /** Rough per-call token shape, used only for the pre-build estimate. */
  estimate: { calls: number; inPerCall: number; outPerCall: number };
  notes: string[];
};

export const BUILD_QUALITY: Record<BuildQuality, QualitySpec> = {
  fast: {
    id: "fast",
    label: "Fast",
    summary: "One pass, no fix cycle. For a simple site or a throwaway concept.",
    maxIterations: 1,
    runCodeReview: false,
    gateThreshold: 60,
    maxOutputTokens: 8_000,
    preferredTier: "fast",
    estimate: { calls: 2, inPerCall: 4_000, outPerCall: 7_000 },
    notes: [
      "No self-review pass — whatever the model writes first is what you get.",
      "The quality gate still runs, and still reports what it found.",
    ],
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    summary: "Plan, build, review once, fix. The right default for client work.",
    maxIterations: 2,
    runCodeReview: true,
    gateThreshold: 75,
    maxOutputTokens: 12_000,
    preferredTier: "balanced",
    estimate: { calls: 4, inPerCall: 6_000, outPerCall: 9_000 },
    notes: [
      "One code-review pass, and one round of fixes against what it finds.",
      "Gate failures below 75 are reported rather than silently accepted.",
    ],
  },
  premium: {
    id: "premium",
    label: "Premium",
    summary: "Maximum iterations and the strongest model. Slowest and dearest.",
    maxIterations: 4,
    runCodeReview: true,
    gateThreshold: 85,
    maxOutputTokens: 16_000,
    preferredTier: "premium",
    estimate: { calls: 8, inPerCall: 8_000, outPerCall: 11_000 },
    notes: [
      "Keeps iterating while the gate reports fixable failures, up to four rounds.",
      "Every round re-reads the full document, so input tokens grow each pass.",
    ],
  },
};

/** The capability whose routing the build modal defaults to. */
export const BUILD_CAPABILITY: AICapability = "codeGeneration";

export type BuildStrategy = "scaffold" | "agent";

export const STRATEGY_META: Record<BuildStrategy, { label: string; detail: string }> = {
  scaffold: {
    label: "Deterministic scaffold",
    detail:
      "Rearranges facts already on the business record into a complete static site. No model is called, nothing is inferred, and the output is labelled as generated rather than written.",
  },
  agent: {
    label: "AI build agent",
    detail:
      "A model plans the site, writes each file, reviews its own output against the quality gate and fixes what it broke, for as many rounds as the quality mode allows.",
  },
};

/** Why a given provider/model was recommended, in one sentence for the modal. */
export function recommendationReason(quality: BuildQuality, tier: string): string {
  if (tier === "premium") {
    return "Best fit for a premium marketing website: strongest design judgement, cleanest markup, and it holds a long brief across several files.";
  }
  if (tier === "balanced") {
    return `Strong output at a fraction of the premium cost — the usual choice for ${BUILD_QUALITY[quality].label.toLowerCase()} client work.`;
  }
  return "Cheapest capable model. Sensible for a concept you intend to rewrite anyway.";
}

export type BuildRequest = {
  provider: AIProviderId;
  model: string;
  quality: BuildQuality;
  /** Set only when the operator confirmed building outside a build-ready stage. */
  overrideStage: boolean;
  /** Free-text direction added to the build prompt. */
  notes: string;
};
