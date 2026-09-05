import { NextResponse } from "next/server";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { acknowledge, verifySignature, verifySubscription } from "@/lib/meta-webhook";
import { startJob } from "@/lib/logger";
import { recordOptOut } from "@/services/optouts";

/**
 * WhatsApp Cloud API webhook.
 *
 * Handles two kinds of event:
 *   - delivery statuses (sent / delivered / read / failed) for messages we sent
 *   - inbound messages, which open Meta's 24-hour service window and, when the
 *     text reads as a stop request, record a permanent opt-out
 *
 * Nothing is trusted without a valid signature. Verified events only ever
 * update rows this workspace already owns; an unknown message id is ignored
 * rather than used to create anything.
 */

const STOP_WORDS = /^\s*(stop|unsubscribe|remove me|do not contact|don'?t contact)\b/i;

type StatusEntry = {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { title?: string; message?: string }[];
};

type MessageEntry = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
};

type Payload = {
  entry?: {
    changes?: {
      value?: {
        statuses?: StatusEntry[];
        messages?: MessageEntry[];
        metadata?: { phone_number_id?: string };
      };
    }[];
  }[];
};

export async function GET(request: Request) {
  // The stored token is per workspace; the env var is the server-wide fallback.
  const account = await prisma.whatsAppAccount.findFirst({
    where: { webhookVerifyToken: { not: null } },
    select: { webhookVerifyToken: true },
  });
  const expected = account?.webhookVerifyToken ?? appConfig.whatsapp.webhookVerifyToken;
  return verifySubscription(request, expected).response;
}

export async function POST(request: Request) {
  const log = startJob("webhook.whatsapp.receive");

  // Read the raw bytes: re-serialising parsed JSON breaks the HMAC.
  const raw = await request.text();

  if (!appConfig.whatsapp.appSecret) {
    log.warn("rejected", { reason: "META_APP_SECRET not configured" });
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "not-configured",
          message: "META_APP_SECRET is not configured, so this payload cannot be verified.",
          remedy:
            "Set META_APP_SECRET from the Meta app's Basic Settings. Unverified webhook payloads are rejected rather than trusted.",
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
    // Malformed but authentic: acknowledge so Meta stops retrying it.
    return acknowledge("whatsapp", { handled: 0, ignored: 1, note: "Payload was not valid JSON." });
  }

  let handled = 0;
  let ignored = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      for (const status of value.statuses ?? []) {
        if (!status.id) {
          ignored++;
          continue;
        }
        // Only touch a message we actually sent and recorded.
        const message = await prisma.outreachMessage.findFirst({
          where: { externalId: status.id },
          select: { id: true, prospectId: true },
        });
        if (!message) {
          ignored++;
          continue;
        }

        const failure = status.errors?.[0];
        await prisma.outreachMessage.update({
          where: { id: message.id },
          data: {
            deliveredAt: status.status === "delivered" ? new Date() : undefined,
            readAt: status.status === "read" ? new Date() : undefined,
            status: status.status === "failed" ? "bounced" : undefined,
            failureReason: failure ? (failure.message ?? failure.title ?? "Delivery failed.") : undefined,
          },
        });
        await prisma.outreachEvent.create({
          data: {
            messageId: message.id,
            type:
              status.status === "delivered"
                ? "delivered"
                : status.status === "read"
                  ? "opened"
                  : status.status === "failed"
                    ? "failed"
                    : "sent",
            detail: failure?.message ?? null,
          },
        });
        handled++;
      }

      for (const inbound of value.messages ?? []) {
        const from = inbound.from;
        const text = inbound.text?.body ?? "";
        if (!from) {
          ignored++;
          continue;
        }

        const phoneTail = from.replace(/\D+/g, "").slice(-10);
        const prospect = await prisma.prospect.findFirst({
          where: { business: { phone: { contains: phoneTail } } },
          select: { id: true, workspaceId: true },
        });

        if (!prospect) {
          ignored++;
          continue;
        }

        // A reply is the strongest signal there is; record it as one.
        await prisma.activity.create({
          data: {
            workspaceId: prospect.workspaceId,
            prospectId: prospect.id,
            type: "outreach.replied",
            message: `WhatsApp reply received: ${text.slice(0, 200)}`,
          },
        });

        if (STOP_WORDS.test(text)) {
          await recordOptOut(prospect.workspaceId, "whatsapp", phoneTail, {
            reason: "Replied with a stop request",
            source: "webhook",
          });
          await prisma.prospect.update({
            where: { id: prospect.id },
            data: { stage: "not-interested" },
          });
        } else {
          await prisma.prospect.update({
            where: { id: prospect.id },
            data: { stage: "meeting" },
          });
          await prisma.notification.create({
            data: {
              workspaceId: prospect.workspaceId,
              type: "outreach.replied",
              title: "A prospect replied on WhatsApp",
              body: text.slice(0, 160),
              level: "success",
              link: `/prospects/${prospect.id}?tab=outreach`,
            },
          });
        }
        handled++;
      }
    }
  }

  log.done({ handled, ignored });
  return acknowledge("whatsapp", {
    handled,
    ignored,
    note: "Only events matching a stored message or prospect were applied.",
  });
}
