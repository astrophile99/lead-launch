import { getWorkspaceContext } from "@/db/workspace";
import { fail, ok } from "@/lib/api";
import { getIntegrationGroups, getSetupSteps } from "@/services/integrations";

/**
 * GET /api/integrations
 *
 * Connection state for every concern, plus the setup checklist. Reports only
 * whether a credential is present and what a live check last said - never the
 * credential itself.
 */
export async function GET() {
  try {
    const { workspaceId } = await getWorkspaceContext();
    const [groups, steps] = await Promise.all([
      getIntegrationGroups(workspaceId),
      getSetupSteps(workspaceId),
    ]);
    return ok({ groups, setup: steps });
  } catch (e) {
    return fail(e);
  }
}
