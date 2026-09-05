import { prisma } from "@/db/client";
import type { PipelineStage } from "@/config/pipeline";
import { logActivity } from "./activity";

/**
 * Next-action engine.
 *
 * A prospect's suggested next action is derived from its actual state - stage,
 * whether an audit exists, whether a draft is awaiting approval - rather than
 * stored as a static field that drifts. `syncSuggestedTask` keeps exactly one
 * open suggested task per prospect; manual tasks are never touched.
 */

export type ProspectState = {
  id: string;
  stage: PipelineStage;
  hasWebsite: boolean;
  hasAudit: boolean;
  hasOpportunity: boolean;
  hasBrief: boolean;
  hasReadyWebsite: boolean;
  hasDraftMessage: boolean;
  hasApprovedMessage: boolean;
  hasSentMessage: boolean;
  lastContactAt: Date | null;
};

export function suggestNextAction(s: ProspectState): { title: string; dueInDays: number } {
  if (!s.hasAudit) {
    return {
      title: s.hasWebsite ? "Audit the website" : "Confirm there is no website, then audit",
      dueInDays: 1,
    };
  }
  if (!s.hasOpportunity) return { title: "Run the opportunity analysis", dueInDays: 1 };
  if (s.stage === "won") return { title: "Kick off the project", dueInDays: 2 };
  if (s.stage === "lost" || s.stage === "not-interested") {
    return { title: "Archive or revisit next quarter", dueInDays: 90 };
  }
  if (s.hasDraftMessage && !s.hasApprovedMessage) {
    return { title: "Review and approve the outreach draft", dueInDays: 1 };
  }
  if (!s.hasBrief && !s.hasSentMessage) {
    return { title: "Generate a website concept to pitch against", dueInDays: 2 };
  }
  if (s.hasBrief && !s.hasReadyWebsite && s.stage !== "building") {
    return { title: "Approve the brief and start the build", dueInDays: 2 };
  }
  if (s.hasReadyWebsite && !s.hasDraftMessage) {
    return { title: "Draft outreach referencing the new site", dueInDays: 1 };
  }
  if (s.hasApprovedMessage && !s.hasSentMessage) {
    return { title: "Send the approved message", dueInDays: 1 };
  }
  if (s.stage === "contacted" || s.stage === "follow-up") {
    return { title: "Follow up on the last message", dueInDays: 3 };
  }
  if (s.stage === "meeting") return { title: "Send the proposal", dueInDays: 2 };
  if (s.stage === "proposal") return { title: "Chase the proposal", dueInDays: 4 };
  if (s.stage === "negotiation") return { title: "Confirm terms and close", dueInDays: 3 };
  return { title: "Review this prospect", dueInDays: 7 };
}

export async function syncSuggestedTask(
  workspaceId: string,
  state: ProspectState,
): Promise<void> {
  const suggestion = suggestNextAction(state);
  const existing = await prisma.task.findFirst({
    where: { prospectId: state.id, kind: "suggested", status: "open" },
  });

  if (existing) {
    if (existing.title === suggestion.title) return;
    await prisma.task.update({
      where: { id: existing.id },
      data: { status: "dismissed", completedAt: new Date() },
    });
  }

  await prisma.task.create({
    data: {
      workspaceId,
      prospectId: state.id,
      title: suggestion.title,
      kind: "suggested",
      dueAt: new Date(Date.now() + suggestion.dueInDays * 86_400_000),
    },
  });
}

export async function completeTask(taskId: string): Promise<void> {
  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: "done", completedAt: new Date() },
  });
  await logActivity({
    workspaceId: task.workspaceId,
    prospectId: task.prospectId,
    type: "task.completed",
    message: `Completed: ${task.title}`,
  });
}
