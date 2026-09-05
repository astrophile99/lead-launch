/**
 * AI capability routing configuration.
 *
 * The application never hard-codes "call Claude here". Every AI call declares a
 * *capability*; the router (src/providers/ai/router.ts) resolves capability ->
 * provider + model from the workspace's AIProviderConfig rows, seeded from the
 * defaults below.
 */

export const AI_CAPABILITIES = [
  "research",
  "classification",
  "summarization",
  "analysis",
  "copywriting",
  "vision",
  "websitePlanning",
  "codeGeneration",
  "codeReview",
] as const;

export type AICapability = (typeof AI_CAPABILITIES)[number];

export const CAPABILITY_META: Record<
  AICapability,
  { label: string; purpose: string; volume: "high" | "medium" | "low" }
> = {
  research: {
    label: "Research",
    purpose: "Enrichment lookups and competitor discovery. High volume, low stakes.",
    volume: "high",
  },
  classification: {
    label: "Classification",
    purpose: "Category and sub-category tagging, lead qualification triage.",
    volume: "high",
  },
  summarization: {
    label: "Summarization",
    purpose: "Condensing audit output and activity into readable digests.",
    volume: "high",
  },
  analysis: {
    label: "Analysis",
    purpose: "Audit interpretation, opportunity reasoning, sales angle.",
    volume: "medium",
  },
  copywriting: {
    label: "Copy",
    purpose: "Outreach drafts and website content. Tone matters.",
    volume: "medium",
  },
  vision: {
    label: "Vision",
    purpose: "Screenshot review during the visual QA loop.",
    volume: "low",
  },
  websitePlanning: {
    label: "Website Planning",
    purpose: "Turning a business brief into an information architecture.",
    volume: "low",
  },
  codeGeneration: {
    label: "Website Coding",
    purpose: "The build agent. Highest quality bar in the system.",
    volume: "low",
  },
  codeReview: {
    label: "Code Review",
    purpose: "Reviewing generated code against the quality gate.",
    volume: "low",
  },
};

export const AI_PROVIDERS = ["anthropic", "openai", "gemini", "mock"] as const;
export type AIProviderId = (typeof AI_PROVIDERS)[number];

export type ModelSpec = {
  id: string;
  label: string;
  tier: "fast" | "balanced" | "premium";
  supports: AICapability[];
  /**
   * USD per million tokens. Left null when we do not have an authoritative
   * figure - the UI renders "not set" rather than inventing a number, and cost
   * estimation is skipped. Fill these in from your provider's pricing page.
   */
  usdPerMTokIn: number | null;
  usdPerMTokOut: number | null;
};

const ALL: AICapability[] = [...AI_CAPABILITIES];
const TEXT_ONLY: AICapability[] = ALL.filter((c) => c !== "vision");

export const MODEL_CATALOG: Record<AIProviderId, ModelSpec[]> = {
  anthropic: [
    {
      id: "claude-opus-5",
      label: "Claude Opus 5",
      tier: "premium",
      supports: ALL,
      usdPerMTokIn: null,
      usdPerMTokOut: null,
    },
    {
      id: "claude-sonnet-5",
      label: "Claude Sonnet 5",
      tier: "balanced",
      supports: ALL,
      usdPerMTokIn: null,
      usdPerMTokOut: null,
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      tier: "fast",
      supports: ALL,
      usdPerMTokIn: null,
      usdPerMTokOut: null,
    },
  ],
  openai: [
    {
      id: "gpt-5",
      label: "GPT-5",
      tier: "premium",
      supports: ALL,
      usdPerMTokIn: null,
      usdPerMTokOut: null,
    },
    {
      id: "gpt-5-mini",
      label: "GPT-5 mini",
      tier: "fast",
      supports: ALL,
      usdPerMTokIn: null,
      usdPerMTokOut: null,
    },
  ],
  gemini: [
    {
      id: "gemini-2.5-pro",
      label: "Gemini 2.5 Pro",
      tier: "balanced",
      supports: ALL,
      usdPerMTokIn: null,
      usdPerMTokOut: null,
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      tier: "fast",
      supports: TEXT_ONLY,
      usdPerMTokIn: null,
      usdPerMTokOut: null,
    },
  ],
  mock: [
    {
      id: "mock-deterministic",
      label: "Deterministic mock",
      tier: "fast",
      supports: ALL,
      usdPerMTokIn: 0,
      usdPerMTokOut: 0,
    },
  ],
};

export type CostMode = "economy" | "balanced" | "quality";

export const COST_MODES: {
  id: CostMode;
  label: string;
  description: string;
  tierByVolume: Record<"high" | "medium" | "low", ModelSpec["tier"]>;
}[] = [
  {
    id: "economy",
    label: "Economy",
    description: "Cheapest capable model everywhere. Good for bulk discovery runs.",
    tierByVolume: { high: "fast", medium: "fast", low: "balanced" },
  },
  {
    id: "balanced",
    label: "Balanced",
    description:
      "Premium models for building and reasoning, cheap models for bulk work.",
    tierByVolume: { high: "fast", medium: "balanced", low: "premium" },
  },
  {
    id: "quality",
    label: "Quality",
    description: "Best available model for anything that ships to a client.",
    tierByVolume: { high: "balanced", medium: "premium", low: "premium" },
  },
];

/**
 * Default capability routing. Claude is the default for anything that produces
 * client-facing artefacts; cheaper providers handle high-volume plumbing. All of
 * this is overridable per workspace in the AI Control Center.
 */
export const DEFAULT_ROUTING: Record<
  AICapability,
  { provider: AIProviderId; model: string; fallback?: { provider: AIProviderId; model: string } }
> = {
  research: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    fallback: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  },
  classification: {
    provider: "gemini",
    model: "gemini-2.5-flash",
    fallback: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  },
  summarization: {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    fallback: { provider: "openai", model: "gpt-5-mini" },
  },
  analysis: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    fallback: { provider: "openai", model: "gpt-5" },
  },
  copywriting: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    fallback: { provider: "openai", model: "gpt-5" },
  },
  vision: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    fallback: { provider: "openai", model: "gpt-5" },
  },
  websitePlanning: {
    provider: "anthropic",
    model: "claude-opus-5",
    fallback: { provider: "anthropic", model: "claude-sonnet-5" },
  },
  codeGeneration: {
    provider: "anthropic",
    model: "claude-opus-5",
    fallback: { provider: "anthropic", model: "claude-sonnet-5" },
  },
  codeReview: {
    provider: "anthropic",
    model: "claude-sonnet-5",
    fallback: { provider: "openai", model: "gpt-5" },
  },
};

export function modelSpec(
  provider: AIProviderId,
  model: string,
): ModelSpec | undefined {
  return MODEL_CATALOG[provider]?.find((m) => m.id === model);
}
