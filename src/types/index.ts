import type { ScoringFactor } from "@/config/scoring";

// ------------------------------------------------------------------ discovery

export type DiscoveryQuery = {
  category: string;
  country: string;
  city: string;
  area?: string | null;
  limit: number;
  minRating?: number | null;
  minReviews?: number | null;
  websiteFilter: "any" | "none" | "poor" | "good";
  keywords?: string | null;
  /** Cursor for providers that paginate. */
  cursor?: string | null;
};

export type BusinessRecord = {
  externalId?: string | null;
  name: string;
  category: string;
  subcategory?: string | null;
  description?: string | null;
  address?: string | null;
  city: string;
  area?: string | null;
  country: string;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  googleUrl?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  linkedin?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  hours?: Record<string, string> | null;
  services?: string[] | null;
  images?: string[] | null;
  logoUrl?: string | null;
};

export type DiscoveryResult = {
  records: BusinessRecord[];
  nextCursor: string | null;
  /** True when the records were synthesised rather than fetched. */
  isMock: boolean;
  providerId: string;
};

// --------------------------------------------------------------------- audit

/** Everything the auditor actually observed. No inference lives in here. */
export type AuditSignals = {
  fetch: {
    url: string;
    finalUrl: string;
    httpStatus: number;
    https: boolean;
    redirected: boolean;
    loadMs: number;
    bytes: number;
    contentType: string | null;
    serverHeader: string | null;
  };
  html: {
    title: string | null;
    titleLength: number;
    metaDescription: string | null;
    metaDescriptionLength: number;
    canonical: string | null;
    lang: string | null;
    charset: string | null;
    viewport: string | null;
    robots: string | null;
    h1: string[];
    h2Count: number;
    headingOrderValid: boolean;
    wordCount: number;
    hasFavicon: boolean;
    hasOpenGraph: boolean;
    hasTwitterCard: boolean;
    hasStructuredData: boolean;
    structuredDataTypes: string[];
    semanticLandmarks: string[];
  };
  media: {
    imageCount: number;
    imagesMissingAlt: number;
    imagesWithoutDimensions: number;
    legacyFormatImages: number;
    largestInlineStyleBytes: number;
  };
  scripts: {
    scriptCount: number;
    inlineScriptBytes: number;
    externalScriptCount: number;
    stylesheetCount: number;
    jqueryDetected: boolean;
    renderBlockingCount: number;
  };
  conversion: {
    phoneLinks: number;
    mailtoLinks: number;
    whatsappLinks: number;
    mapLinks: number;
    formCount: number;
    bookingKeywords: string[];
    ctaCandidates: string[];
    ctaAboveFold: boolean;
    socialLinks: string[];
  };
  accessibility: {
    inputsWithoutLabels: number;
    linksWithoutText: number;
    buttonsWithoutText: number;
    hasSkipLink: boolean;
    tabindexPositive: number;
    ariaLandmarkCount: number;
  };
  platform: {
    generator: string | null;
    detected: string[];
  };
  /** Populated only when a Lighthouse-class engine ran. */
  lighthouse?: {
    performance: number | null;
    accessibility: number | null;
    bestPractices: number | null;
    seo: number | null;
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
    source: string;
  } | null;
};

export type AuditScores = {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  ux: number;
  technical: number;
  overall: number;
};

export type FindingInput = {
  category: "technical" | "ux" | "seo" | "performance" | "accessibility" | "content";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  whatIsWrong: string;
  whyItMatters: string;
  recommendation: string;
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  evidence?: string;
  source?: "heuristic" | "ai" | "lighthouse";
};

export type AuditOutcome = {
  status: "complete" | "failed" | "skipped";
  engine: string;
  isMock: boolean;
  url: string | null;
  signals: AuditSignals | null;
  scores: AuditScores | null;
  findings: FindingInput[];
  error?: { kind: string; message: string; remedy: string } | null;
};

// --------------------------------------------------------------- opportunity

export type OpportunityReason = {
  factor: ScoringFactor | "context";
  direction: "positive" | "negative";
  text: string;
};

export type FactorBreakdown = Record<
  ScoringFactor,
  { raw: number; weight: number; weighted: number; note: string }
>;

export type SalesAngle = {
  whyThisLead: string;
  whatToPitch: string;
  whatNotToSay: string[];
  openingLine: string;
  biggestProblem: string;
  suggestedSolution: string;
  estimatedScope: string;
  suggestedPricing: { low: number; high: number; currency: string; rationale: string };
  recommendedChannel: "email" | "whatsapp" | "instagram" | "linkedin" | "phone";
  /** Verbatim observations from stored data that this angle is grounded in. */
  groundedIn: string[];
};

// ------------------------------------------------------------- website studio

export type WebsiteBrief = {
  positioning: string;
  targetAudience: string;
  primaryGoal: string;
  secondaryGoals: string[];
  brandPersonality: string[];
  colorDirection: string;
  typographyDirection: string;
  designStyle: string;
  pages: { name: string; purpose: string; sections: string[] }[];
  ctaStrategy: string;
  trustElements: string[];
  socialProof: string;
  contentStrategy: string;
  seoStrategy: string;
  animationDirection: string;
  mobileStrategy: string;
  /** Facts we do NOT have and must not invent. Surfaced to the client. */
  requiresClientInput: string[];
  generatedBy: string;
};

export type QualityCheck = {
  id: string;
  group: "build" | "responsive" | "ux" | "accessibility" | "performance" | "seo" | "visual";
  label: string;
  status: "pass" | "fail" | "warn" | "skipped";
  detail: string;
  weight: number;
};

export type QualityReport = {
  score: number;
  checks: QualityCheck[];
  screenshots: { viewport: string; width: number; path: string }[];
  remainingIssues: string[];
  iterations: number;
  generatedAt: string;
};

export type BuildAgentInput = {
  business: BusinessRecord & { id: string };
  audit: { scores: AuditScores | null; findings: FindingInput[] } | null;
  opportunity: { score: number; labels: string[]; reasons: OpportunityReason[] } | null;
  competitors: { name: string; website: string | null; note: string }[];
  websiteBrief: WebsiteBrief;
  designRequirements: string[];
  technicalRequirements: string[];
};

export type BuildAgentResult = {
  status: "complete" | "failed";
  projectPath: string;
  version: number;
  filesChanged: { path: string; bytes: number }[];
  qualityScore: number | null;
  report: QualityReport | null;
  previewUrl: string | null;
  deploymentUrl: string | null;
  remainingIssues: string[];
  error?: string;
};

// ------------------------------------------------------------------ outreach

export type OutreachChannel = "email" | "whatsapp" | "instagram" | "linkedin" | "generic";
export type OutreachVariant =
  | "short"
  | "normal"
  | "detailed"
  | "followup1"
  | "followup2"
  | "final";

export type OutreachDraft = {
  channel: OutreachChannel;
  variant: OutreachVariant;
  subject: string | null;
  body: string;
  observations: string[];
};
