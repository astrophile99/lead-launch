import { NextResponse } from "next/server";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import {
  acknowledge,
  claimEvent,
  verifySignature,
  verifySubscription,
  withinReplayWindow,
} from "@/lib/meta-webhook";
import { checkRate } from "@/lib/rate-limit";
import { sha256 } from "@/lib/crypto";
import { startJob } from "@/lib/logger";

/**
 * Instagram messaging webhook.
 *
 * Inbound messages matter more here than on any other channel: a reply is the
 * only thing that opens a conversation Instagram will let us answer at all.
 * Each one records or refreshes an InstagramConversation, which is what the
 * eligibility check reads before allowing a send.
 *
 * The same rule as WhatsApp applies - no valid signature, no write.
 */

type MessagingEntry = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

type Payload = {
  entry?: { id?: string; time?: number; messaging?: MessagingEntry[] }[];
};

/** Meta's messaging window for a human-initiated conversation. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const account = await prisma.instagramAccount.findFirst({ select: { id: true } });
  void account;
  return verifySubscription(request, appConfig.instagram.webhookVerifyToken).response;
}

export async function POST(request: Request) {
  const log = startJob("webhook.instagram.receive");

  // Rate limit before any work. This endpoint is public by necessity, so an
  // unauthenticated flood must cost a map lookup rather than an HMAC and a
  // database round trip.
  const rate = checkRate("webhook:instagram", 300, 60_000);
  if (!rate.ok) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "rate-limited",
          message: "Too many webhook deliveries.",
          remedy: "Meta should back off and retry.",
          retryable: true,
        },
      },
      { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
    );
  }

  const raw = await request.text();
  if (raw.length > 1_000_000) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "invalid-input",
          message: "Webhook payload too large.",
          remedy: "This is not a payload Meta sends.",
          retryable: false,
        },
      },
      { status: 413 },
    );
  }

  if (!appConfig.whatsapp.appSecret) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "not-configured",
          message: "META_APP_SECRET is not configured, so this payload cannot be verified.",
          remedy:
            "Set META_APP_SECRET from the Meta app's Basic Settings. Unverified payloads are rejected rather than trusted.",
          retryable: false,
        },
      },
      { status: 503 },
    );
  }

  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"))) {
    await claimEvent("instagram", `rejected:${sha256(raw).slice(0, 32)}`, {
      status: "rejected",
      reason: "Signature verification failed.",
      bytes: raw.length,
    });
    log.warn("rejected", { reason: "bad signature" });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "blocked",
          message: "Signature verification failed.",
          remedy: "Confirm META_APP_SECRET matches the app that owns this webhook.",
          retryable: false,
        },
      },
      { status: 401 },
    );
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return acknowledge("instagram", { handled: 0, ignored: 1, note: "Payload was not valid JSON." });
  }

  const account = await prisma.instagramAccount.findFirst();
  if (!account) {
    return acknowledge("instagram", {
      handled: 0,
      ignored: 1,
      note: "No Instagram account is configured in this installation.",
    });
  }

  let handled = 0;
  let ignored = 0;

  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      // Echoes are our own outbound messages coming back; they open nothing.
      if (event.message?.is_echo) {
        ignored++;
        continue;
      }

      const participantId = event.sender?.id;
      if (!participantId) {
        ignored++;
        continue;
      }

      // Meta's own message id, so a retry does not re-open the window or
      // notify twice. Without a mid there is nothing stable to key on, and a
      // conversation event with no id is not one we can safely deduplicate.
      const mid = event.message?.mid;
      if (!mid) {
        ignored++;
        continue;
      }
      const claim = await claimEvent("instagram", mid, {
        workspaceId: account.workspaceId,
        status: "accepted",
        bytes: raw.length,
      });
      if (!claim.fresh) {
        ignored++;
        continue;
      }

      if (!withinReplayWindow(event.timestamp ? event.timestamp / 1000 : null, WINDOW_MS)) {
        // Older than the messaging window it would open: a replay, not a
        // conversation. Accepting it would reopen a closed window.
        ignored++;
        continue;
      }

      const at = event.timestamp ? new Date(event.timestamp) : new Date();

      await prisma.instagramConversation.upsert({
        where: { accountId_externalId: { accountId: account.id, externalId: participantId } },
        create: {
          accountId: account.id,
          externalId: participantId,
          participantId,
          lastMessageAt: at,
          // The window opens when they message us, and this is that moment.
          windowExpiresAt: new Date(at.getTime() + WINDOW_MS),
        },
        update: {
          lastMessageAt: at,
          windowExpiresAt: new Date(at.getTime() + WINDOW_MS),
        },
      });

      await prisma.notification.create({
        data: {
          workspaceId: account.workspaceId,
          type: "outreach.replied",
          title: "New Instagram message",
          body: event.message?.text?.slice(0, 160) ?? "A conversation was opened.",
          level: "success",
          link: "/outreach?tab=messages",
        },
      });

      handled++;
    }
  }

  await prisma.instagramAccount.update({
    where: { id: account.id },
    data: { lastSyncAt: new Date() },
  });

  log.done({ handled, ignored });
  return acknowledge("instagram", {
    handled,
    ignored,
    note: "Conversations were opened or refreshed; sending eligibility reads these rows.",
  });
}
