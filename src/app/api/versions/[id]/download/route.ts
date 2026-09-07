import { requireVersionAccess } from "@/lib/authz";
import { fail } from "@/lib/api";
import { assertRate } from "@/lib/rate-limit";
import { packageVersion } from "@/services/website-package";

/**
 * GET /api/versions/:id/download
 *
 * Returns the version as a ZIP.
 *
 * Not wrapped in the JSON envelope, because the body is the archive — a
 * download endpoint that returns base64 inside JSON is a download endpoint
 * nobody can use from a browser. Authorization still runs first, and a version
 * belonging to another workspace is reported as not found rather than
 * forbidden, so this cannot be used to enumerate ids.
 *
 * Every entry name is validated by the ZIP writer, so an archive produced here
 * cannot carry a traversal path even if the generator misbehaved.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { ctx, version } = await requireVersionAccess(id);

    // Packaging reads and deflates every artifact, so it is not free.
    assertRate(`download:${ctx.workspaceId}`, 30, 60_000, "download");

    const { filename, zip } = await packageVersion(ctx.workspaceId, version.id);

    return new Response(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        // The filename is already stripped to a safe character set; quoting it
        // keeps a stray space from truncating the name in some browsers.
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(zip.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    return fail(e);
  }
}
