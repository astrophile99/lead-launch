import {
  DEFAULT_SCORING_WEIGHTS,
  FACTOR_LABELS,
  SCORING_FACTORS,
  VALUE_BANDS,
  type OpportunityTier,
  type ScoringFactor,
  type ScoringWeights,
} from "@/config/scoring";
import { resolveIndustry } from "@/config/industries";
import { clamp, round } from "@/lib/utils";
import type { AuditScores, FactorBreakdown, OpportunityReason } from "@/types";

/**
 * The opportunity engine.
 *
 * Explainability is the requirement, not the score. Every factor produces a
 * 0-100 raw value with a one-line justification, the weighted sum is reported
 * alongside the inputs, and the UI renders the breakdown next to the number so
 * a claim of "92/100" can be checked line by line.
 */

export type ScoringInput = {
  business: {
    name: string;
    category: string;
    rating: number | null;
    reviewCount: number | null;
    website: string | null;
    email: string | null;
    phone: string | null;
    instagram: string | null;
    facebook: string | null;
    linkedin: string | null;
    services: string[];
  };
  audit: {
    scores: AuditScores;
    findingCounts: Record<"critical" | "high" | "medium" | "low" | "info", number>;
    hasBookingPath: boolean;
    hasCtaAboveFold: boolean;
    isMock: boolean;
  } | null;
};

export type ScoringResult = {
  score: number;
  tier: OpportunityTier;
  labels: string[];
  reasons: OpportunityReason[];
  breakdown: FactorBreakdown;
  contactability: number;
  estimatedValue: number;
};

function normaliseWeights(weights: ScoringWeights): ScoringWeights {
  const total = SCORING_FACTORS.reduce((s, f) => s + (weights[f] ?? 0), 0);
  if (total <= 0) return { ...DEFAULT_SCORING_WEIGHTS };
  return Object.fromEntries(
    SCORING_FACTORS.map((f) => [f, (weights[f] ?? 0) / total]),
  ) as ScoringWeights;
}

// ------------------------------------------------------------------- factors

function websiteWeakness(input: ScoringInput): { raw: number; note: string } {
  if (!input.business.website) {
    return { raw: 100, note: "No website on record - maximum headroom." };
  }
  if (!input.audit) {
    return {
      raw: 50,
      note: "A website exists but has not been audited yet; scored neutrally until it is.",
    };
  }
  const raw = clamp(100 - input.audit.scores.overall);
  return {
    raw,
    note: `Current site scores ${input.audit.scores.overall}/100 overall, leaving ${raw} points of headroom.`,
  };
}

function businessReputation(input: ScoringInput): { raw: number; note: string } {
  const rating = input.business.rating;
  if (rating == null) {
    return { raw: 40, note: "No rating available; scored below neutral for lack of evidence." };
  }
  // 3.0 -> 0, 5.0 -> 100. Below 3.0 a new site cannot fix the underlying problem.
  const raw = clamp(((rating - 3) / 2) * 100);
  const note =
    rating >= 4.5
      ? `Rated ${rating} - a strong reputation that a better site can convert.`
      : rating >= 4
        ? `Rated ${rating} - solid standing locally.`
        : `Rated ${rating} - the reputation itself may be the constraint, not the website.`;
  return { raw, note };
}

function reviewVolume(input: ScoringInput): { raw: number; note: string } {
  const count = input.business.reviewCount ?? 0;
  if (count === 0) return { raw: 0, note: "No reviews - demand is unproven." };
  // Log scale: 10 reviews ~ 33, 100 ~ 66, 1000 ~ 100.
  const raw = clamp(round((Math.log10(count) / 3) * 100));
  const note =
    count >= 250
      ? `${count} reviews - an established business with real, repeat demand.`
      : count >= 50
        ? `${count} reviews - a credible track record.`
        : `${count} reviews - limited public evidence of volume.`;
  return { raw, note };
}

function contactability(input: ScoringInput): { raw: number; note: string } {
  const b = input.business;
  let raw = 0;
  const have: string[] = [];
  if (b.phone) {
    raw += 40;
    have.push("phone");
  }
  if (b.email) {
    raw += 35;
    have.push("email");
  }
  if (b.instagram) {
    raw += 12;
    have.push("Instagram");
  }
  if (b.linkedin) {
    raw += 8;
    have.push("LinkedIn");
  }
  if (b.facebook) {
    raw += 5;
    have.push("Facebook");
  }
  raw = clamp(raw);
  return {
    raw,
    note: have.length
      ? `Reachable via ${have.join(", ")}.`
      : "No direct contact channel on record - outreach would have to go through the website form.",
  };
}

function localDemand(input: ScoringInput): { raw: number; note: string } {
  const industry = resolveIndustry(input.business.category);
  const raw = clamp(industry.localDemand * 100);
  return {
    raw,
    note: `${industry.label} is a ${raw >= 85 ? "high" : raw >= 70 ? "moderate" : "lower"}-intent local search category.`,
  };
}

function conversionOpportunity(input: ScoringInput): { raw: number; note: string } {
  if (!input.business.website) {
    return {
      raw: 100,
      note: "With no site, every search that reaches this business converts elsewhere or not at all.",
    };
  }
  if (!input.audit) {
    return { raw: 50, note: "Conversion path not yet assessed." };
  }
  const gaps: string[] = [];
  let raw = clamp(100 - input.audit.scores.ux);
  if (!input.audit.hasCtaAboveFold) {
    raw = clamp(raw + 10);
    gaps.push("no action above the fold");
  }
  if (!input.audit.hasBookingPath) {
    raw = clamp(raw + 10);
    gaps.push("no booking or enquiry route");
  }
  const reputationIsGood = (input.business.rating ?? 0) >= 4.3;
  if (reputationIsGood && raw > 50) {
    gaps.push("strong reputation arriving at a page that does not ask for the booking");
  }
  return {
    raw,
    note: gaps.length
      ? `UX scores ${input.audit.scores.ux}/100: ${gaps.join("; ")}.`
      : `UX scores ${input.audit.scores.ux}/100 with a working conversion path.`,
  };
}

function visualQualityGap(input: ScoringInput): { raw: number; note: string } {
  if (!input.business.website) {
    return { raw: 100, note: "Nothing exists to present the brand." };
  }
  if (!input.audit) return { raw: 50, note: "Not yet assessed." };

  // A proxy, and labelled as one: the visual review that a person or a vision
  // model performs is the authority here. Structural age and severity of
  // findings correlate well enough to rank prospects.
  const severe =
    input.audit.findingCounts.critical * 12 + input.audit.findingCounts.high * 6;
  const structural = clamp(100 - input.audit.scores.bestPractices);
  const raw = clamp(Math.round(severe * 0.5 + structural * 0.5));
  return {
    raw,
    note: `Structural proxy: ${input.audit.findingCounts.critical} critical and ${input.audit.findingCounts.high} high-severity findings. A visual review would confirm.`,
  };
}

const FACTOR_FNS: Record<ScoringFactor, (i: ScoringInput) => { raw: number; note: string }> = {
  websiteWeakness,
  businessReputation,
  reviewVolume,
  contactability,
  localDemand,
  conversionOpportunity,
  visualQualityGap,
};

// -------------------------------------------------------------------- labels

function deriveLabels(input: ScoringInput, breakdown: FactorBreakdown): string[] {
  const labels: string[] = [];
  const b = input.business;
  const goodReputation = (b.rating ?? 0) >= 4.3 && (b.reviewCount ?? 0) >= 40;
  const audit = input.audit;

  if (!b.website && goodReputation) labels.push("No website / established business");
  else if (!b.website) labels.push("No website");

  if (audit && goodReputation && audit.scores.overall < 50) {
    labels.push("Great reputation / terrible website");
  }
  if (audit && audit.scores.overall >= 65 && audit.scores.ux < 55) {
    labels.push("Beautiful website / poor conversion");
  }
  if (audit && audit.scores.bestPractices < 45) labels.push("Outdated website");
  if (audit && audit.scores.ux < 50 && !audit.hasCtaAboveFold) {
    labels.push("Mobile-first opportunity");
  }
  if (goodReputation && (b.reviewCount ?? 0) >= 200 && (!b.website || (audit?.scores.overall ?? 0) < 60)) {
    labels.push("Premium business with weak digital presence");
  }
  if (breakdown.contactability.raw >= 75 && breakdown.websiteWeakness.raw >= 60) {
    labels.push("Reachable and worth rebuilding");
  }
  if ((b.reviewCount ?? 0) < 15) labels.push("Thin public evidence");

  return [...new Set(labels)];
}

function deriveTier(
  score: number,
  input: ScoringInput,
  breakdown: FactorBreakdown,
  estimatedValue: number,
): OpportunityTier {
  const reachable = breakdown.contactability.raw >= 45;
  const proven = (input.business.reviewCount ?? 0) >= 30;

  if (score >= 78 && reachable && proven) return "immediate";
  if (estimatedValue >= VALUE_BANDS.premium && score >= 60) return "high-value";
  if (
    score >= 55 &&
    reachable &&
    input.audit != null &&
    input.audit.findingCounts.critical === 0 &&
    input.audit.scores.overall >= 40
  ) {
    return "quick-win";
  }
  if (score >= 45) return "emerging";
  return "low";
}

function estimateValue(input: ScoringInput): number {
  const industry = resolveIndustry(input.business.category);
  let value: number = VALUE_BANDS[industry.valueBand];
  const reviews = input.business.reviewCount ?? 0;
  if (reviews >= 500) value *= 1.5;
  else if (reviews >= 200) value *= 1.25;
  else if (reviews < 25) value *= 0.75;
  if ((input.business.services?.length ?? 0) >= 5) value *= 1.1;
  return Math.round(value / 5000) * 5000;
}

// ------------------------------------------------------------------ entry pt

export function scoreOpportunity(
  input: ScoringInput,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): ScoringResult {
  const w = normaliseWeights(weights);
  const breakdown = {} as FactorBreakdown;
  let total = 0;

  for (const factor of SCORING_FACTORS) {
    const { raw, note } = FACTOR_FNS[factor](input);
    const weight = w[factor];
    const weighted = raw * weight;
    breakdown[factor] = {
      raw: round(raw, 1),
      weight: round(weight, 4),
      weighted: round(weighted, 2),
      note,
    };
    total += weighted;
  }

  const score = clamp(Math.round(total));
  const estimatedValue = estimateValue(input);
  const tier = deriveTier(score, input, breakdown, estimatedValue);

  const ranked = SCORING_FACTORS.map((f) => ({ factor: f, ...breakdown[f] })).sort(
    (a, b) => b.weighted - a.weighted,
  );

  const reasons: OpportunityReason[] = ranked.map((r) => ({
    factor: r.factor,
    direction: r.raw >= 55 ? "positive" : "negative",
    text: `${FACTOR_LABELS[r.factor]}: ${r.note}`,
  }));

  if (input.audit?.isMock) {
    reasons.unshift({
      factor: "context",
      direction: "negative",
      text: "This audit ran against demo data, so the website findings are illustrative rather than observed.",
    });
  }

  return {
    score,
    tier,
    labels: deriveLabels(input, breakdown),
    reasons,
    breakdown,
    contactability: Math.round(breakdown.contactability.raw),
    estimatedValue,
  };
}
