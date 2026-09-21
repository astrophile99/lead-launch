import { cache } from "react";
import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type WorkspaceContext = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  userName: string;
  /** Carried here so the chrome does not need a second query for it. */
  userEmail: string;
  role: "owner" | "member" | "viewer";
};

/**
 * Resolve the Lead → Launch workspace from the authenticated Supabase user.
 *
 * Important:
 * - We do NOT trust the workspace slug as the security boundary.
 * - We do NOT take the first user in a workspace.
 * - The Supabase auth identity must map to User.authUserId.
 *
 * Memoized for one request with React `cache()`. A single navigation used to
 * resolve this three times - once in the layout, once for the chrome, once in
 * the page - and each resolution meant a JWKS fetch plus a user/workspace
 * join. The memo is request-scoped: it is created and discarded with the
 * render, so two users can never observe each other's context, and there is
 * deliberately no cache keyed on anything a client could supply.
 *
 * What is *not* cached is the decision itself. The first call in a request
 * still verifies the caller's token and still fails closed; later calls in the
 * same render reuse that verified answer rather than re-deriving it.
 */
export const getWorkspaceContext = cache(async function getWorkspaceContext(): Promise<WorkspaceContext> {
  const supabase = await createSupabaseServerClient();

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  const authUserId = claimsError ? null : claimsData?.claims?.sub;

  if (!authUserId) {
    throw new AppError({
      kind: "forbidden",
      message: "You must be signed in to access Lead → Launch.",
      remedy: "Sign in and try again.",
    });
  }

  const user = await prisma.user.findUnique({
    where: {
      authUserId,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      workspaceId: true,
      workspace: { select: { name: true } },
    },
  });

  if (!user) {
    throw new AppError({
      kind: "forbidden",
      message:
        "Your account is not connected to a Lead → Launch workspace.",
      remedy: "Ask the workspace owner to activate your account.",
    });
  }

  return {
    workspaceId: user.workspaceId,
    workspaceName: user.workspace.name,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    role: user.role as WorkspaceContext["role"],
  };
});

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