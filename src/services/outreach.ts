import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import type { AuditSignals, OutreachChannel, OutreachDraft, OutreachVariant, SalesAngle } from "@/types";
import { factsBlock, jsonParser, runAIJob } from "./ai-jobs";
import { logActivity, notify } from "./activity";
import { getSettings } from "./settings";
import { latestOpportunity, refreshSuggestedTask } from "./opportunity";
import { getOutreachProvider } from "@/providers/outreach";

/**
 * Outreach generation and dispatch.
 *
 * Two rules are enforced here rather than left to the UI:
 *  1. Nothing sends without an explicit human approval step.
 *  2. Every message is grounded in observations that exist in the database.
 *     The observation list is assembled here from stored audit findings and is
 *     passed to the model as the only permitted source of specifics.
 */

const CHANNEL_LIMITS: Record<OutreachChannel, { maxChars: number; note: string }> = {
  email: { maxChars: 1400, note: "Plain text. No images, no tracking pixels." },
  whatsapp: { maxChars: 700, note: "Conversational, short paragraphs, no subject line." },
  instagram: { maxChars: 900, note: "Direct message. No links in the first message." },
  linkedin: { maxChars: 1100, note: "Professional register, no attachments." },
  generic: { maxChars: 1200, note: "Channel-agnostic copy the user will paste somewhere." },
};

const SYSTEM = `You write first-contact messages for a freelance web developer approaching local businesses.

Absolute rules:
- Every specific claim must come from the <facts> block. Never invent traffic numbers, revenue,
  competitor names, rankings, or anything you were not given.
- Do not flatter. Do not use "I hope this finds you well", "reach out", "circle back", "unlock",
  "leverage", "in today's digital landscape", or em-dash-heavy marketing cadence.
- Reference at most three concrete observations, phrased as things a person noticed, not as an audit.
- The ask should be small and easy to decline.
- Match the register of the channel.

Return a single JSON object: { "subject": string|null, "body": string, "observations": string[] }
where observations lists exactly which supplied facts you used.`;

/** Assembles the grounded observation list from stored audit findings. */
export async function observationsFor(prospectId: string): Promise<string[]> {
  const audit = await prisma.websiteAudit.findFirst({
    where: { prospectId, status: "complete" },
    orderBy: { startedAt: "desc" },
    include: {
      findings: { where: { severity: { in: ["critical", "high"] } }, take: 6 },
    },
  });

  const business = await prisma.prospect.findUnique({
    where: { id: prospectId },
    select: { business: { select: { website: true, rating: true, reviewCount: true } } },
  });

  const out: string[] = [];

  if (!business?.business.website) {
    out.push("There is no website on record — only a map listing.");
  }

  const signals = audit ? fromJson<AuditSignals | null>(audit.signalsJson, null) : null;
  if (signals) {
    if (!signals.html.viewport) out.push("The site has no mobile viewport, so it renders at desktop width on a phone.");
    if (signals.conversion.phoneLinks === 0 && signals.fetch.httpStatus === 200) {
      out.push("The phone number is not tappable on mobile.");
    }
    if (!signals.conversion.ctaAboveFold) out.push("There is no booking or contact action near the top of the page.");
    if (signals.fetch.loadMs > 4000) {
      out.push(`The homepage took about ${(signals.fetch.loadMs / 1000).toFixed(1)} seconds to respond.`);
    }
    if (!signals.fetch.https) out.push("The site is served over plain HTTP, so browsers flag it as not secure.");
  }

  for (const f of audit?.findings ?? []) {
    if (out.length >= 6) break;
    out.push(f.whatIsWrong);
  }

  return [...new Set(out)].slice(0, 6);
}

export async function draftOutreach(
  workspaceId: string,
  prospectId: string,
  channel: OutreachChannel,
  variant: OutreachVariant,
) {
  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, workspaceId },
    include: { business: true },
  });
  if (!prospect) {
    throw new AppError({
      kind: "not-found",
      message: "Prospect not found.",
      remedy: "Refresh the prospect list.",
    });
  }

  const settings = await getSettings(workspaceId);
  const opportunity = await latestOpportunity(prospectId);
  const angle = opportunity?.salesAngle as SalesAngle | null;
  const observations = await observationsFor(prospectId);

  if (observations.length === 0) {
    throw new AppError({
      kind: "conflict",
      message: "There are no recorded observations to write from.",
      remedy:
        "Run the website audit first. Messages are only generated from findings that actually exist.",
    });
  }

  const limits = CHANNEL_LIMITS[channel];
  const facts = {
    businessName: prospect.business.name,
    category: prospect.business.category,
    city: prospect.business.city,
    area: prospect.business.area,
    website: prospect.business.website,
    rating: prospect.business.rating,
    reviewCount: prospect.business.reviewCount,
    channel,
    variant,
    observations,
    impactSummary: angle?.biggestProblem ?? null,
    solutionSummary: angle?.suggestedSolution ?? null,
    senderName: settings.senderName || "",
    senderRole: settings.senderRole,
    maxChars: limits.maxChars,
    channelNote: limits.note,
  };

  const outcome = await runAIJob<OutreachDraft>({
    workspaceId,
    type: "outreach.draft",
    capability: "copywriting",
    entityType: "prospect",
    entityId: prospectId,
    inputSummary: { businessName: prospect.business.name, channel, variant },
    request: {
      system: SYSTEM,
      json: true,
      temperature: 0.6,
      maxTokens: 1200,
      messages: [
        {
          role: "user",
          content: `Write the ${variant} ${channel} message. Stay under ${limits.maxChars} characters. ${limits.note}\n\n${factsBlock(facts)}`,
        },
      ],
    },
    parse: jsonParser((v) => {
      const o = v as Record<string, unknown>;
      const body = typeof o.body === "string" ? o.body.trim() : "";
      if (!body) {
        throw new AppError({
          kind: "provider-error",
          message: "The model returned an empty message body.",
          remedy: "Retry, or pick a different model for the copywriting capability.",
          retryable: true,
        });
      }
      return {
        channel,
        variant,
        subject: typeof o.subject === "string" && o.subject.trim() ? o.subject.trim() : null,
        body,
        observations: Array.isArray(o.observations)
          ? (o.observations as unknown[]).filter((x): x is string => typeof x === "string")
          : observations,
      } satisfies OutreachDraft;
    }),
  });

  const message = await prisma.outreachMessage.create({
    data: {
      prospectId,
      channel,
      variant,
      subject: outcome.value.subject,
      body: outcome.value.body,
      status: "draft",
      sequenceStep: variant.startsWith("followup") ? 1 : variant === "final" ? 2 : 0,
      observationsJson: toJson(outcome.value.observations),
      provider: outcome.provider,
      model: outcome.model,
      aiJobId: outcome.jobId,
    },
  });

  await prisma.outreachEvent.create({
    data: { messageId: message.id, type: "created", detail: `${channel}/${variant}` },
  });

  await logActivity({
    workspaceId,
    prospectId,
    type: "outreach.drafted",
    message: `${variant} ${channel} draft created${outcome.isMock ? " (composed from stored data)" : ` by ${outcome.provider}`}.`,
    meta: { messageId: message.id, isMock: outcome.isMock },
  });

  await refreshSuggestedTask(workspaceId, prospectId);
  return { message, isMock: outcome.isMock };
}

export async function approveMessage(workspaceId: string, messageId: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId } },
    include: { prospect: { include: { business: true } } },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach list.",
    });
  }
  if (message.status !== "draft") {
    throw new AppError({
      kind: "conflict",
      message: `This message is already ${message.status}.`,
      remedy: "Only drafts can be approved.",
    });
  }

  const updated = await prisma.outreachMessage.update({
    where: { id: messageId },
    data: { status: "approved", approvedAt: new Date() },
  });
  await prisma.outreachEvent.create({ data: { messageId, type: "approved" } });
  await logActivity({
    workspaceId,
    prospectId: message.prospectId,
    type: "outreach.approved",
    message: `Approved the ${message.variant} ${message.channel} message.`,
    meta: { messageId },
  });
  await refreshSuggestedTask(workspaceId, message.prospectId);
  return updated;
}

/** Rate limit is enforced per workspace against real send events. */
async function assertWithinRateLimit(workspaceId: string) {
  const since = new Date(Date.now() - 3_600_000);
  const sent = await prisma.outreachMessage.count({
    where: { prospect: { workspaceId }, status: { in: ["sent", "replied"] }, sentAt: { gte: since } },
  });
  if (sent >= appConfig.outreach.rateLimitPerHour) {
    throw new AppError({
      kind: "rate-limited",
      message: `The hourly send limit of ${appConfig.outreach.rateLimitPerHour} has been reached.`,
      remedy: "Wait for the window to roll over, or raise OUTREACH_RATE_LIMIT_PER_HOUR.",
      retryable: true,
    });
  }
}

export async function sendMessage(workspaceId: string, messageId: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId } },
    include: { prospect: { include: { business: true } } },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach list.",
    });
  }
  if (message.status !== "approved") {
    throw new AppError({
      kind: "conflict",
      message: "Only approved messages can be sent.",
      remedy: "Approve the draft first — this step is deliberate and cannot be skipped.",
    });
  }
  if (message.prospect.stage === "not-interested") {
    throw new AppError({
      kind: "conflict",
      message: "This prospect has opted out.",
      remedy: "Opted-out prospects are excluded from outreach.",
    });
  }

  await assertWithinRateLimit(workspaceId);

  const provider = getOutreachProvider(message.channel as OutreachChannel);
  const result = await provider.send({
    to: {
      email: message.prospect.business.email,
      phone: message.prospect.business.phone,
      handle: message.prospect.business.instagram,
      name: message.prospect.business.name,
    },
    subject: message.subject,
    body: message.body,
  });

  if (result.status === "manual") {
    // Nothing was transmitted. Record the truth: the user must send it.
    await prisma.outreachEvent.create({
      data: { messageId, type: "failed", detail: result.detail },
    });
    throw new AppError({
      kind: "not-configured",
      message: result.detail,
      remedy: provider.setupHint,
    });
  }

  const updated = await prisma.outreachMessage.update({
    where: { id: messageId },
    data: { status: "sent", sentAt: new Date() },
  });
  await prisma.outreachEvent.create({
    data: { messageId, type: "sent", detail: `${provider.id}: ${result.detail}` },
  });
  await prisma.prospect.update({
    where: { id: message.prospectId },
    data: {
      lastContactAt: new Date(),
      stage: ["discovered", "qualified", "audited", "concept", "website-ready"].includes(
        message.prospect.stage,
      )
        ? "contacted"
        : message.prospect.stage,
    },
  });
  await logActivity({
    workspaceId,
    prospectId: message.prospectId,
    type: "outreach.sent",
    message: `Sent the ${message.variant} ${message.channel} message via ${provider.label}.`,
    meta: { messageId },
  });
  await refreshSuggestedTask(workspaceId, message.prospectId);
  return updated;
}

/** Records an inbound reply. Manual for now; a provider webhook can call this. */
export async function recordReply(workspaceId: string, messageId: string, detail?: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: { id: messageId, prospect: { workspaceId } },
  });
  if (!message) {
    throw new AppError({
      kind: "not-found",
      message: "Message not found.",
      remedy: "Refresh the outreach list.",
    });
  }
  await prisma.outreachMessage.update({ where: { id: messageId }, data: { status: "replied" } });
  await prisma.outreachEvent.create({
    data: { messageId, type: "replied", detail: detail ?? null },
  });
  await prisma.prospect.update({
    where: { id: message.prospectId },
    data: { stage: "meeting" },
  });
  await logActivity({
    workspaceId,
    prospectId: message.prospectId,
    type: "outreach.replied",
    message: "Reply received.",
    meta: { messageId },
  });
  await notify({
    workspaceId,
    type: "outreach.replied",
    title: "A prospect replied",
    level: "success",
    link: `/prospects/${message.prospectId}?tab=outreach`,
  });
  await refreshSuggestedTask(workspaceId, message.prospectId);
}

export async function optOut(workspaceId: string, prospectId: string) {
  await prisma.prospect.update({ where: { id: prospectId }, data: { stage: "not-interested" } });
  await prisma.outreachMessage.updateMany({
    where: { prospectId, status: { in: ["draft", "approved"] } },
    data: { status: "opted-out" },
  });
  await logActivity({
    workspaceId,
    prospectId,
    type: "outreach.replied",
    message: "Marked as not interested. Remaining drafts were withdrawn.",
  });
}
