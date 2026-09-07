import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appConfig } from "@/config/app";
import { startJob } from "@/lib/logger";
import { prisma } from "@/db/client";

/**
 * Shared handling for Meta webhooks (WhatsApp and Instagram).
 *
 * Two things matter here and both are easy to get wrong:
 *
 * 1. Verification. Meta sends a GET with hub.verify_token when you register the
 *    endpoint. We compare it against our configured token in constant time and
 *    echo the challenge only on a match.
 *
 * 2. Authenticity. Every POST carries X-Hub-Signature-256, an HMAC of the raw
 *    body keyed by the app secret. Without checking it, anyone who learns the
 *    URL can post fabricated delivery receipts and replies. If META_APP_SECRET
 *    is not configured we reject the payload rather than trusting it - an
 *    unverified webhook is worse than no webhook, because it silently writes
 *    attacker-controlled data into the CRM.
 */

export type VerificationResult =
  | { ok: true; response: NextResponse }
  | { ok: false; response: NextResponse };

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Handles the GET subscription handshake. */
export function verifySubscription(request: Request, expectedToken: string | undefined): VerificationResult {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (!expectedToken) {
    return {
      ok: false,
      response: new NextResponse(
        "Webhook verification token is not configured on this server.",
        { status: 503 },
      ),
    };
  }

  if (mode !== "subscribe" || !token || !challenge || !timingSafeEqual(token, expectedToken)) {
    return { ok: false, response: new NextResponse("Verification failed.", { status: 403 }) };
  }

  // Meta expects the raw challenge echoed back as plain text.
  return { ok: true, response: new NextResponse(challenge, { status: 200 }) };
}

/**
 * Verifies X-Hub-Signature-256 against the raw request body.
 * The body must be the exact bytes Meta sent - re-serialising parsed JSON
 * changes whitespace and key order, and the signature will never match.
 */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = appConfig.whatsapp.appSecret;
  if (!secret || !header) return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  return timingSafeEqual(header, expected);
}

/**
 * Records that we accepted this event, and refuses a second copy of it.
 *
 * Meta retries aggressively - a slow response, a transient 500, or nothing at
 * all can produce the same delivery two or three times. Without this, one
 * inbound reply becomes three rows in a prospect's timeline and, worse, three
 * "they replied!" notifications. The provider's own event id is the key.
 *
 * Also the audit trail: rejected payloads are recorded too, so a stream of
 * signature failures is visible rather than silently dropped.
 */
export async function claimEvent(
  provider: string,
  externalId: string,
  opts: { workspaceId?: string | null; status: "accepted" | "duplicate" | "rejected"; reason?: string; bytes?: number },
): Promise<{ fresh: boolean }> {
  try {
    await prisma.webhookEvent.create({
      data: {
        provider,
        externalId,
        workspaceId: opts.workspaceId ?? null,
        status: opts.status,
        reason: opts.reason ?? null,
        bytes: opts.bytes ?? 0,
      },
    });
    return { fresh: true };
  } catch {
    // The unique constraint on (provider, externalId) is the idempotency
    // check; a conflict means we have seen this exact event before.
    return { fresh: false };
  }
}

/**
 * Rejects a payload whose timestamp is too far from now.
 *
 * A captured-and-replayed webhook is otherwise valid forever: the signature
 * still verifies, because the body has not changed. Five minutes is generous
 * enough for a slow retry and short enough to be worth having.
 */
export function withinReplayWindow(
  timestampSeconds: number | null,
  toleranceMs = 5 * 60 * 1000,
): boolean {
  // Meta does not send a timestamp header on every event type. When there is
  // nothing to check, idempotency is the protection, so this does not reject.
  if (timestampSeconds == null || !Number.isFinite(timestampSeconds)) return true;
  return Math.abs(Date.now() - timestampSeconds * 1000) <= toleranceMs;
}

export type WebhookOutcome = {
  handled: number;
  ignored: number;
  note: string;
};

/**
 * Meta retries a webhook until it receives a 2xx. Errors inside our own
 * processing must therefore still return 200 - otherwise a single malformed
 * event is redelivered indefinitely - while genuine authentication failures
 * return 4xx so misconfiguration is visible rather than silently swallowed.
 */
export function acknowledge(channel: string, outcome: WebhookOutcome): NextResponse {
  const log = startJob(`webhook.${channel}`);
  log.done({ handled: outcome.handled, ignored: outcome.ignored });
  return NextResponse.json({ success: true, data: outcome });
}
