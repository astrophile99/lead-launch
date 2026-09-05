import { getWorkspaceContext } from "@/db/workspace";
import { fail, ok } from "@/lib/api";
import { getCategoryBreakdown, getFunnel, getOverview } from "@/services/analytics";
import { getSpendSummary } from "@/services/costs";

/**
 * GET /api/analytics
 *
 * Every figure is a count of stored rows. Rates are omitted rather than
 * computed where the denominator is too small to mean anything.
 */
export async function GET() {
  try {
    const { workspaceId } = await getWorkspaceContext();
    const [overview, funnel, categories, spend] = await Promise.all([
      getOverview(workspaceId),
      getFunnel(workspaceId),
      getCategoryBreakdown(workspaceId),
      getSpendSummary(workspaceId),
    ]);
    return ok({ overview, funnel, categories, spend });
  } catch (e) {
    return fail(e);
  }
}
