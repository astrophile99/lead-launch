import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { fromJson } from "@/lib/json";
import { CHANNEL_LABEL } from "@/config/outreach";
import { normaliseStage } from "@/config/pipeline";
import { gmail, resolveTransport } from "@/providers/messaging";
import type { OutreachChannel } from "@/types";
import { logActivity } from "./activity";
import { assertNotOptedOut, identifierFor } from "./optouts";
import { refreshSuggestedTask } from "./opportunity";

/**
 * The unified outreach queue.
 *
 * One state machine for Gmail, WhatsApp and Instagram, because the operator
 * should not have to remember which channel behaves how:
 *
 *   draft → (edit) → approved → sending → sent
 *                             ↘ failed
 *
 * Three properties are enforced here rather than in the UI:
 *
 *   1. **Approval is of specific words.** Editing an approved message returns
 *      it to draft. Approving text and then sending different text would make
 *      the approval meaningless.
 *
 *   2. **Approval is not sending.** `approve` transmits nothing. `send` is a
 *      separate call that a person makes. There is no configuration, anywhere,
 *      that makes an approved message go out on its own.
 *
 *   3. **`sent` means the provider confirmed it.** Every send goes through
 *      `sending` first, and only a provider response carrying an id promotes it
 *      to `sent`. Anything else lands on `failed` with the reason. A message is
 *      never displayed as sent because we asked nicely.
 */

export const QUEUE_STATES = [
  "draft",
  "approved",
  "sending",
  "sent",
  "failed",
  "replied",
  "opted-out",
] as const;

export type QueueState = (typeof QUEUE_STATES)[number];

export const QUEUE_STATE_META: Record<
  QueueState,
  { label: string; hint: string; tone: "neutral" | "accent" | "ok" | "warn" | "danger" | "info" }
> = {
  draft: {
    label: "Needs review",
    hint: "Written, not read by a person yet.",
    tone: "info",
  },
  approved: {
    label: "Approved",
    hint: "Reviewed and ready. Nothing has been sent — that is still a separate click.",
    tone: "accent",
  },
  sending: {
    label: "Sending",
    hint: "Handed to the provider; waiting for confirmation.",
    tone: "warn",
  },
  sent: {
    label: "Sent",
    hint: "The provider confirmed it with a message id.",
    tone: "ok",
  },
  failed: {
    label: "Failed",
    hint: "The provider refused it. Nothing was delivered.",
    tone: "danger",
  },
  replied: { label: "Replied", hint: "They wrote back.", tone: "ok" },
  "opted-out": {
    label: "Withdrawn",
    hint: "The recipient opted out, so the draft was withdrawn.",
    tone: "neutral",
  },
};

export type QueueFilters = {
  state: QueueState | "all" | "needs-review" | "follow-up-due";
  channel: OutreachChannel | "all";
  q: string;
};

export function parseQueueFilters(params: Record<string, string | string[] | undefined>): QueueFilters {
  const first = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const state = first("state");
  const channel = first("channel");
  return {
    state: ([...QUEUE_STATES, "needs-review", "follow-up-due"] as string[]).includes(state)
      ? (state as QueueFilters["state"])
      : "all",
    channel: (["email", "whatsapp", "instagram", "linkedin", "generic"] as string[]).includes(channel)
      ? (channel as OutreachChannel)
      : "all",
    q: first("q").slice(0, 80),
  };
}

export type QueueRow = {
  id: string;
  prospectId: string;
  businessName: string;
  city: string;
  channel: OutreachChannel;
  channelLabel: string;
  variant: string;
  subject: string | null;
  body: string;
  recipient: string | null;
  transport: string | null;
  status: QueueState;
  generatedByAI: boolean;
  provider: string | null;
  model: string | null;
  observations: string[];
  failureReason: string | null;
  externalId: string | null;
  threadId: string | null;
  draftId: string | null;
  createdAt: string;
  editedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  lastContactAt: string | null;
  stage: string;
};

const FOLLOW_UP_AFTER_DAYS = 4;

export async function listQueue(
  workspaceId: string,
  filters: QueueFilters,
  opts: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 40));

  const where: Record<string, unknown> = { prospect: { workspaceId } };

  if (filters.state === "needs-review") where.status = "draft";
  else if (filters.state === "follow-up-due") {
    where.status = "sent";
    where.sentAt = { lt: new Date(Date.now() - FOLLOW_UP_AFTER_DAYS * 86_400_000) };
  } else if (filters.state !== "all") where.status = filters.state;

  if (filters.channel !== "all") where.channel = filters.channel;
  if (filters.q) {
    where.prospect = {
      workspaceId,
      business: { name: { contains: filters.q } },
    };
  }

  const [rows, total, counts] = await Promise.all([
    prisma.outreachMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { prospect: { include: { business: true } } },
    }),
    prisma.outreachMessage.count({ where }),
    prisma.outreachMessage.groupBy({
      by: ["status"],
      where: { prospect: { workspaceId } },
      _count: { _all: true },
    }),
  ]);

  const byState = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<
    string,
    number
  >;

  return {
    rows: rows.map(toQueueRow),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    counts: byState,
  };
}

type MessageWithProspect = Parameters<typeof toQueueRow>[0];

function toQueueRow(m: {
  id: string;
  prospectId: string;
  channel: string;
  variant: string;
  subject: string | null;
  body: string;
  recipient: string | null;
  transport: string | null;
  status: string;
  generatedByAI: boolean;
  provider: string | null;
  model: string | null;
  observationsJson: string | null;
  failureReason: string | null;
  externalId: string | null;
  threadId: string | null;
  draftId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  prospect: {
    stage: string;
    lastContactAt: Date | null;
    business: { name: string; city: string };
  };
}): QueueRow {
  return {
    id: m.id,
    prospectId: m.prospectId,
    businessName: m.prospect.business.name,
    city: m.prospect.business.city,
    channel: m.channel as OutreachChannel,
    channelLabel: CHANNEL_LABEL[m.channel as OutreachChannel] ?? m.channel,
    variant: m.variant,
    subject: m.subject,
    body: m.body,
    recipient: m.recipient,
    transport: m.transport,
    status: m.status as QueueState,
    generatedByAI: m.generatedByAI,
    provider: m.provider,
    model: m.model,
    observations: fromJson<string[]>(m.observationsJson, []),
    failureReason: m.failureReason,
    externalId: m.externalId,
    threadId: m.threadId,
    draftId: m.draftId,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    approvedAt: m.approvedAt?.toISOString() ?? null,
    sentAt: m.sentAt?.toISOString() ?? null,
    lastContactAt: m.prospect.lastContactAt?.toISOString() ?? null,
    stage: normaliseStage(m.prospect.stage),
  };
}

export type { MessageWithProspect };

/* ------------------------------------------------------------------ edit */

/**
 * Edits a draft.
 *
 * An approved message that is edited goes back to draft, and its Gmail draft is
 * updated so the two do not drift. This is the rule that makes approval mean
 * something: you approved these words, not this row.
 */
export async function editMessage(
  workspaceId: string,
  messageId: string,
  patch: { subject?: string | null; body?: string },
) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId } },
    include: { prospect: { include: { business: true } } },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach queue.",
    });
  }
  if (["sent", "sending", "replied"].includes(message.status)) {
    throw new AppError({
      kind: "conflict",
      message: `This message is already ${message.status} and cannot be edited.`,
      remedy: "Draft a follow-up instead.",
    });
  }

  const body = patch.body?.trim() ?? message.body;
  if (!body) {
    throw new AppError({
      kind: "invalid-input",
      message: "The message body cannot be empty.",
      remedy: "Write something, or delete the draft.",
    });
  }

  const wasApproved = message.status === "approved";

  const updated = await prisma.outreachMessage.update({
    where: { id: messageId },
    data: {
      subject: patch.subject === undefined ? message.subject : patch.subject,
      body,
      status: "draft",
      approvedAt: null,
      editedAt: new Date(),
      generatedByAI: false,
      failureReason: null,
    },
  });

  // Keep the provider-side draft in step, where one exists.
  if (message.draftId && message.channel === "email") {
    try {
      await gmail.updateDraft(workspaceId, message.draftId, {
        to: {
          name: message.prospect.business.name,
          email: message.recipient ?? message.prospect.business.email,
          phone: null,
          handle: null,
          externalId: message.threadId,
        },
        subject: updated.subject,
        body: updated.body,
      });
    } catch (e) {
      // The local edit still stands; record why Gmail is behind.
      await prisma.outreachMessage.update({
        where: { id: messageId },
        data: {
          failureReason: `The Gmail draft could not be updated: ${e instanceof Error ? e.message : "unknown error"}`,
        },
      });
    }
  }

  await prisma.outreachEvent.create({
    data: {
      messageId,
      type: "created",
      detail: wasApproved
        ? "Edited after approval — approval was withdrawn, because approval is of specific words."
        : "Edited.",
    },
  });

  await logActivity({
    workspaceId,
    prospectId: message.prospectId,
    type: "outreach.drafted",
    message: wasApproved
      ? `Edited the approved ${message.channel} message; it is back in review.`
      : `Edited the ${message.channel} draft.`,
    meta: { messageId },
  });

  return updated;
}

/* ---------------------------------------------------------------- approve */

export async function approveForSend(workspaceId: string, messageId: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId } },
    include: { prospect: { include: { business: true } } },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach queue.",
    });
  }
  if (message.status !== "draft") {
    throw new AppError({
      kind: "conflict",
      message: `This message is ${message.status}, not a draft.`,
      remedy: "Only drafts can be approved.",
    });
  }

  await assertNotOptedOut(
    workspaceId,
    message.channel as OutreachChannel,
    message.prospect.business,
  );

  const recipient =
    message.recipient ??
    identifierFor(message.channel as OutreachChannel, message.prospect.business);

  // Create the real provider-side draft at approval time, so an approved Gmail
  // message exists in the operator's own Drafts folder and can be inspected,
  // edited or deleted from Gmail itself.
  let draftId = message.draftId;
  let threadId = message.threadId;
  let transport = message.transport;

  if (message.channel === "email" && (await gmail.isConfigured(workspaceId))) {
    transport = "gmail";
    try {
      const target = {
        name: message.prospect.business.name,
        email: message.prospect.business.email,
        phone: null,
        handle: null,
        externalId: message.threadId,
      };
      if (draftId) {
        const res = await gmail.updateDraft(workspaceId, draftId, {
          to: target,
          subject: message.subject,
          body: message.body,
        });
        threadId = res.threadId ?? threadId;
      } else {
        const res = await gmail.createDraft(workspaceId, {
          to: target,
          subject: message.subject,
          body: message.body,
        });
        draftId = res.draftId;
        threadId = res.threadId ?? threadId;
      }
    } catch (e) {
      // Approval is a local decision; it stands even if Gmail is unreachable.
      // Sending will fail loudly rather than silently doing nothing.
      await prisma.outreachMessage.update({
        where: { id: messageId },
        data: {
          failureReason: `Approved, but the Gmail draft could not be created: ${
            e instanceof Error ? e.message : "unknown error"
          }`,
        },
      });
    }
  }

  const updated = await prisma.outreachMessage.update({
    where: { id: messageId },
    data: {
      status: "approved",
      approvedAt: new Date(),
      recipient,
      draftId,
      threadId,
      transport,
    },
  });

  await prisma.outreachEvent.create({
    data: {
      messageId,
      type: "approved",
      detail: draftId
        ? `Approved. A Gmail draft exists (${draftId}). Nothing has been sent.`
        : "Approved. Nothing has been sent.",
    },
  });

  await logActivity({
    workspaceId,
    prospectId: message.prospectId,
    type: "outreach.approved",
    message: `Approved the ${message.variant} ${message.channel} message. Not sent.`,
    meta: { messageId },
  });

  await refreshSuggestedTask(workspaceId, message.prospectId);
  return updated;
}

/* ------------------------------------------------------------------ send */

export type SendResult = {
  status: "sent" | "manual";
  externalId: string | null;
  transport: string;
  detail: string;
};

/**
 * Sends one approved message.
 *
 * The only function that transitions a message to `sent`, and it only does so
 * on a provider response carrying an id. If the provider cannot send — because
 * the channel has no sanctioned transport, or is not configured — the message
 * stays approved and the caller is told to send it by hand. It is never
 * recorded as sent.
 */
export async function sendApproved(
  workspaceId: string,
  messageId: string,
): Promise<SendResult> {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId } },
    include: { prospect: { include: { business: true } } },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach queue.",
    });
  }
  if (message.status !== "approved") {
    throw new AppError({
      kind: "conflict",
      message:
        message.status === "sent"
          ? "This message has already been sent."
          : "Only approved messages can be sent.",
      remedy:
        message.status === "draft"
          ? "Review the draft and approve it first. This step is deliberate and cannot be skipped."
          : "Refresh the outreach queue.",
    });
  }

  await assertNotOptedOut(
    workspaceId,
    message.channel as OutreachChannel,
    message.prospect.business,
  );

  const provider = await resolveTransport(workspaceId, message.channel as OutreachChannel);

  await prisma.outreachMessage.update({
    where: { id: messageId },
    data: { status: "sending", transport: provider.id, failureReason: null },
  });

  try {
    let externalId: string | null = null;
    let threadId: string | null = message.threadId;
    let detail: string;

    if (provider.id === "gmail" && message.draftId) {
      // Send the very draft that was approved, rather than composing a fresh
      // message from the same row. They are not the same thing.
      const res = await gmail.sendDraft(workspaceId, message.draftId);
      externalId = res.externalId;
      threadId = res.threadId ?? threadId;
      detail = `Sent from Gmail to ${message.recipient}.`;
    } else {
      const outcome = await provider.send(workspaceId, {
        to: {
          name: message.prospect.business.name,
          email: message.prospect.business.email,
          phone: message.prospect.business.phone,
          handle: message.prospect.business.instagram,
          externalId: message.threadId,
        },
        subject: message.subject,
        body: message.body,
      });

      if (outcome.status === "manual") {
        // Nothing was transmitted. Roll back to approved and say so plainly —
        // this is the branch that must never look like a success.
        await prisma.outreachMessage.update({
          where: { id: messageId },
          data: { status: "approved", failureReason: outcome.detail },
        });
        await prisma.outreachEvent.create({
          data: { messageId, type: "failed", detail: outcome.detail },
        });
        const health = await provider.health(workspaceId);
        return {
          status: "manual",
          externalId: null,
          transport: provider.id,
          detail: `${outcome.detail} ${health.setupHint}`.trim(),
        };
      }

      externalId = outcome.externalId;
      detail = outcome.detail;
    }

    if (!externalId) {
      throw new AppError({
        kind: "provider-error",
        message: `${provider.label} did not return a message id, so the send cannot be confirmed.`,
        remedy: "Check the channel directly before retrying — it may have gone.",
        retryable: false,
      });
    }

    const updated = await prisma.outreachMessage.update({
      where: { id: messageId },
      data: {
        status: "sent",
        sentAt: new Date(),
        externalId,
        threadId,
        transport: provider.id,
        failureReason: null,
      },
    });

    await prisma.outreachEvent.create({
      data: { messageId, type: "sent", detail: `${provider.label}: ${detail}` },
    });

    const stage = normaliseStage(message.prospect.stage);
    await prisma.prospect.update({
      where: { id: message.prospectId },
      data: {
        lastContactAt: new Date(),
        stage: ["new", "researched"].includes(stage) ? "contacted" : message.prospect.stage,
      },
    });

    await logActivity({
      workspaceId,
      prospectId: message.prospectId,
      type: "outreach.sent",
      message: `Sent the ${message.variant} ${message.channel} message via ${provider.label}.`,
      meta: { messageId, externalId },
    });

    await refreshSuggestedTask(workspaceId, message.prospectId);
    void updated;

    return { status: "sent", externalId, transport: provider.id, detail };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "The send failed.";
    await prisma.outreachMessage.update({
      where: { id: messageId },
      data: { status: "failed", failureReason: reason },
    });
    await prisma.outreachEvent.create({
      data: { messageId, type: "failed", detail: reason },
    });
    await logActivity({
      workspaceId,
      prospectId: message.prospectId,
      type: "outreach.sent",
      message: `Send failed on ${message.channel}: ${reason}`,
      meta: { messageId },
    });
    throw e;
  }
}

/** Puts a failed message back in the queue for another attempt. */
export async function retryFailed(workspaceId: string, messageId: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId }, status: "failed" },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "No failed message with that id.",
      remedy: "Refresh the outreach queue.",
    });
  }
  return prisma.outreachMessage.update({
    where: { id: messageId },
    data: { status: "approved", failureReason: null },
  });
}

/* -------------------------------------------------------------- timeline */

export type TimelineItem = {
  id: string;
  at: string;
  channel: OutreachChannel;
  channelLabel: string;
  kind: string;
  title: string;
  detail: string | null;
  messageId: string;
};

/** One chronological thread across every channel, for a single prospect. */
export async function prospectTimeline(
  workspaceId: string,
  prospectId: string,
): Promise<TimelineItem[]> {
  const messages = await prisma.outreachMessage.findMany({
    where: { prospectId, prospect: { workspaceId } },
    include: { events: { orderBy: { at: "asc" } } },
  });

  const items: TimelineItem[] = [];
  for (const m of messages) {
    const channel = m.channel as OutreachChannel;
    for (const e of m.events) {
      items.push({
        id: e.id,
        at: e.at.toISOString(),
        channel,
        channelLabel: CHANNEL_LABEL[channel] ?? channel,
        kind: e.type,
        title:
          e.type === "sent"
            ? `${CHANNEL_LABEL[channel]} sent`
            : e.type === "approved"
              ? `${CHANNEL_LABEL[channel]} approved`
              : e.type === "created"
                ? `${CHANNEL_LABEL[channel]} draft`
                : e.type === "replied"
                  ? `Reply on ${CHANNEL_LABEL[channel]}`
                  : e.type === "failed"
                    ? `${CHANNEL_LABEL[channel]} failed`
                    : `${CHANNEL_LABEL[channel]} ${e.type}`,
        detail: e.detail,
        messageId: m.id,
      });
    }
  }

  return items.sort((a, b) => b.at.localeCompare(a.at));
}
