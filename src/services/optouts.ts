import { prisma } from "@/db/client";
import { AppError } from "@/lib/errors";
import { normalisePhone } from "@/lib/utils";
import type { OutreachChannel } from "@/types";

/**
 * Opt-outs.
 *
 * A person who has asked not to be contacted must stay uncontacted on every
 * channel that can reach the same identifier. This is checked before drafting
 * and again before sending — the second check matters because a draft can sit
 * approved for days before anyone presses send.
 */

export type OptOutTarget = {
  email?: string | null;
  phone?: string | null;
  instagram?: string | null;
};

/** Normalises an identifier so "+91 98765 43210" and "09876543210" match. */
export function identifierFor(channel: OutreachChannel, target: OptOutTarget): string | null {
  switch (channel) {
    case "email":
      return target.email?.trim().toLowerCase() || null;
    case "whatsapp":
      return normalisePhone(target.phone);
    case "instagram":
      return target.instagram?.trim().toLowerCase().replace(/^.*instagram\.com\//, "") || null;
    default:
      return null;
  }
}

export async function isOptedOut(
  workspaceId: string,
  channel: OutreachChannel,
  target: OptOutTarget,
): Promise<boolean> {
  const identifier = identifierFor(channel, target);
  if (!identifier) return false;

  const hit = await prisma.outreachOptOut.findFirst({
    where: {
      workspaceId,
      identifier,
      // "all" blocks every channel for that identifier.
      channel: { in: [channel, "all"] },
    },
  });
  return Boolean(hit);
}

export async function assertNotOptedOut(
  workspaceId: string,
  channel: OutreachChannel,
  target: OptOutTarget,
): Promise<void> {
  if (await isOptedOut(workspaceId, channel, target)) {
    throw new AppError({
      kind: "blocked",
      message: "This contact has opted out of messages on this channel.",
      remedy:
        "Opt-outs are permanent by design. Remove it in Settings → Outreach only if the contact asked you to.",
    });
  }
}

export async function recordOptOut(
  workspaceId: string,
  channel: OutreachChannel | "all",
  identifier: string,
  opts: { reason?: string; source?: "manual" | "reply" | "webhook" } = {},
): Promise<void> {
  const clean = identifier.trim().toLowerCase();
  if (!clean) {
    throw new AppError({
      kind: "invalid-input",
      message: "An opt-out needs an email, phone number or handle.",
      remedy: "Supply the identifier the person asked you to stop contacting.",
    });
  }

  await prisma.outreachOptOut.upsert({
    where: { workspaceId_channel_identifier: { workspaceId, channel, identifier: clean } },
    create: {
      workspaceId,
      channel,
      identifier: clean,
      reason: opts.reason ?? null,
      source: opts.source ?? "manual",
    },
    update: { reason: opts.reason ?? null },
  });
}

/** Records opt-outs for every identifier a business exposes. */
export async function optOutBusiness(
  workspaceId: string,
  target: OptOutTarget,
  reason: string,
): Promise<number> {
  const entries: [OutreachChannel, string | null][] = [
    ["email", identifierFor("email", target)],
    ["whatsapp", identifierFor("whatsapp", target)],
    ["instagram", identifierFor("instagram", target)],
  ];

  let recorded = 0;
  for (const [channel, identifier] of entries) {
    if (!identifier) continue;
    await recordOptOut(workspaceId, channel, identifier, { reason, source: "manual" });
    recorded++;
  }
  return recorded;
}

export async function listOptOuts(workspaceId: string) {
  return prisma.outreachOptOut.findMany({
    where: { workspaceId },
    orderBy: { at: "desc" },
    take: 200,
  });
}

export async function removeOptOut(workspaceId: string, id: string): Promise<void> {
  await prisma.outreachOptOut.deleteMany({ where: { id, workspaceId } });
}
