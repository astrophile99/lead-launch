import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";

/**
 * OAuth 2.0 authorization-code flow with PKCE.
 *
 * Two things this must get right, both of which are commonly skipped:
 *
 *   state — a random, single-use value stored server-side and compared on the
 *     way back. Without it, an attacker can complete their own authorisation in
 *     a victim's session and end up with their own mailbox connected to the
 *     victim's workspace (login CSRF), which is worse than it sounds: every
 *     message the victim then "sends" goes out from the attacker's account.
 *
 *   PKCE — a per-request secret whose hash is sent up front and whose plaintext
 *     is sent at exchange. It stops an intercepted authorisation code from
 *     being redeemed by anyone but this server. Google recommends it for
 *     confidential clients too, and there is no reason to skip it.
 *
 * Rows are single-use (`usedAt`) and expire in ten minutes.
 */

const TTL_MS = 10 * 60 * 1000;

export type PendingAuth = { state: string; codeChallenge: string };

export async function beginOAuth(
  provider: string,
  workspaceId: string,
  redirectTo: string | null,
): Promise<PendingAuth> {
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  await prisma.oAuthState.create({
    data: {
      provider,
      state,
      codeVerifier,
      workspaceId,
      redirectTo,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });

  // Opportunistic cleanup; these rows are worthless once expired.
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  return { state, codeChallenge };
}

/** Consumes a state value, or refuses. Never succeeds twice for one state. */
export async function consumeOAuthState(
  provider: string,
  state: string | null,
): Promise<{ workspaceId: string; codeVerifier: string; redirectTo: string | null }> {
  const reject = (): never => {
    throw new AppError({
      kind: "forbidden",
      // Deliberately one message for every failure mode. Distinguishing
      // "expired" from "unknown" from "already used" tells an attacker which
      // half of their guess was right.
      message: "This authorisation link is not valid.",
      remedy: "Start the connection again from Settings.",
    });
  };

  if (!state) reject();

  const row = await prisma.oAuthState.findUnique({ where: { state: state! } });
  if (!row || row.provider !== provider || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    reject();
  }

  await prisma.oAuthState.update({
    where: { id: row!.id },
    data: { usedAt: new Date() },
  });

  return {
    workspaceId: row!.workspaceId,
    codeVerifier: row!.codeVerifier,
    redirectTo: row!.redirectTo,
  };
}
