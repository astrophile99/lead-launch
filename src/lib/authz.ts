import { prisma } from "@/db/client";
import { getWorkspaceContext, type WorkspaceContext } from "@/db/workspace";
import { AppError } from "@/lib/errors";

/**
 * Authorization.
 *
 * One place, five functions, used by every server action and every API route.
 * Scattering `where: { workspaceId }` across two hundred call sites is how an
 * IDOR gets shipped: one query forgets the clause and any id becomes readable.
 * These helpers make the check the thing you call to *get* the row, so there is
 * no version of the code that reads a record without having proved access.
 *
 * ## What is and is not enforced today
 *
 * `requireAuth` currently resolves the single seeded workspace, because
 * Supabase Auth is not wired up yet (see README, "Known limits"). That is the
 * one function that changes in the next phase. Everything downstream of it -
 * membership, role and per-record ownership - is real now and does not change.
 *
 * The rule that survives that change: a workspace id supplied by the client is
 * never trusted. It is always derived from the session, and record ids are
 * always checked against it.
 */

export type Role = "owner" | "member" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };

export type AuthContext = WorkspaceContext;

/**
 * The authenticated principal.
 *
 * Until Supabase is connected this returns the seeded workspace owner. It is
 * the single seam the next phase replaces with a session lookup, and it throws
 * rather than returning an anonymous context, so no path can accidentally run
 * unauthenticated.
 */
export async function requireAuth(): Promise<AuthContext> {
  return getWorkspaceContext();
}

/**
 * The caller's workspace.
 *
 * Takes no argument on purpose. A `workspaceId` parameter here would be an
 * invitation to pass one in from a form field, which is exactly the bug this
 * module exists to prevent.
 */
export async function requireWorkspace(): Promise<AuthContext> {
  return requireAuth();
}

export async function requireWorkspaceRole(minimum: Role): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (RANK[ctx.role] < RANK[minimum]) {
    throw new AppError({
      kind: "forbidden",
      message: `This action needs ${minimum} access; your role is ${ctx.role}.`,
      remedy: "Ask an owner of this workspace to grant you access.",
    });
  }
  return ctx;
}

/** Shorthand for "must be able to change something". */
export async function requireWrite(): Promise<AuthContext> {
  return requireWorkspaceRole("member");
}

/* ------------------------------------------------------------ record access */

/**
 * Loads a prospect, or refuses.
 *
 * Deliberately returns `not-found` rather than `forbidden` for a record in
 * another workspace: telling an attacker that an id exists but is not theirs
 * turns this endpoint into an enumeration oracle.
 */
export async function requireProspectAccess(prospectId: string, ctx?: AuthContext) {
  const auth = ctx ?? (await requireAuth());
  if (!prospectId || typeof prospectId !== "string") {
    throw new AppError({
      kind: "invalid-input",
      message: "No prospect was specified.",
      remedy: "Reload the page and try again.",
    });
  }
  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, workspaceId: auth.workspaceId },
    include: { business: true },
  });
  if (!prospect) {
    throw new AppError({
      kind: "not-found",
      message: "Prospect not found.",
      remedy: "Refresh the prospect list — it may have been deleted.",
    });
  }
  return { ctx: auth, prospect };
}

export async function requireProjectAccess(projectId: string, ctx?: AuthContext) {
  const auth = ctx ?? (await requireAuth());
  const project = await prisma.websiteProject.findFirst({
    where: { id: projectId, workspaceId: auth.workspaceId },
    include: { prospect: { include: { business: true } } },
  });
  if (!project) {
    throw new AppError({
      kind: "not-found",
      message: "Website project not found.",
      remedy: "Refresh the Website Studio.",
    });
  }
  return { ctx: auth, project };
}

export async function requireMessageAccess(messageId: string, ctx?: AuthContext) {
  const auth = ctx ?? (await requireAuth());
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId: auth.workspaceId } },
    include: { prospect: { include: { business: true } } },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach queue.",
    });
  }
  return { ctx: auth, message };
}

export async function requireVersionAccess(versionId: string, ctx?: AuthContext) {
  const auth = ctx ?? (await requireAuth());
  const version = await prisma.websiteVersion.findFirst({
    where: { id: versionId, project: { workspaceId: auth.workspaceId } },
    include: { project: { include: { prospect: { include: { business: true } } } } },
  });
  if (!version) {
    throw new AppError({
      kind: "not-found",
      message: "Version not found.",
      remedy: "Refresh the Website Studio.",
    });
  }
  return { ctx: auth, version };
}
