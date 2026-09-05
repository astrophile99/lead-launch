import { NextResponse } from "next/server";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { acknowledge, verifySignature, verifySubscription } from "@/lib/meta-webhook";
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
  const raw = await request.text();

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
