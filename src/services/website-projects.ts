import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { fromJson } from "@/lib/json";
import { restoreFiles } from "@/agents/website-builder";
import { readArtifacts } from "./website-package";
import type { QualityReport, WebsiteBrief } from "@/types";
import { logActivity } from "./activity";

/**
 * Project reads and version restore.
 *
 * Build orchestration lives in `website-build.ts`; this file only reads
 * projects and moves stored versions back into the working directory. Versions
 * are never overwritten, because iterative AI edits regularly make a site worse
 * and the operator must be able to go back to the one that was fine.
 */

export async function getProject(workspaceId: string, projectId: string) {
  const project = await prisma.websiteProject.findFirst({
    where: { id: projectId, workspaceId },
    include: {
      prospect: { include: { business: true } },
      versions: { orderBy: { version: "desc" } },
      builds: { orderBy: { startedAt: "desc" }, take: 10 },
      deployments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) return null;
  return {
    ...project,
    brief: fromJson<WebsiteBrief | null>(project.briefJson, null),
    versionReports: new Map(
      project.versions.map((v) => [v.id, fromJson<QualityReport | null>(v.reportJson, null)]),
    ),
  };
}

export async function restoreVersion(workspaceId: string, projectId: string, versionId: string) {
  const version = await prisma.websiteVersion.findFirst({
    where: { id: versionId, project: { workspaceId, id: projectId } },
    include: { project: true },
  });
  if (!version) {
    throw new AppError({
      kind: "not-found",
      message: "Version not found.",
      remedy: "Reload the Website Studio.",
    });
  }
  const files = await readArtifacts(version.id);
  if (files.length === 0) {
    throw new AppError({
      kind: "not-found",
      message: `Version ${version.version} has no stored files to restore.`,
      remedy:
        "It predates artifact storage. Build a new version instead — nothing was lost from the versions that do have artifacts.",
    });
  }
  const restored = await restoreFiles(version.project.slug, files);

  await prisma.websiteProject.update({
    where: { id: projectId },
    data: { status: "ready" },
  });
  await logActivity({
    workspaceId,
    prospectId: version.project.prospectId,
    type: "build.completed",
    message: `Restored website v${version.version} (${restored.length} files).`,
    meta: { projectId, versionId, restored },
  });

  return { version: version.version, files: restored };
}
