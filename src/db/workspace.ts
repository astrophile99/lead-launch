import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type WorkspaceContext = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  userName: string;
  role: "owner" | "member" | "viewer";
};

/**
 * Resolve the Lead → Launch workspace from the authenticated Supabase user.
 *
 * Important:
 * - We do NOT trust the workspace slug as the security boundary.
 * - We do NOT take the first user in a workspace.
 * - The Supabase auth identity must map to User.authUserId.
 */
export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: claimsData,
    error: claimsError,
  } = await supabase.auth.getClaims();

  const authUserId = claimsData?.claims?.sub;

  if (claimsError || !authUserId) {
    throw new AppError({
      kind: "unauthorized",
      message: "You must be signed in to access Lead → Launch.",
      remedy: "Sign in and try again.",
    });
  }

  const user = await prisma.user.findUnique({
    where: {
      authUserId,
    },
    include: {
      workspace: true,
    },
  });

  if (!user) {
    throw new AppError({
      kind: "forbidden",
      message: "Your account is not connected to a Lead → Launch workspace.",
      remedy: "Ask the workspace owner to activate your account.",
    });
  }

  return {
    workspaceId: user.workspaceId,
    workspaceName: user.workspace.name,
    userId: user.id,
    userName: user.name,
    role: user.role as WorkspaceContext["role"],
  };
}

/** Throws unless the context may mutate data. */
export function assertCanWrite(ctx: WorkspaceContext): void {
  if (ctx.role === "viewer") {
    throw new AppError({
      kind: "invalid-input",
      message: "This workspace role is read-only.",
      remedy: "Ask an owner to grant you member access.",
    });
  }
}

/**
 * Kept for compatibility with existing callers/tests.
 *
 * Workspace context is now resolved per authenticated request,
 * so there is intentionally no global workspace cache.
 */
export function resetWorkspaceCache(): void {
  // No-op.
}