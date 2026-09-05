/**
 * Opportunity scoring configuration.
 *
 * Weights are deliberately data, not code: they are the default seed for the
 * per-workspace `scoring.weights` setting and can be edited in Settings. The
 * scoring engine (src/services/scoring.ts) reads the stored values and always
 * reports a full breakdown, so a score can be defended line by line.
 */

export const SCORING_FACTORS = [
  "websiteWeakness",
  "businessReputation",
  "reviewVolume",
  "contactability",
  "localDemand",
  "conversionOpportunity",
  "visualQualityGap",
] as const;

export type ScoringFactor = (typeof SCORING_FACTORS)[number];

export type ScoringWeights = Record<ScoringFactor, number>;

/** Defaults sum to 1.0. The engine renormalises if a user edits them unevenly. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  websiteWeakness: 0.25,
  businessReputation: 0.2,
  reviewVolume: 0.15,
  contactability: 0.1,
  localDemand: 0.1,
  conversionOpportunity: 0.1,
  visualQualityGap: 0.1,
};

export const FACTOR_LABELS: Record<ScoringFactor, string> = {
  websiteWeakness: "Website weakness",
  businessReputation: "Business reputation",
  reviewVolume: "Review volume",
  contactability: "Contactability",
  localDemand: "Local demand",
  conversionOpportunity: "Conversion opportunity",
  visualQualityGap: "Visual quality gap",
};

export const FACTOR_DESCRIPTIONS: Record<ScoringFactor, string> = {
  websiteWeakness:
    "How much headroom the current site has. No site at all scores highest; a strong site scores near zero.",
  businessReputation:
    "Average rating, normalised. A well-regarded business converts a new site into revenue faster.",
  reviewVolume:
    "Review count on a log scale - proxy for established demand rather than a new venture.",
  contactability:
    "Whether we can actually reach a decision maker: email, phone, and social handles.",
  localDemand:
    "Category-level demand signal for local search, from the industry profile.",
  conversionOpportunity:
    "Gap between traffic-worthy reputation and the site's ability to convert it (CTA, booking, contact).",
  visualQualityGap:
    "Distance between the brand's standing and how the site presents it visually.",
};

export type OpportunityTier =
  | "immediate"
  | "high-value"
  | "quick-win"
  | "emerging"
  | "low";

export const TIERS: {
  id: OpportunityTier;
  label: string;
  glyph: string;
  description: string;
}[] = [
  {
    id: "immediate",
    label: "Immediate Opportunities",
    glyph: "\u{1F525}",
    description:
      "High score and reachable today. Established reputation paired with a weak or absent site.",
  },
  {
    id: "high-value",
    label: "High Value",
    glyph: "\u{1F48E}",
    description:
      "Large estimated project value - deep service catalogue, strong review base, premium category.",
  },
  {
    id: "quick-win",
    label: "Quick Wins",
    glyph: "⚡",
    description:
      "Small scope, low effort findings, direct contact available. Fast to pitch and fast to ship.",
  },
  {
    id: "emerging",
    label: "Emerging",
    glyph: "\u{1F331}",
    description:
      "Promising but thin evidence so far - usually low review volume or missing contact detail.",
  },
  {
    id: "low",
    label: "Low Priority",
    glyph: "⚠",
    description:
      "Already well served digitally, or too little signal to justify outreach effort.",
  },
];

/** Estimated project value bands, used for pipeline value in INR. */
export const VALUE_BANDS = {
  starter: 35_000,
  standard: 75_000,
  premium: 150_000,
  flagship: 300_000,
} as const;
