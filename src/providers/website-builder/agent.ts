import { BUILD_QUALITY } from "@/config/build";
import type { AIProviderId } from "@/config/ai";
import { modelSpec } from "@/config/ai";
import { getAIProvider } from "@/providers/ai/router";
import { runQualityGate } from "@/agents/website-builder/quality-gate";
import { generateSite } from "@/agents/website-builder/generator";
import { jsonParser, runAIJob } from "@/services/ai-jobs";
import { AppError } from "@/lib/errors";
import type { BuildAgentInput, QualityCheck } from "@/types";
import type { BuildContext, BuilderFile, BuilderOutcome, WebsiteBuilder } from "./types";

/**
 * The AI build agent.
 *
 * A real loop, not a label on a template:
 *
 *   1. PLAN      — the model turns the brief into a file manifest and a written
 *                  approach, and must justify each file.
 *   2. IMPLEMENT — one call per file, given the plan, the grounded facts and
 *                  the files already written.
 *   3. REVIEW    — the deterministic quality gate runs over what was actually
 *                  written, and (above `fast`) a codeReview model call critiques
 *                  it against the brief.
 *   4. FIX       — the failures from step 3 are fed back and the model rewrites
 *                  only the files it needs to. Repeat while the gate is below
 *                  threshold and iterations remain.
 *
 * What it is not allowed to do:
 *
 *   - invent a fact. The facts block is the only permitted source of specifics,
 *     and anything unknown must be written as `[CLIENT TO CONFIRM]`.
 *   - run shell commands. Nothing here executes model output; files are written
 *     as data and never evaluated. "Never trust AI-generated shell commands" is
 *     enforced by there being no code path that could run one.
 *   - escape the file manifest. Paths are validated against an allow-list of
 *     extensions and rejected if they traverse.
 */

const ALLOWED_EXTENSIONS = new Set([".html", ".css", ".js", ".json", ".txt", ".xml", ".svg", ".md"]);
const MAX_FILES = 14;

function validatePath(raw: string): string {
  const path = raw.trim().replace(/^\.?\//, "");
  const bad =
    !path ||
    path.length > 100 ||
    path.includes("\\") ||
    path.includes("..") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    !ALLOWED_EXTENSIONS.has(path.slice(path.lastIndexOf(".")).toLowerCase());
  if (bad) {
    throw new AppError({
      kind: "provider-error",
      message: `The model asked for a file path this build will not write: "${raw}".`,
      remedy: "Retry the build. If it repeats, use a different model for code generation.",
      retryable: true,
    });
  }
  return path;
}

const PLAN_SYSTEM = `You are a senior front-end engineer planning a static marketing website for a local business.

Output a file manifest and an approach. Constraints:
- Plain HTML and CSS only. No build step, no framework, no external requests of any kind.
- index.html and styles.css are mandatory. At most 12 files in total.
- Every claim on the site must come from the supplied facts. Anything you would like to say but were
  not given must be written literally as [CLIENT TO CONFIRM], never guessed.
- No stock photography, no lorem ipsum, no invented testimonials, awards, statistics or client names.

Return JSON: { "approach": string, "files": [{ "path": string, "purpose": string }] }`;

const FILE_SYSTEM = `You are writing one file of a static marketing website. Return the complete file contents and nothing else — no markdown fence, no commentary, no explanation.

Hard rules:
- Only facts from <facts> may appear. Unknown facts are written as [CLIENT TO CONFIRM].
- Mobile-first CSS. Semantic landmarks, labelled inputs, visible :focus-visible styles.
- One accent colour, used only for actions. A real type scale. No decorative gradients.
- Motion only inside a prefers-reduced-motion guard.
- No external stylesheets, fonts, scripts, images or trackers. Everything is self-contained.
- No inline event handlers, no eval, no document.write.`;

const REVIEW_SYSTEM = `You are reviewing a generated static website against its brief. Be specific and short.

Return JSON: { "issues": [{ "path": string, "severity": "high"|"medium"|"low", "problem": string, "fix": string }] }
Report only problems you can point at in the supplied code. Do not invent issues to seem thorough.
If the site is genuinely fine, return an empty array.`;

function factsFor(input: BuildAgentInput): string {
  return JSON.stringify(
    {
      business: {
        name: input.business.name,
        category: input.business.category,
        subcategory: input.business.subcategory,
        description: input.business.description,
        address: input.business.address,
        city: input.business.city,
        area: input.business.area,
        phone: input.business.phone,
        email: input.business.email,
        website: input.business.website,
        rating: input.business.rating,
        reviewCount: input.business.reviewCount,
        hours: input.business.hours,
        services: input.business.services,
      },
      brief: input.websiteBrief,
      auditFindings:
        input.audit?.findings.slice(0, 8).map((f) => ({
          title: f.title,
          problem: f.whatIsWrong,
          fix: f.recommendation,
        })) ?? [],
      designRequirements: input.designRequirements,
      technicalRequirements: input.technicalRequirements,
      mustNotInvent: input.websiteBrief.requiresClientInput,
    },
    null,
    2,
  );
}

/** Strips a markdown fence if the model wrapped the file in one anyway. */
function unfence(text: string): string {
  const fenced = text.match(/^\s*```[a-z]*\n([\s\S]*?)\n?```\s*$/i);
  return (fenced ? fenced[1] : text).trim();
}

export class AgentBuilder implements WebsiteBuilder {
  readonly strategy = "agent" as const;
  readonly label = "AI build agent";

  constructor(private readonly choice: { provider: AIProviderId; model: string }) {}

  async availability(): Promise<{ available: boolean; reason: string }> {
    const spec = modelSpec(this.choice.provider, this.choice.model);
    if (!spec) {
      return {
        available: false,
        reason: `"${this.choice.model}" is not in the catalogue for ${this.choice.provider}.`,
      };
    }
    if (!spec.supports.includes("codeGeneration")) {
      return { available: false, reason: `${spec.label} is not rated for code generation.` };
    }
    const provider = getAIProvider(this.choice.provider);
    if (!provider.isConfigured()) {
      return {
        available: false,
        reason: `${provider.label} has no API key on this server, so the agent cannot run.`,
      };
    }
    return { available: true, reason: `${spec.label} is configured and ready.` };
  }

  async build(input: BuildAgentInput, ctx: BuildContext): Promise<BuilderOutcome> {
    const spec = BUILD_QUALITY[ctx.quality];
    const log: string[] = [];
    const note = (s: string) => log.push(s);
    const usage = { tokensIn: 0, tokensOut: 0, tokensCached: 0, costUsd: 0, calls: 0 };
    let priced = false;

    const account = (o: {
      tokensIn: number | null;
      tokensOut: number | null;
      costUsd: number | null;
    }) => {
      usage.calls += 1;
      usage.tokensIn += o.tokensIn ?? 0;
      usage.tokensOut += o.tokensOut ?? 0;
      if (o.costUsd != null) {
        usage.costUsd += o.costUsd;
        priced = true;
      }
    };

    const job = <T>(type: string, capability: "codeGeneration" | "codeReview", opts: {
      system: string;
      user: string;
      parse: (raw: string) => T;
      maxTokens?: number;
    }) =>
      runAIJob<T>({
        workspaceId: ctx.workspaceId,
        type,
        capability,
        entityType: "project",
        entityId: ctx.projectId,
        projectId: ctx.projectId,
        route: this.choice,
        inputSummary: { business: input.business.name, quality: ctx.quality, version: ctx.version },
        request: {
          system: opts.system,
          json: type.endsWith("plan") || type.endsWith("review"),
          temperature: 0.4,
          maxTokens: opts.maxTokens ?? spec.maxOutputTokens,
          messages: [{ role: "user", content: opts.user }],
        },
        parse: opts.parse,
        maxAttempts: 2,
      });

    const facts = factsFor(input);
    const direction = ctx.notes.trim()
      ? `\n\nAdditional direction from the operator:\n${ctx.notes.trim()}`
      : "";

    try {
      /* ------------------------------------------------------------ plan */
      ctx.onProgress?.({ stage: "plan", detail: "Planning the file structure", iteration: 1 });
      const plan = await job<{ approach: string; files: { path: string; purpose: string }[] }>(
        "website.build.plan",
        "codeGeneration",
        {
          system: PLAN_SYSTEM,
          user: `Plan the site.\n\n<facts>\n${facts}\n</facts>${direction}`,
          maxTokens: 2_000,
          parse: jsonParser((v) => {
            const o = v as Record<string, unknown>;
            const raw = Array.isArray(o.files) ? o.files : [];
            const files = raw
              .slice(0, MAX_FILES)
              .map((f) => f as { path?: unknown; purpose?: unknown })
              .filter((f) => typeof f.path === "string")
              .map((f) => ({
                path: validatePath(f.path as string),
                purpose: typeof f.purpose === "string" ? f.purpose : "",
              }));
            if (!files.some((f) => f.path === "index.html")) {
              files.unshift({ path: "index.html", purpose: "Home page" });
            }
            if (!files.some((f) => f.path.endsWith(".css"))) {
              files.push({ path: "styles.css", purpose: "Stylesheet" });
            }
            return {
              approach: typeof o.approach === "string" ? o.approach : "",
              files,
            };
          }),
        },
      );
      account(plan);
      note(`PLAN      ${plan.provider}/${plan.model} planned ${plan.value.files.length} file(s)`);
      for (const f of plan.value.files) note(`PLAN      ${f.path} — ${f.purpose}`);
      if (plan.isMock) {
        // The route degraded. Say so loudly rather than reporting an agent run.
        throw new AppError({
          kind: "not-configured",
          message: `The chosen model did not run: ${plan.degradedReason ?? "no configured provider."}`,
          remedy: "Pick a provider with a key, or build with the deterministic scaffold.",
        });
      }

      /* ------------------------------------------------------- implement */
      const files: BuilderFile[] = [];
      for (const [i, entry] of plan.value.files.entries()) {
        ctx.onProgress?.({
          stage: "implement",
          detail: `Writing ${entry.path} (${i + 1} of ${plan.value.files.length})`,
          iteration: 1,
        });
        const written = await job<string>("website.build.file", "codeGeneration", {
          system: FILE_SYSTEM,
          user: [
            `Write \`${entry.path}\`. Purpose: ${entry.purpose}`,
            `Overall approach: ${plan.value.approach}`,
            `Other files in this site: ${plan.value.files.map((f) => f.path).join(", ")}`,
            files.length
              ? `Already written, for consistency:\n${files
                  .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 4_000)}`)
                  .join("\n\n")}`
              : "",
            `<facts>\n${facts}\n</facts>${direction}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          parse: (raw) => {
            const content = unfence(raw);
            if (content.length < 40) {
              throw new AppError({
                kind: "provider-error",
                message: `The model returned an almost empty ${entry.path}.`,
                remedy: "Retry the build, or choose a stronger model.",
                retryable: true,
              });
            }
            return content;
          },
        });
        account(written);
        files.push({ path: entry.path, content: written.value });
        note(`IMPLEMENT ${entry.path} — ${Buffer.byteLength(written.value, "utf8")} bytes`);
      }

      /* -------------------------------------------------- review and fix */
      let report = runQualityGate(files, {
        visualQaAvailable: ctx.visualQaAvailable,
        iterations: 1,
      });
      let iteration = 1;
      let qaCycles = 1;
      note(`REVIEW    gate ${report.score}/100 after the first pass`);

      while (iteration < spec.maxIterations && report.score < spec.gateThreshold) {
        const failures: QualityCheck[] = report.checks.filter((c) => c.status === "fail");
        if (failures.length === 0) break;

        let critique = "";
        if (spec.runCodeReview) {
          ctx.onProgress?.({ stage: "review", detail: "Reviewing the code", iteration });
          const reviewed = await job<{ issues: { path: string; problem: string; fix: string }[] }>(
            "website.build.review",
            "codeReview",
            {
              system: REVIEW_SYSTEM,
              user: `Review this site against its brief.\n\n${files
                .map((f) => `--- ${f.path} ---\n${f.content.slice(0, 6_000)}`)
                .join("\n\n")}\n\n<facts>\n${facts}\n</facts>`,
              maxTokens: 2_500,
              parse: jsonParser((v) => {
                const o = v as { issues?: unknown };
                const issues = Array.isArray(o.issues) ? o.issues : [];
                return {
                  issues: issues
                    .map((x) => x as Record<string, unknown>)
                    .filter((x) => typeof x.problem === "string")
                    .slice(0, 10)
                    .map((x) => ({
                      path: typeof x.path === "string" ? x.path : "index.html",
                      problem: String(x.problem),
                      fix: typeof x.fix === "string" ? x.fix : "",
                    })),
                };
              }),
            },
          );
          account(reviewed);
          qaCycles += 1;
          critique = reviewed.value.issues
            .map((i) => `- ${i.path}: ${i.problem} → ${i.fix}`)
            .join("\n");
          note(`REVIEW    model raised ${reviewed.value.issues.length} issue(s)`);
        }

        iteration += 1;
        ctx.onProgress?.({ stage: "fix", detail: "Applying fixes", iteration });

        // Only rewrite the files the failures actually name. Regenerating
        // everything each round is how iterative AI editing makes a site worse.
        const targets = new Set<string>(["index.html"]);
        for (const f of failures) {
          if (f.group === "responsive" || f.id.includes("css")) {
            const css = files.find((x) => x.path.endsWith(".css"));
            if (css) targets.add(css.path);
          }
        }
        for (const line of critique.split("\n")) {
          const named = files.find((f) => line.includes(f.path));
          if (named) targets.add(named.path);
        }

        for (const path of targets) {
          const current = files.find((f) => f.path === path);
          if (!current) continue;
          const fixed = await job<string>("website.build.fix", "codeGeneration", {
            system: FILE_SYSTEM,
            user: [
              `Rewrite \`${path}\` to fix the problems below. Keep everything that already works.`,
              `Automated checks that failed:\n${failures.map((f) => `- ${f.label}: ${f.detail}`).join("\n")}`,
              critique ? `Review notes:\n${critique}` : "",
              `Current contents:\n${current.content}`,
              `<facts>\n${facts}\n</facts>`,
            ]
              .filter(Boolean)
              .join("\n\n"),
            parse: (raw) => {
              const content = unfence(raw);
              if (content.length < 40) {
                throw new AppError({
                  kind: "provider-error",
                  message: `The fix pass returned an almost empty ${path}.`,
                  remedy: "Retry the build.",
                  retryable: true,
                });
              }
              return content;
            },
          });
          account(fixed);
          current.content = fixed.value;
          note(`FIX       rewrote ${path} (round ${iteration})`);
        }

        report = runQualityGate(files, {
          visualQaAvailable: ctx.visualQaAvailable,
          iterations: iteration,
        });
        qaCycles += 1;
        note(`REVIEW    gate ${report.score}/100 after round ${iteration}`);
      }

      if (report.score < spec.gateThreshold) {
        note(
          `REVIEW    finished at ${report.score}/100, below the ${spec.gateThreshold} bar for ${spec.label}. The outstanding issues are listed on the version.`,
        );
      }
      if (!ctx.visualQaAvailable) {
        note(
          "REVIEW    visual checks skipped — no headless browser is bundled, so rendered spacing and overflow are unverified.",
        );
      }
      note(
        `FINALIZE  ${usage.calls} model call(s), ${usage.tokensIn} in / ${usage.tokensOut} out tokens.`,
      );

      return {
        status: "complete",
        strategy: "agent",
        provider: plan.provider,
        model: plan.model,
        files,
        report,
        qualityScore: report.score,
        iterations: iteration,
        qaCycles,
        usage: { ...usage, costUsd: priced ? usage.costUsd : null },
        remainingIssues: report.remainingIssues,
        log,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      note(`FAILED    ${message}`);
      return {
        status: "failed",
        strategy: "agent",
        provider: this.choice.provider,
        model: this.choice.model,
        files: [],
        report: null,
        qualityScore: null,
        iterations: 0,
        qaCycles: 0,
        usage: { ...usage, costUsd: priced ? usage.costUsd : null },
        remainingIssues: [message],
        log,
        error: message,
      };
    }
  }
}

/** Re-exported so the scaffold and the agent share one generator import path. */
export { generateSite };
