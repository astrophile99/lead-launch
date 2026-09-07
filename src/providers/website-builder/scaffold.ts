import { BUILD_QUALITY } from "@/config/build";
import { generateSite } from "@/agents/website-builder/generator";
import { runQualityGate } from "@/agents/website-builder/quality-gate";
import type { BuildAgentInput } from "@/types";
import type { BuildContext, BuilderOutcome, WebsiteBuilder } from "./types";

/**
 * The deterministic scaffold.
 *
 * Calls no model. It reads the brief and the business record and lays them out
 * — which means it can never invent a testimonial, and equally that it can
 * never write anything the template did not anticipate. Both halves of that
 * trade are stated in the UI.
 *
 * Always available, which is what makes it the honest fallback when a build
 * was requested with a provider that turns out to have no key: the operator is
 * told the agent did not run, and gets a real site rather than an error.
 */
export class ScaffoldBuilder implements WebsiteBuilder {
  readonly strategy = "scaffold" as const;
  readonly label = "Deterministic scaffold";

  async availability(): Promise<{ available: boolean; reason: string }> {
    return { available: true, reason: "No credentials required." };
  }

  async build(input: BuildAgentInput, ctx: BuildContext): Promise<BuilderOutcome> {
    const log: string[] = [];
    const note = (stage: BuilderOutcome["log"] extends unknown ? string : string) => log.push(stage);

    note(
      `PLAN      deterministic scaffold, ${input.websiteBrief.pages.length} page(s): ${input.websiteBrief.pages
        .map((p) => p.name)
        .join(", ")}`,
    );
    note(`PLAN      primary goal: ${input.websiteBrief.primaryGoal}`);
    if (input.audit?.findings.length) {
      note(`PLAN      ${input.audit.findings.length} recorded audit finding(s) informed the layout`);
    }
    ctx.onProgress?.({ stage: "plan", detail: "Reading the brief", iteration: 1 });

    ctx.onProgress?.({ stage: "implement", detail: "Laying out the document", iteration: 1 });
    const files = generateSite({
      business: input.business,
      brief: input.websiteBrief,
      watermark: true,
    });
    note(`IMPLEMENT ${files.length} file(s) produced from stored facts. No model was called.`);

    ctx.onProgress?.({ stage: "review", detail: "Running the quality gate", iteration: 1 });
    const report = runQualityGate(files, {
      visualQaAvailable: ctx.visualQaAvailable,
      iterations: 1,
    });
    const failed = report.checks.filter((c) => c.status === "fail");
    note(`REVIEW    ${report.checks.length} checks, ${failed.length} failing, score ${report.score}/100`);
    for (const f of failed) note(`REVIEW    FAIL ${f.id}: ${f.detail}`);
    if (!ctx.visualQaAvailable) {
      note(
        "REVIEW    visual checks skipped — no headless browser is bundled, so rendered spacing and overflow are unverified.",
      );
    }
    note(
      `FINALIZE  scaffold complete at ${report.score}/100 (gate for ${ctx.quality} is ${BUILD_QUALITY[ctx.quality].gateThreshold}).`,
    );

    return {
      status: "complete",
      strategy: "scaffold",
      provider: "builtin-scaffold",
      model: "deterministic-generator",
      files,
      report,
      qualityScore: report.score,
      iterations: 1,
      qaCycles: 1,
      usage: { tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, calls: 0 },
      remainingIssues: report.remainingIssues,
      log,
    };
  }
}
