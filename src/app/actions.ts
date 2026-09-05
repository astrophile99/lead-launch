"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AI_CAPABILITIES, AI_PROVIDERS } from "@/config/ai";
import { PIPELINE_STAGES } from "@/config/pipeline";
import { SCORING_FACTORS } from "@/config/scoring";
import { prisma } from "@/db/client";
import { assertCanWrite, getWorkspaceContext } from "@/db/workspace";
import { toAppError } from "@/lib/errors";
import { toJson } from "@/lib/json";
import { getDeploymentProvider } from "@/providers/deployment";
import { logActivity } from "@/services/activity";
import { auditMany, auditProspect } from "@/services/audit";
import { createCampaign, runCampaign } from "@/services/discovery";
import { analyseOpportunity, rescoreAll, refreshSuggestedTask } from "@/services/opportunity";
import {
  approveMessage,
  draftOutreach,
  optOut,
  recordReply,
  sendMessage,
} from "@/services/outreach";
import { getSettings, updateSettings } from "@/services/settings";
import { completeTask } from "@/services/tasks";
import { generateBrief, updateBrief } from "@/services/website-brief";
import { restoreVersion, startBuild } from "@/services/website-projects";
import { readProjectFile } from "@/agents/website-builder";
import { estimateCost } from "@/services/costs";
import { getIntegrationGroups } from "@/services/integrations";
import { listOptOuts, optOutBusiness, recordOptOut, removeOptOut } from "@/services/optouts";
import { getMessagingProvider } from "@/providers/messaging";
import { resolveRoute } from "@/providers/ai/router";
import { analyseStyle, deleteVoice, saveVoice, type Voice } from "@/services/voice";
import { refineMessage } from "@/services/outreach-refine";
import type { AIProviderId } from "@/config/ai";
import type { OutreachChannel, WebsiteBrief } from "@/types";

/**
 * The only place the UI mutates state.
 *
 * Every action resolves the workspace context first, validates its input, and
 * returns a discriminated result rather than throwing across the RSC boundary -
 * so the caller can always render a real error together with its remedy.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { kind: string; message: string; remedy: string; retryable: boolean };
    };

async function act<T>(fn: (workspaceId: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await getWorkspaceContext();
    assertCanWrite(ctx);
    return { ok: true, data: await fn(ctx.workspaceId) };
  } catch (e) {
    const err = toAppError(e);
    return { ok: false, error: err.toJSON() };
  }
}

/* ------------------------------------------------------------------ discovery */

const campaignSchema = z.object({
  name: z.string().max(120).default(""),
  category: z.string().min(2).max(80),
  country: z.string().min(2).max(60).default("India"),
  city: z.string().min(2).max(80),
  area: z.string().max(80).nullable().optional(),
  targetCount: z.coerce.number().int().min(1).max(200),
  minRating: z.coerce.number().min(0).max(5).nullable().optional(),
  minReviews: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  websiteFilter: z.enum(["any", "none", "poor", "good"]).default("any"),
  keywords: z.string().max(120).nullable().optional(),
  autoAudit: z.boolean().default(true),
});

export async function launchCampaignAction(
  raw: unknown,
): Promise<ActionResult<{ campaignId: string; discovered: number; duplicates: number; audited: number }>> {
  return act(async (workspaceId) => {
    const input = campaignSchema.parse(raw);
    const campaign = await createCampaign(workspaceId, {
      ...input,
      area: input.area || null,
      minRating: input.minRating ?? null,
      minReviews: input.minReviews ?? null,
      keywords: input.keywords || null,
    });
    const progress = await runCampaign(workspaceId, campaign.id, {
      autoAudit: input.autoAudit,
    });
    revalidatePath("/discover");
    revalidatePath("/prospects");
    revalidatePath("/");
    return {
      campaignId: campaign.id,
      discovered: progress.discovered,
      duplicates: progress.duplicates,
      audited: progress.audited,
    };
  });
}

export async function rerunCampaignAction(
  campaignId: string,
  autoAudit: boolean,
): Promise<ActionResult<{ discovered: number; duplicates: number }>> {
  return act(async (workspaceId) => {
    const progress = await runCampaign(workspaceId, campaignId, { autoAudit });
    revalidatePath(`/discover/${campaignId}`);
    revalidatePath("/prospects");
    return { discovered: progress.discovered, duplicates: progress.duplicates };
  });
}

/* --------------------------------------------------------------------- audit */

export async function auditProspectAction(
  prospectId: string,
): Promise<ActionResult<{ status: string; score: number | null }>> {
  return act(async (workspaceId) => {
    const result = await auditProspect(workspaceId, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
    revalidatePath("/audit");
    revalidatePath("/radar");
    return { status: result.status, score: result.scores?.overall ?? null };
  });
}

export async function auditManyAction(
  prospectIds: string[],
): Promise<ActionResult<{ completed: number; failed: number }>> {
  return act(async (workspaceId) => {
    const ids = z.array(z.string().min(1)).max(100).parse(prospectIds);
    const result = await auditMany(workspaceId, ids);
    revalidatePath("/audit");
    revalidatePath("/prospects");
    revalidatePath("/radar");
    return result;
  });
}

export async function rescoreAllAction(): Promise<ActionResult<{ count: number }>> {
  return act(async (workspaceId) => {
    const count = await rescoreAll(workspaceId);
    revalidatePath("/radar");
    revalidatePath("/prospects");
    return { count };
  });
}

/* --------------------------------------------------------------- opportunity */

export async function analyseOpportunityAction(
  prospectId: string,
): Promise<ActionResult<{ isMock: boolean }>> {
  return act(async (workspaceId) => {
    const result = await analyseOpportunity(workspaceId, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
    revalidatePath("/radar");
    return { isMock: result.isMock };
  });
}

/* -------------------------------------------------------------------- studio */

export async function generateBriefAction(
  prospectId: string,
): Promise<ActionResult<{ projectId: string; isMock: boolean }>> {
  return act(async (workspaceId) => {
    const { project, isMock } = await generateBrief(workspaceId, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
    revalidatePath("/studio");
    return { projectId: project.id, isMock };
  });
}

export async function updateBriefAction(
  projectId: string,
  brief: WebsiteBrief,
): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await updateBrief(workspaceId, projectId, brief);
    revalidatePath(`/studio/${projectId}`);
    return undefined;
  });
}

export async function startBuildAction(
  projectId: string,
): Promise<ActionResult<{ version: number; qualityScore: number | null }>> {
  return act(async (workspaceId) => {
    const result = await startBuild(workspaceId, projectId);
    revalidatePath(`/studio/${projectId}`);
    revalidatePath("/studio");
    return { version: result.version, qualityScore: result.qualityScore };
  });
}

export async function restoreVersionAction(
  projectId: string,
  versionId: string,
): Promise<ActionResult<{ version: number }>> {
  return act(async (workspaceId) => {
    const result = await restoreVersion(workspaceId, projectId, versionId);
    revalidatePath(`/studio/${projectId}`);
    return { version: result.version };
  });
}

export async function deployProjectAction(
  projectId: string,
  environment: "preview" | "production",
): Promise<ActionResult<{ url: string | null; status: string }>> {
  return act(async (workspaceId) => {
    const project = await prisma.websiteProject.findFirst({
      where: { id: projectId, workspaceId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!project) throw toAppError(new Error("Project not found."));

    const provider = getDeploymentProvider();
    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        versionId: project.versions[0]?.id ?? null,
        provider: provider.id,
        environment,
        status: "pending",
      },
    });

    try {
      const files = await Promise.all(
        ["index.html", "styles.css", "favicon.svg", "robots.txt", "sitemap.xml"].map(async (p) => ({
          path: p,
          content: (await readProjectFile(project.slug, p)).content.toString("utf8"),
        })),
      );
      const result = await provider.deploy({
        projectSlug: project.slug,
        files,
        environment,
      });
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: {
          status: result.status,
          previewUrl: environment === "preview" ? result.url : null,
          productionUrl: environment === "production" ? result.url : null,
          completedAt: new Date(),
        },
      });
      if (result.status === "ready") {
        await prisma.websiteProject.update({
          where: { id: projectId },
          data: { status: "deployed" },
        });
      }
      await logActivity({
        workspaceId,
        prospectId: project.prospectId,
        type: "deployment.created",
        message: `Deployed to ${provider.label} (${environment}).`,
        meta: { url: result.url },
      });
      revalidatePath(`/studio/${projectId}`);
      return { url: result.url, status: result.status };
    } catch (e) {
      const err = toAppError(e);
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: "failed", error: err.message, completedAt: new Date() },
      });
      await logActivity({
        workspaceId,
        prospectId: project.prospectId,
        type: "deployment.failed",
        message: `Deployment failed: ${err.message}`,
      });
      throw err;
    }
  });
}

/* ------------------------------------------------------------------ outreach */

const draftSchema = z.object({
  prospectId: z.string().min(1),
  channel: z.enum(["email", "whatsapp", "instagram", "linkedin", "generic"]),
  variant: z.enum(["short", "normal", "detailed", "followup1", "followup2", "final"]),
});

export async function draftOutreachAction(
  raw: unknown,
): Promise<ActionResult<{ messageId: string; isMock: boolean }>> {
  return act(async (workspaceId) => {
    const input = draftSchema.parse(raw);
    const { message, isMock } = await draftOutreach(
      workspaceId,
      input.prospectId,
      input.channel,
      input.variant,
    );
    revalidatePath(`/prospects/${input.prospectId}`);
    revalidatePath("/outreach");
    return { messageId: message.id, isMock };
  });
}

export async function approveMessageAction(messageId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await approveMessage(workspaceId, messageId);
    revalidatePath("/outreach");
    return undefined;
  });
}

export async function sendMessageAction(messageId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await sendMessage(workspaceId, messageId);
    revalidatePath("/outreach");
    revalidatePath("/pipeline");
    return undefined;
  });
}

export async function markSentManuallyAction(messageId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const message = await prisma.outreachMessage.findFirst({
      where: { id: messageId, prospect: { workspaceId } },
    });
    if (!message) throw toAppError(new Error("Message not found."));
    if (message.status !== "approved") {
      throw toAppError(new Error("Only approved messages can be marked as sent."));
    }
    await prisma.outreachMessage.update({
      where: { id: messageId },
      data: { status: "sent", sentAt: new Date() },
    });
    await prisma.outreachEvent.create({
      data: { messageId, type: "sent", detail: "Marked as sent by hand by the user." },
    });
    await prisma.prospect.update({
      where: { id: message.prospectId },
      data: { lastContactAt: new Date(), stage: "contacted" },
    });
    await logActivity({
      workspaceId,
      prospectId: message.prospectId,
      type: "outreach.sent",
      message: "Marked as sent by hand.",
      meta: { messageId },
    });
    await refreshSuggestedTask(workspaceId, message.prospectId);
    revalidatePath("/outreach");
    return undefined;
  });
}

export async function recordReplyAction(messageId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await recordReply(workspaceId, messageId);
    revalidatePath("/outreach");
    revalidatePath("/pipeline");
    return undefined;
  });
}

export async function optOutAction(prospectId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await optOut(workspaceId, prospectId);
    revalidatePath(`/prospects/${prospectId}`);
    revalidatePath("/outreach");
    return undefined;
  });
}

/* ---------------------------------------------------------------- prospects */

export async function setStageAction(
  prospectId: string,
  stage: string,
): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const parsed = z.enum(PIPELINE_STAGES).parse(stage);
    const prospect = await prisma.prospect.findFirst({
      where: { id: prospectId, workspaceId },
      include: { business: { select: { name: true } } },
    });
    if (!prospect) throw toAppError(new Error("Prospect not found."));
    await prisma.prospect.update({ where: { id: prospectId }, data: { stage: parsed } });
    await logActivity({
      workspaceId,
      prospectId,
      type: "prospect.stage-changed",
      message: `Stage changed from ${prospect.stage} to ${parsed}.`,
      meta: { from: prospect.stage, to: parsed },
    });
    await refreshSuggestedTask(workspaceId, prospectId);
    revalidatePath("/pipeline");
    revalidatePath(`/prospects/${prospectId}`);
    return undefined;
  });
}

export async function updateProspectAction(
  prospectId: string,
  patch: { priority?: string; estimatedValue?: number | null; serviceType?: string | null },
): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const parsed = z
      .object({
        priority: z.enum(["low", "normal", "high"]).optional(),
        estimatedValue: z.coerce.number().int().min(0).max(100_000_000).nullable().optional(),
        serviceType: z.string().max(80).nullable().optional(),
      })
      .parse(patch);
    const owned = await prisma.prospect.count({ where: { id: prospectId, workspaceId } });
    if (!owned) throw toAppError(new Error("Prospect not found."));
    await prisma.prospect.update({ where: { id: prospectId }, data: parsed });
    revalidatePath(`/prospects/${prospectId}`);
    return undefined;
  });
}

export async function addNoteAction(prospectId: string, body: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const text = z.string().trim().min(1).max(4000).parse(body);
    const ctx = await getWorkspaceContext();
    const owned = await prisma.prospect.count({ where: { id: prospectId, workspaceId } });
    if (!owned) throw toAppError(new Error("Prospect not found."));
    await prisma.note.create({ data: { prospectId, body: text, authorId: ctx.userId } });
    await logActivity({
      workspaceId,
      prospectId,
      type: "prospect.note",
      message: "Note added.",
    });
    revalidatePath(`/prospects/${prospectId}`);
    return undefined;
  });
}

export async function toggleTagAction(
  prospectId: string,
  tagId: string,
): Promise<ActionResult<{ attached: boolean }>> {
  return act(async (workspaceId) => {
    const owned = await prisma.prospect.count({ where: { id: prospectId, workspaceId } });
    const tagOwned = await prisma.tag.count({ where: { id: tagId, workspaceId } });
    if (!owned || !tagOwned) throw toAppError(new Error("Prospect or tag not found."));

    const existing = await prisma.prospectTag.findUnique({
      where: { prospectId_tagId: { prospectId, tagId } },
    });
    if (existing) {
      await prisma.prospectTag.delete({ where: { prospectId_tagId: { prospectId, tagId } } });
      revalidatePath(`/prospects/${prospectId}`);
      return { attached: false };
    }
    await prisma.prospectTag.create({ data: { prospectId, tagId } });
    revalidatePath(`/prospects/${prospectId}`);
    return { attached: true };
  });
}

export async function bulkTagAction(
  prospectIds: string[],
  tagId: string,
): Promise<ActionResult<{ tagged: number }>> {
  return act(async (workspaceId) => {
    const ids = z.array(z.string()).max(500).parse(prospectIds);
    const tagOwned = await prisma.tag.count({ where: { id: tagId, workspaceId } });
    if (!tagOwned) throw toAppError(new Error("Tag not found."));
    const owned = await prisma.prospect.findMany({
      where: { id: { in: ids }, workspaceId },
      select: { id: true },
    });
    let tagged = 0;
    for (const p of owned) {
      const exists = await prisma.prospectTag.findUnique({
        where: { prospectId_tagId: { prospectId: p.id, tagId } },
      });
      if (!exists) {
        await prisma.prospectTag.create({ data: { prospectId: p.id, tagId } });
        tagged++;
      }
    }
    revalidatePath("/prospects");
    return { tagged };
  });
}

export async function createTagAction(name: string): Promise<ActionResult<{ id: string }>> {
  return act(async (workspaceId) => {
    const clean = z.string().trim().min(1).max(40).parse(name);
    const tag = await prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId, name: clean } },
      create: { workspaceId, name: clean },
      update: {},
    });
    revalidatePath("/prospects");
    return { id: tag.id };
  });
}

export async function completeTaskAction(taskId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const owned = await prisma.task.count({ where: { id: taskId, workspaceId } });
    if (!owned) throw toAppError(new Error("Task not found."));
    await completeTask(taskId);
    revalidatePath("/pipeline");
    return undefined;
  });
}

export async function createTaskAction(
  prospectId: string | null,
  title: string,
  dueInDays: number,
): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const clean = z.string().trim().min(1).max(160).parse(title);
    const days = z.coerce.number().int().min(0).max(365).parse(dueInDays);
    await prisma.task.create({
      data: {
        workspaceId,
        prospectId,
        title: clean,
        kind: "manual",
        dueAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    revalidatePath("/pipeline");
    if (prospectId) revalidatePath(`/prospects/${prospectId}`);
    return undefined;
  });
}

/* ---------------------------------------------------------------- settings */

export async function updateSettingsAction(patch: unknown): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const schema = z.object({
      scoringWeights: z
        .object(Object.fromEntries(SCORING_FACTORS.map((f) => [f, z.coerce.number().min(0).max(1)])) as never)
        .optional(),
      costMode: z.enum(["economy", "balanced", "quality"]).optional(),
      discoveryProvider: z.string().nullable().optional(),
      outreachRequiresApproval: z.boolean().optional(),
      maxQaIterations: z.coerce.number().int().min(1).max(10).optional(),
      senderName: z.string().max(80).optional(),
      senderRole: z.string().max(80).optional(),
    });
    const parsed = schema.parse(patch);
    await updateSettings(workspaceId, parsed as never);
    revalidatePath("/settings");
    revalidatePath("/radar");
    return undefined;
  });
}

export async function updateRoutingAction(
  capability: string,
  provider: string,
  model: string,
  fallbackProvider: string | null,
  fallbackModel: string | null,
): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const cap = z.enum(AI_CAPABILITIES).parse(capability);
    const prov = z.enum(AI_PROVIDERS).parse(provider);
    const mdl = z.string().min(1).max(80).parse(model);
    await prisma.aIProviderConfig.upsert({
      where: { workspaceId_capability: { workspaceId, capability: cap } },
      create: {
        workspaceId,
        capability: cap,
        provider: prov,
        model: mdl,
        fallbackProvider,
        fallbackModel,
      },
      update: { provider: prov, model: mdl, fallbackProvider, fallbackModel },
    });
    revalidatePath("/ai");
    return undefined;
  });
}

export async function retryJobAction(jobId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const job = await prisma.aIJob.findFirst({ where: { id: jobId, workspaceId } });
    if (!job) throw toAppError(new Error("Job not found."));
    if (!job.entityId) throw toAppError(new Error("This job has no entity to retry against."));

    if (job.type === "opportunity.analyze") await analyseOpportunity(workspaceId, job.entityId);
    else if (job.type === "website.brief") await generateBrief(workspaceId, job.entityId);
    else {
      throw toAppError(
        new Error(`Retrying "${job.type}" from here is not supported; rerun it from the prospect.`),
      );
    }
    revalidatePath("/ai");
    return undefined;
  });
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await prisma.notification.updateMany({
      where: { workspaceId, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/");
    return undefined;
  });
}

/* ------------------------------------------------------------------ export */

export async function exportProspectsCsvAction(): Promise<ActionResult<{ csv: string }>> {
  return act(async (workspaceId) => {
    const prospects = await prisma.prospect.findMany({
      where: { workspaceId },
      include: {
        business: true,
        tags: { include: { tag: true } },
        notes: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { opportunityScore: "desc" },
    });

    const header = [
      "Business", "Category", "City", "Area", "Phone", "Email", "Website",
      "Rating", "Reviews", "Website Score", "Opportunity", "Contactability",
      "Stage", "Estimated Value", "Tags", "Last Contact", "Latest Note", "Source", "Demo Data",
    ];

    const cell = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = prospects.map((p) =>
      [
        p.business.name, p.business.category, p.business.city, p.business.area ?? "",
        p.business.phone ?? "", p.business.email ?? "", p.business.website ?? "",
        p.business.rating ?? "", p.business.reviewCount ?? "",
        p.websiteScore ?? "", p.opportunityScore ?? "", p.contactabilityScore ?? "",
        p.stage, p.estimatedValue ?? "",
        p.tags.map((t) => t.tag.name).join("; "),
        p.lastContactAt?.toISOString() ?? "",
        p.notes[0]?.body ?? "",
        p.leadSource ?? "",
        p.business.isMock ? "yes" : "no",
      ].map(cell).join(","),
    );

    return { csv: [header.join(","), ...rows].join("\n") };
  });
}

export async function saveViewAction(
  name: string,
  scope: string,
  config: unknown,
): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const clean = z.string().trim().min(1).max(60).parse(name);
    await prisma.savedView.upsert({
      where: { workspaceId_scope_name: { workspaceId, scope, name: clean } },
      create: { workspaceId, scope, name: clean, configJson: toJson(config) },
      update: { configJson: toJson(config) },
    });
    revalidatePath("/prospects");
    return undefined;
  });
}

export async function deleteViewAction(id: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await prisma.savedView.deleteMany({ where: { id, workspaceId } });
    revalidatePath("/prospects");
    return undefined;
  });
}

/* ------------------------------------------------------------- integrations */

export async function testIntegrationAction(
  itemId: string,
): Promise<ActionResult<{ ok: boolean; detail: string }>> {
  return act(async (workspaceId) => {
    // Messaging transports know how to verify themselves against the live API.
    const messaging = ["resend", "whatsapp-cloud", "instagram-graph"];
    if (messaging.includes(itemId)) {
      const channel: OutreachChannel =
        itemId === "resend" ? "email" : itemId === "whatsapp-cloud" ? "whatsapp" : "instagram";
      const result = await getMessagingProvider(channel).testConnection(workspaceId);
      revalidatePath("/settings");
      return result;
    }

    if (itemId === "database") {
      // A real round-trip, not a config read: the one check that can prove the
      // connection rather than infer it.
      const started = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, detail: `Query round-trip in ${Date.now() - started}ms.` };
    }

    if (itemId === "lighthouse-psi") {
      const key = process.env.PAGESPEED_API_KEY;
      if (!key) return { ok: false, detail: "PAGESPEED_API_KEY is not set." };
      const res = await fetch(
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fexample.com&key=${encodeURIComponent(key)}&category=performance`,
      );
      return res.ok
        ? { ok: true, detail: "PageSpeed accepted the key." }
        : { ok: false, detail: `PageSpeed returned HTTP ${res.status}.` };
    }

    if (itemId === "google-places") {
      const key = process.env.GOOGLE_PLACES_API_KEY;
      if (!key) return { ok: false, detail: "GOOGLE_PLACES_API_KEY is not set." };
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "places.id",
        },
        body: JSON.stringify({ textQuery: "coffee", pageSize: 1 }),
      });
      return res.ok
        ? { ok: true, detail: "Places accepted the key." }
        : { ok: false, detail: `Places returned HTTP ${res.status}. Check the key restrictions.` };
    }

    if (itemId === "vercel") {
      const token = process.env.VERCEL_TOKEN;
      if (!token) return { ok: false, detail: "VERCEL_TOKEN is not set." };
      const res = await fetch("https://api.vercel.com/v2/user", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { ok: false, detail: `Vercel returned HTTP ${res.status}.` };
      const data = (await res.json()) as { user?: { username?: string } };
      return { ok: true, detail: `Authenticated as ${data.user?.username ?? "unknown user"}.` };
    }

    if (["anthropic", "openai", "gemini"].includes(itemId)) {
      const key =
        itemId === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : itemId === "openai"
            ? process.env.OPENAI_API_KEY
            : process.env.GEMINI_API_KEY;
      if (!key) return { ok: false, detail: `No key configured for ${itemId}.` };

      // Deliberately a metadata call, not a completion: testing a connection
      // should never cost the user money.
      const url =
        itemId === "anthropic"
          ? "https://api.anthropic.com/v1/models"
          : itemId === "openai"
            ? "https://api.openai.com/v1/models"
            : `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
      const headers: Record<string, string> =
        itemId === "anthropic"
          ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
          : itemId === "openai"
            ? { authorization: `Bearer ${key}` }
            : {};

      const res = await fetch(url, { headers });
      return res.ok
        ? { ok: true, detail: "The key was accepted." }
        : { ok: false, detail: `Provider returned HTTP ${res.status}.` };
    }

    return {
      ok: false,
      detail: "This integration has no automated test. Verify its configuration by hand.",
    };
  });
}

export async function listIntegrationsAction() {
  return act(async (workspaceId) => getIntegrationGroups(workspaceId));
}

/* ---------------------------------------------------------------- WhatsApp */

const whatsappSchema = z.object({
  metaAppId: z.string().trim().max(64).nullable().optional(),
  businessAccountId: z.string().trim().max(64).nullable().optional(),
  phoneNumberId: z.string().trim().max(64).nullable().optional(),
  displayPhoneNumber: z.string().trim().max(32).nullable().optional(),
  apiVersion: z
    .string()
    .trim()
    .regex(/^v\d+\.\d+$/, "Use a Graph API version such as v21.0")
    .default("v21.0"),
  webhookVerifyToken: z.string().trim().max(120).nullable().optional(),
});

export async function saveWhatsAppAction(raw: unknown): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const input = whatsappSchema.parse(raw);
    const data = {
      metaAppId: input.metaAppId || null,
      businessAccountId: input.businessAccountId || null,
      phoneNumberId: input.phoneNumberId || null,
      displayPhoneNumber: input.displayPhoneNumber || null,
      apiVersion: input.apiVersion,
      webhookVerifyToken: input.webhookVerifyToken || null,
      tokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      // Saving configuration is not a connection. Only a passing test is.
      status: "not-configured",
      lastError: null,
    };
    await prisma.whatsAppAccount.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });
    revalidatePath("/settings");
    return undefined;
  });
}

/* --------------------------------------------------------------- Instagram */

const instagramSchema = z.object({
  metaAppId: z.string().trim().max(64).nullable().optional(),
  igBusinessId: z.string().trim().max(64).nullable().optional(),
  pageId: z.string().trim().max(64).nullable().optional(),
  username: z.string().trim().max(64).nullable().optional(),
});

export async function saveInstagramAction(raw: unknown): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const input = instagramSchema.parse(raw);
    const data = {
      metaAppId: input.metaAppId || null,
      igBusinessId: input.igBusinessId || null,
      pageId: input.pageId || null,
      username: input.username?.replace(/^@/, "") || null,
      tokenConfigured: Boolean(process.env.INSTAGRAM_ACCESS_TOKEN),
      status: "not-configured",
      lastError: null,
    };
    await prisma.instagramAccount.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    });
    revalidatePath("/settings");
    return undefined;
  });
}

/* ------------------------------------------------------------------- voice */

const voiceSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(60),
  isDefault: z.boolean(),
  tone: z.enum([
    "professional",
    "friendly",
    "casual",
    "direct",
    "premium",
    "consultative",
    "bold",
  ]),
  length: z.enum(["short", "medium", "detailed"]),
  salesIntensity: z.enum(["soft", "balanced", "direct"]),
  formality: z.enum(["low", "medium", "high"]),
  personality: z.array(z.string().max(40)).max(8),
  customInstructions: z.string().max(1200).nullable(),
  exampleMessages: z.array(z.string().max(4000)).max(10),
});

export async function saveVoiceAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return act(async (workspaceId) => {
    const input = voiceSchema.parse(raw);
    const voice = await saveVoice(
      workspaceId,
      input as Omit<Voice, "id" | "analysis" | "analysedAt"> & { id?: string },
    );
    revalidatePath("/outreach");
    revalidatePath("/settings");
    return { id: voice.id };
  });
}

export async function deleteVoiceAction(id: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await deleteVoice(workspaceId, id);
    revalidatePath("/outreach");
    return undefined;
  });
}

export async function analyseStyleAction(
  voiceId: string,
  samples: string[],
): Promise<ActionResult<{ isMock: boolean; summary: string }>> {
  return act(async (workspaceId) => {
    const clean = z.array(z.string().max(4000)).max(10).parse(samples);
    const { profile, isMock } = await analyseStyle(workspaceId, voiceId, clean);
    revalidatePath("/outreach");
    return { isMock, summary: profile.summary };
  });
}

/* --------------------------------------------------------- outreach revise */

export async function refineMessageAction(
  messageId: string,
  refinement: string,
): Promise<ActionResult<{ changed: string; isMock: boolean }>> {
  return act(async (workspaceId) => {
    const parsed = z
      .enum(["shorten", "warmer", "more-direct", "less-salesy", "use-my-voice", "regenerate"])
      .parse(refinement);
    const result = await refineMessage(workspaceId, messageId, parsed);
    revalidatePath("/outreach");
    return { changed: result.changed, isMock: result.isMock };
  });
}

export async function draftSequenceAction(
  prospectId: string,
  channel: string,
): Promise<ActionResult<{ created: number; failed: number }>> {
  return act(async (workspaceId) => {
    const ch = z
      .enum(["email", "whatsapp", "instagram", "linkedin", "generic"])
      .parse(channel) as OutreachChannel;

    let created = 0;
    let failed = 0;
    // Sequential on purpose: each draft is a paid model call, and a partial
    // sequence is more useful than a burst that trips a rate limit.
    for (const variant of ["normal", "followup1", "followup2", "final"] as const) {
      try {
        await draftOutreach(workspaceId, prospectId, ch, variant);
        created++;
      } catch {
        failed++;
      }
    }
    revalidatePath(`/prospects/${prospectId}`);
    revalidatePath("/outreach");
    return { created, failed };
  });
}

/* ---------------------------------------------------------------- opt-outs */

export async function recordOptOutAction(
  channel: string,
  identifier: string,
  reason?: string,
): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const ch = z
      .enum(["email", "whatsapp", "instagram", "linkedin", "generic", "all"])
      .parse(channel);
    await recordOptOut(workspaceId, ch, identifier, { reason, source: "manual" });
    revalidatePath("/settings");
    revalidatePath("/outreach");
    return undefined;
  });
}

export async function removeOptOutAction(id: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    await removeOptOut(workspaceId, id);
    revalidatePath("/settings");
    return undefined;
  });
}

export async function listOptOutsAction() {
  return act(async (workspaceId) => {
    const rows = await listOptOuts(workspaceId);
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      identifier: r.identifier,
      reason: r.reason,
      at: r.at.toISOString(),
    }));
  });
}

/* --------------------------------------------------------------- workspace */

export async function updateWorkspaceAction(patch: {
  name?: string;
  currency?: string;
  timezone?: string;
}): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        currency: z.string().trim().length(3).optional(),
        timezone: z.string().trim().max(64).optional(),
      })
      .parse(patch);
    await prisma.workspace.update({ where: { id: workspaceId }, data: parsed });
    revalidatePath("/settings");
    revalidatePath("/");
    return undefined;
  });
}

export async function dismissSetupStepAction(stepId: string): Promise<ActionResult> {
  return act(async (workspaceId) => {
    const settings = await getSettings(workspaceId);
    await updateSettings(workspaceId, {
      dismissedSetupSteps: [...new Set([...settings.dismissedSetupSteps, stepId])],
    });
    revalidatePath("/");
    return undefined;
  });
}

/* -------------------------------------------------------------- estimation */

export async function estimateCampaignCostAction(input: {
  prospectCount: number;
  autoAudit: boolean;
  autoAnalyse: boolean;
}): Promise<
  ActionResult<{
    lowUsd: number | null;
    highUsd: number | null;
    calls: number;
    assumptions: string[];
    priced: boolean;
  }>
> {
  return act(async (workspaceId) => {
    const parsed = z
      .object({
        prospectCount: z.coerce.number().int().min(1).max(200),
        autoAudit: z.boolean(),
        autoAnalyse: z.boolean(),
      })
      .parse(input);

    const analysis = await resolveRoute(workspaceId, "analysis");

    const tasks: { type: string; count: number; provider: AIProviderId; model: string }[] = [];
    if (parsed.autoAnalyse) {
      tasks.push({
        type: "opportunity.analyze",
        count: parsed.prospectCount,
        provider: analysis.provider.id,
        model: analysis.model,
      });
    }

    const estimate = estimateCost(tasks);
    // Auditing costs no tokens: it is an HTTP fetch plus local parsing.
    if (parsed.autoAudit) {
      estimate.assumptions.push(
        `${parsed.prospectCount} website audits — no AI tokens; one HTTP request each.`,
      );
    }
    if (tasks.length === 0) {
      estimate.assumptions.push("No AI calls selected, so this campaign costs nothing to run.");
    }
    return estimate;
  });
}

/**
 * Marks a prospect not interested and records a permanent opt-out for every
 * identifier they expose, so a later campaign cannot re-add and re-contact them.
 */
export async function optOutProspectAction(
  prospectId: string,
): Promise<ActionResult<{ recorded: number }>> {
  return act(async (workspaceId) => {
    const prospect = await prisma.prospect.findFirst({
      where: { id: prospectId, workspaceId },
      include: { business: true },
    });
    if (!prospect) throw toAppError(new Error("Prospect not found."));

    await optOut(workspaceId, prospectId);
    const recorded = await optOutBusiness(
      workspaceId,
      {
        email: prospect.business.email,
        phone: prospect.business.phone,
        instagram: prospect.business.instagram,
      },
      "Marked not interested",
    );
    revalidatePath(`/prospects/${prospectId}`);
    revalidatePath("/outreach");
    return { recorded };
  });
}
