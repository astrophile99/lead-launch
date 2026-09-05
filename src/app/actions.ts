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
import { updateSettings } from "@/services/settings";
import { completeTask } from "@/services/tasks";
import { generateBrief, updateBrief } from "@/services/website-brief";
import { restoreVersion, startBuild } from "@/services/website-projects";
import { readProjectFile } from "@/agents/website-builder";
import type { WebsiteBrief } from "@/types";

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
