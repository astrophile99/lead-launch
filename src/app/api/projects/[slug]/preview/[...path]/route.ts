import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { AppError, HTTP_STATUS_BY_KIND } from "@/lib/errors";
import { readProjectFile } from "@/agents/website-builder";

/**
 * Serves the real generated files from a project's directory so the Studio
 * preview shows the actual build rather than a screenshot. The slug is checked
 * against the caller's workspace before anything is read, and path traversal is
 * rejected inside readProjectFile.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  const { slug, path } = await params;

  try {
    const { workspaceId } = await getWorkspaceContext();
    const project = await prisma.websiteProject.findFirst({
      where: { workspaceId, slug },
      select: { id: true },
    });
    if (!project) {
      throw new AppError({
        kind: "not-found",
        message: "No such project in this workspace.",
        remedy: "Open the project from the Website Studio.",
      });
    }

    const relative = (path ?? []).join("/") || "index.html";
    const file = await readProjectFile(slug, relative);

    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        "content-type": file.type,
        "cache-control": "no-store",
        // The preview is untrusted generated markup: keep it sandboxed.
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline' 'self'; img-src 'self' data:; font-src 'self' data:; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    const err =
      e instanceof AppError
        ? e
        : new AppError({
            kind: "internal",
            message: e instanceof Error ? e.message : "Preview failed.",
            remedy: "Rebuild the project.",
          });
    return NextResponse.json({ error: err.toJSON() }, { status: HTTP_STATUS_BY_KIND[err.kind] });
  }
}
