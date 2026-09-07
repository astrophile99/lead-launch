import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import type { GeneratedFile } from "./generator";
import { runQualityGate } from "./quality-gate";

/**
 * Project directory plumbing.
 *
 * This module used to be "the build agent", and it accepted a `strategy`
 * argument that it then ignored — an agent build ran the deterministic
 * generator and reported itself as an agent build. That is gone. Orchestration
 * now lives in `src/services/website-build.ts`, the two real builders live in
 * `src/providers/website-builder/`, and what is left here is what this file was
 * always actually good at: writing bytes to a directory without letting a
 * generated path escape it.
 *
 * The directory is a working copy for the in-app preview. The durable record
 * of a build is the WebsiteArtifact rows plus the storage provider.
 */

function projectRoot(slug: string): string {
  // The projects root is configured at runtime, so the bundler cannot resolve
  // it statically. Opting out of tracing here is deliberate: generated sites
  // are data written at runtime and must never enter the server bundle.
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

/** Writes generated files, refusing any path that resolves outside `dir`. */
export async function writeProjectFiles(
  slug: string,
  files: GeneratedFile[],
): Promise<{ path: string; bytes: number }[]> {
  const dir = projectRoot(slug);
  await fs.mkdir(dir, { recursive: true });

  const written: { path: string; bytes: number }[] = [];
  for (const file of files) {
    const target = path.resolve(/*turbopackIgnore: true*/ dir, file.path);
    if (target !== dir && !target.startsWith(dir + path.sep)) {
      throw new AppError({
        kind: "blocked",
        message: `Refusing to write ${file.path} — it resolves outside the project directory.`,
        remedy: "This is a bug in the generator; report the file path.",
      });
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
    written.push({ path: file.path, bytes: Buffer.byteLength(file.content, "utf8") });
  }
  return written;
}

/** Reads a generated file back for the preview route. */
export async function readProjectFile(
  slug: string,
  relative: string,
): Promise<{ content: Buffer; type: string }> {
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
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".svg"
            ? "image/svg+xml"
            : ext === ".xml"
              ? "application/xml"
              : "text/plain; charset=utf-8";
  return { content, type };
}

/**
 * Restores a stored version over the working directory.
 *
 * Reads from the artifact store rather than a `.versions` folder on disk, so a
 * restore works on a host whose filesystem did not survive the last deploy.
 */
export async function restoreFiles(
  slug: string,
  files: { path: string; content: string }[],
): Promise<string[]> {
  const written = await writeProjectFiles(slug, files);
  return written.map((f) => f.path);
}

export { runQualityGate };
export type { GeneratedFile };
