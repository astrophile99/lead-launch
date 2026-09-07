import type { BuildQuality, BuildStrategy } from "@/config/build";
import type { BuildAgentInput, QualityReport } from "@/types";

/**
 * Website builders.
 *
 * There are two, they are genuinely different, and the difference is visible
 * everywhere the output is shown:
 *
 *   scaffold — a deterministic function. It rearranges facts that are already
 *     on the business record into a complete static site. No model is called.
 *     It cannot surprise you, and it cannot write anything better than its
 *     template.
 *
 *   agent — a real model-driven loop. It plans, writes each file, runs the
 *     quality gate over what it wrote, reads the failures, and fixes them, for
 *     as many rounds as the quality mode allows. It costs money and takes
 *     minutes.
 *
 * The previous version of this code accepted `strategy: "agent"` and then ran
 * the deterministic generator anyway. That is the single most dishonest thing
 * a product like this can do, so the strategy a build *ran* is recorded
 * separately from the one it was *asked for*, and the UI shows the former.
 */

export type BuilderFile = { path: string; content: string };

export type BuilderProgress = (event: {
  stage: "plan" | "implement" | "review" | "fix" | "package";
  detail: string;
  iteration: number;
}) => void;

export type BuildContext = {
  workspaceId: string;
  projectId: string;
  slug: string;
  version: number;
  quality: BuildQuality;
  notes: string;
  visualQaAvailable: boolean;
  onProgress?: BuilderProgress;
};

export type BuilderUsage = {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number | null;
  /** Number of model calls actually made. Zero for the scaffold. */
  calls: number;
};

export type BuilderOutcome = {
  status: "complete" | "failed";
  /** What actually ran, which is not always what was requested. */
  strategy: BuildStrategy;
  provider: string;
  model: string;
  files: BuilderFile[];
  report: QualityReport | null;
  qualityScore: number | null;
  iterations: number;
  qaCycles: number;
  usage: BuilderUsage;
  remainingIssues: string[];
  log: string[];
  error?: string;
};

export interface WebsiteBuilder {
  readonly strategy: BuildStrategy;
  readonly label: string;
  /** Whether this builder can run right now, and why not. */
  availability(workspaceId?: string): Promise<{ available: boolean; reason: string }>;
  build(input: BuildAgentInput, ctx: BuildContext): Promise<BuilderOutcome>;
}
