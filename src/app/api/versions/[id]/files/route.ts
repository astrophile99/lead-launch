import { requireVersionAccess } from "@/lib/authz";
import { fail, ok } from "@/lib/api";
import { listVersionFiles } from "@/services/website-package";

/**
 * GET /api/versions/:id/files
 *
 * The manifest for one version: path, size, content type and content hash.
 * Deliberately does not return file bodies — the Studio lists files, and the
 * ZIP is how you get the bytes.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { ctx, version } = await requireVersionAccess(id);
    const files = await listVersionFiles(ctx.workspaceId, version.id);
    return ok({
      versionId: version.id,
      version: version.version,
      approval: version.approval,
      files,
      totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    });
  } catch (e) {
    return fail(e);
  }
}
