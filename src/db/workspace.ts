import { prisma } from "@/db/client";
import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";

/**
 * The authentication boundary.
 *
 * Real auth is not wired up yet, but every resource in the schema already hangs
 * off a Workspace and every query in the application goes through a context
 * obtained here. Replacing this function with a session lookup is the entire
 * change required to become multi-user - no query needs to be rewritten.
 */

export type WorkspaceContext = {
  workspaceId: string;
  workspaceName: string;
  userId: string | null;
  userName: string | null;
  role: "owner" | "member" | "viewer";
};

let cached: WorkspaceContext | null = null;

export async function getWorkspaceContext(): Promise<WorkspaceContext> {
  if (cached) return cached;

  const workspace = await prisma.workspace.findUnique({
    where: { slug: appConfig.defaultWorkspaceSlug },
    include: { users: { take: 1, orderBy: { createdAt: "asc" } } },
  });

  if (!workspace) {
    throw new AppError({
      kind: "not-found",
      message: `No workspace with slug "${appConfig.defaultWorkspaceSlug}".`,
      remedy: "Run `npm run db:seed` to create the default workspace and demo data.",
    });
  }

  const user = workspace.users[0] ?? null;
  cached = {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    role: (user?.role as WorkspaceContext["role"]) ?? "owner",
  };
  return cached;
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

/** Test hook - clears the memoised context. */
export function resetWorkspaceCache(): void {
  cached = null;
}
