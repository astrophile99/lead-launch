import { getWorkspaceContext } from "@/db/workspace";
import { fail, ok, paging } from "@/lib/api";
import { listProspects, parseFilters } from "@/services/prospects";
import type { ProspectSort } from "@/services/prospects";

const SORTS: ProspectSort[] = [
  "opportunity",
  "website",
  "rating",
  "reviews",
  "name",
  "recent",
  "value",
];

/**
 * GET /api/prospects
 *
 * Paged, filtered prospect list. Same service the UI uses, so the two can never
 * disagree about what a filter means.
 */
export async function GET(request: Request) {
  try {
    const { workspaceId } = await getWorkspaceContext();
    const url = new URL(request.url);
    const { page, pageSize } = paging(url);

    const filters = parseFilters(Object.fromEntries(url.searchParams.entries()));
    const sortParam = url.searchParams.get("sort") ?? "";
    const sort = SORTS.includes(sortParam as ProspectSort)
      ? (sortParam as ProspectSort)
      : "opportunity";

    const result = await listProspects(workspaceId, { filters, sort, page, pageSize });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
