import { getWorkspaceContext } from "@/db/workspace";
import { fail, ok } from "@/lib/api";
import { jobCounts, listJobs, type JobKind } from "@/services/jobs";

const KINDS: JobKind[] = ["discovery", "audit", "ai", "build", "deployment", "outreach"];

/**
 * GET /api/jobs
 *
 * The unified job feed. The UI polls this today; the shape is deliberately
 * serialisable so the same rows can later arrive over SSE or Realtime without
 * the client changing.
 */
export async function GET(request: Request) {
  try {
    const { workspaceId } = await getWorkspaceContext();
    const url = new URL(request.url);

    const requested = (url.searchParams.get("kinds") ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter((k): k is JobKind => KINDS.includes(k as JobKind));

    const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "40", 10) || 40));

    const [jobs, counts] = await Promise.all([
      listJobs(workspaceId, { limit, kinds: requested.length ? requested : undefined }),
      jobCounts(workspaceId),
    ]);

    return ok({ jobs, counts });
  } catch (e) {
    return fail(e);
  }
}
