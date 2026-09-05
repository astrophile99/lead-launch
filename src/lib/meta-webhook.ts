import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appConfig } from "@/config/app";
import { startJob } from "@/lib/logger";

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
