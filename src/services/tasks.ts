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

/**
 * The next action is a *sales* action.
 *
 * Deliberately: nothing here ever suggests building a website before a
 * conversation has happened. Building is expensive, and a site nobody asked
 * for is the most expensive thing this app can do. Once a meeting is recorded
 * the suggestion appears, and even then it is a suggestion — the build itself
 * is always started by hand.
 */
export function suggestNextAction(s: ProspectState): { title: string; dueInDays: number } {
  if (s.stage === "won") return { title: "Kick off the project", dueInDays: 2 };
  if (s.stage === "lost" || s.stage === "not-interested") {
    return { title: "Archive or revisit next quarter", dueInDays: 90 };
  }

  if (!s.hasAudit) {
    return {
      title: s.hasWebsite ? "Audit the website" : "Confirm there is no website, then audit",
      dueInDays: 1,
    };
  }
  if (!s.hasOpportunity) return { title: "Run the opportunity analysis", dueInDays: 1 };

  if (s.hasDraftMessage && !s.hasApprovedMessage) {
    return { title: "Review and approve the outreach draft", dueInDays: 1 };
  }
  if (s.hasApprovedMessage && !s.hasSentMessage) {
    return { title: "Send the approved message", dueInDays: 1 };
  }
  if (!s.hasSentMessage && !s.hasDraftMessage) {
    return { title: "Draft the first message", dueInDays: 1 };
  }

  if (s.stage === "responded") return { title: "Read the reply and book a call", dueInDays: 1 };
  if (s.stage === "qualified") return { title: "Get a meeting in the diary", dueInDays: 2 };

  // Only past this line does building enter the conversation at all.
  if (s.stage === "meeting-scheduled") {
    return { title: "Prepare for the call", dueInDays: 1 };
  }
  if (s.stage === "meeting-completed") {
    return s.hasReadyWebsite
      ? { title: "Review the built site and send the proposal", dueInDays: 2 }
      : { title: "Build the website you discussed, then send the proposal", dueInDays: 3 };
  }
  if (s.stage === "proposal") return { title: "Chase the proposal", dueInDays: 4 };
  if (s.stage === "negotiation") return { title: "Confirm terms and close", dueInDays: 3 };
  if (s.stage === "contacted") {
    return { title: "Follow up on the last message", dueInDays: 3 };
  }
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
