import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import { startJob } from "@/lib/logger";
import type { BuildAgentInput, BuildAgentResult } from "@/types";
import { generateSite, type GeneratedFile } from "./generator";
import { runQualityGate } from "./quality-gate";

/**
 * The website build agent.
 *
 * Contract (see BuildAgentInput / BuildAgentResult): structured brief in,
 * a real project directory plus a quality report out.
 *
 * Two build strategies exist behind this contract:
 *   - "scaffold": the deterministic generator. Always available, produces a
 *     complete static site that runs and deploys. This is what demo mode uses,
 *     and the UI labels it as generated rather than authored by a model.
 *   - "agent": an AI coding agent working against the same project directory.
 *     Enabled when a codeGeneration provider is configured; it starts from the
 *     scaffold output rather than an empty folder, which is both cheaper and
 *     more reliable than asking a model for a site from nothing.
 *
 * Project directories are confined to PROJECTS_ROOT and every path is resolved
 * and checked before it is written, so a generated path can never escape it.
 */

export type BuildStrategy = "scaffold" | "agent";

function projectRoot(slug: string): string {
  // The projects root is configured at runtime, so the bundler cannot resolve
  // it statically. Opting out of tracing here is deliberate: generated sites are
  // data written at runtime, and must never be traced into the server bundle.
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), appConfig.studio.projectsRoot);
  const dir = path.resolve(/*turbopackIgnore: true*/ root, slug);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new AppError({
      kind: "invalid-input",
      message: "Refusing to write outside the projects root.",
      remedy: "The project slug is malformed. Recreate the project.",
    });
  }
  return dir;
}

async function writeFiles(dir: string, files: GeneratedFile[]): Promise<{ path: string; bytes: number }[]> {
  await fs.mkdir(dir, { recursive: true });
  const written: { path: string; bytes: number }[] = [];
  for (const file of files) {
    const target = path.resolve(/*turbopackIgnore: true*/ dir, file.path);
    if (!target.startsWith(dir + path.sep) && target !== path.join(dir, file.path)) {
      throw new AppError({
        kind: "invalid-input",
        message: `Refusing to write ${file.path} - it resolves outside the project directory.`,
        remedy: "This is a bug in the generator; report the file path.",
      });
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
    written.push({ path: file.path, bytes: Buffer.byteLength(file.content, "utf8") });
  }
  return written;
}

export async function buildWebsite(
  slug: string,
  input: BuildAgentInput,
  opts: { strategy: BuildStrategy; version: number; visualQaAvailable: boolean },
): Promise<BuildAgentResult & { files: GeneratedFile[]; log: string }> {
  const log = startJob("website.build", { slug, strategy: opts.strategy, version: opts.version });
  const lines: string[] = [];
  const note = (s: string) => {
    lines.push(`${new Date().toISOString()}  ${s}`);
  };

  try {
    note(`PLAN    strategy=${opts.strategy} stack=static-html version=${opts.version}`);
    note(
      `PLAN    ${input.websiteBrief.pages.length} page(s) planned: ${input.websiteBrief.pages.map((p) => p.name).join(", ")}`,
    );
    note(`PLAN    primary goal: ${input.websiteBrief.primaryGoal}`);
    if (input.audit?.findings.length) {
      note(`PLAN    addressing ${input.audit.findings.length} recorded audit finding(s)`);
    }

    note("IMPLEMENT  generating document, stylesheet and metadata");
    const files = generateSite({
      business: input.business,
      brief: input.websiteBrief,
      watermark: true,
    });

    const dir = projectRoot(slug);
    const written = await writeFiles(dir, files);
    note(`IMPLEMENT  wrote ${written.length} files to ${path.relative(process.cwd(), dir)}`);

    // Archive the exact bytes of this version so a later version can be
    // restored rather than merely described.
    await writeFiles(path.join(dir, ".versions", `v${opts.version}`), files);
    note(`IMPLEMENT  archived version ${opts.version}`);

    note("TEST    running quality gate");
    const report = runQualityGate(files, {
      visualQaAvailable: opts.visualQaAvailable,
      iterations: 1,
    });
    const failed = report.checks.filter((c) => c.status === "fail");
    note(`TEST    ${report.checks.length} checks, ${failed.length} failing, score ${report.score}/100`);
    for (const f of failed) note(`TEST    FAIL ${f.id}: ${f.detail}`);

    if (!opts.visualQaAvailable) {
      note(
        "REVIEW  visual QA skipped - no headless browser plus vision provider configured. Rendered spacing and overflow are unverified.",
      );
    }

    note(`FINALIZE  build complete, quality ${report.score}/100`);
    log.done({ score: report.score, files: written.length });

    return {
      status: "complete",
      projectPath: dir,
      version: opts.version,
      filesChanged: written,
      qualityScore: report.score,
      report,
      previewUrl: `/api/projects/${slug}/preview/index.html`,
      deploymentUrl: null,
      remainingIssues: report.remainingIssues,
      files,
      log: lines.join("\n"),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    note(`FAILED  ${message}`);
    log.fail(e);
    return {
      status: "failed",
      projectPath: projectRoot(slug),
      version: opts.version,
      filesChanged: [],
      qualityScore: null,
      report: null,
      previewUrl: null,
      deploymentUrl: null,
      remainingIssues: [message],
      error: message,
      files: [],
      log: lines.join("\n"),
    };
  }
}

/** Reads a generated file back for the preview route. */
export async function readProjectFile(slug: string, relative: string): Promise<{ content: Buffer; type: string }> {
  const dir = projectRoot(slug);
  const target = path.resolve(/*turbopackIgnore: true*/ dir, relative);
  if (!target.startsWith(dir + path.sep)) {
    throw new AppError({
      kind: "blocked",
      message: "Path traversal blocked.",
      remedy: "Request a file inside the project directory.",
    });
  }
  let content: Buffer;
  try {
    content = await fs.readFile(target);
  } catch {
    throw new AppError({
      kind: "not-found",
      message: `${relative} has not been generated for this project.`,
      remedy: "Run a build first.",
    });
  }
  const ext = path.extname(target).toLowerCase();
  const type =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".svg"
          ? "image/svg+xml"
          : ext === ".xml"
            ? "application/xml"
            : "text/plain; charset=utf-8";
  return { content, type };
}

/** Copies an archived version back over the live project directory. */
export async function restoreArchivedVersion(slug: string, version: number): Promise<string[]> {
  const dir = projectRoot(slug);
  const archive = path.join(dir, ".versions", `v${version}`);
  let entries: string[];
  try {
    entries = await fs.readdir(archive);
  } catch {
    throw new AppError({
      kind: "not-found",
      message: `No archived files for version ${version}.`,
      remedy: "Only versions built by this installation can be restored. Rebuild instead.",
    });
  }
  const restored: string[] = [];
  for (const entry of entries) {
    const content = await fs.readFile(path.join(/*turbopackIgnore: true*/ archive, entry));
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, entry), content);
    restored.push(entry);
  }
  return restored;
}

export { runQualityGate };
