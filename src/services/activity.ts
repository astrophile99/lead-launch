import { prisma } from "@/db/client";
import { toJson } from "@/lib/json";

/**
 * The activity log is the source of truth for what happened to a prospect.
 * Every service writes here; the UI never fabricates a timeline entry.
 */

export type ActivityType =
  | "prospect.discovered"
  | "prospect.stage-changed"
  | "prospect.tagged"
  | "prospect.note"
  | "audit.started"
  | "audit.completed"
  | "audit.failed"
  | "opportunity.scored"
  | "opportunity.analyzed"
  | "brief.generated"
  | "brief.approved"
  | "build.started"
  | "build.completed"
  | "build.failed"
  | "deployment.created"
  | "deployment.failed"
  | "outreach.drafted"
  | "outreach.approved"
  | "outreach.sent"
  | "outreach.replied"
  | "task.created"
  | "task.completed";

export async function logActivity(input: {
  workspaceId: string;
  prospectId?: string | null;
  type: ActivityType;
  message: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await prisma.activity.create({
    data: {
      workspaceId: input.workspaceId,
      prospectId: input.prospectId ?? null,
      type: input.type,
      message: input.message,
      metaJson: input.meta ? toJson(input.meta) : null,
    },
  });
}

export async function notify(input: {
  workspaceId: string;
  type: string;
  title: string;
  body?: string;
  level?: "info" | "success" | "warning" | "error";
  link?: string;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      workspaceId: input.workspaceId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      level: input.level ?? "info",
      link: input.link ?? null,
    },
  });
}
