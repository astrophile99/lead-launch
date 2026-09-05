import { prisma } from "@/db/client";
import { fromJson } from "@/lib/json";

/**
 * A single view over every long-running operation in the system.
 *
 * There is deliberately no `Job` table: discovery lives on Campaign, audits on
 * WebsiteAudit, builds on WebsiteBuild, and so on. Each of those already
 * records the truth about its own run, and a parallel job table would be a
 * second place for that truth to drift. This service unions them into one
 * shape for the UI.
 *
 * Everything here is polled today. The shape is deliberately serialisable so
 * the same rows can later arrive over SSE, WebSockets or Supabase Realtime
 * without the UI changing.
 */

export type JobKind =
  | "discovery"
  | "audit"
  | "ai"
  | "build"
  | "deployment"
  | "outreach";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobView = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  title: string;
  detail: string;
  /** Progress when the operation reports it; null when it is a single step. */
  progress: { done: number; total: number | null } | null;
  provider: string | null;
  isMock: boolean;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  error: { message: string; remedy: string } | null;
  href: string | null;
};

function normaliseStatus(raw: string): JobStatus {
  switch (raw) {
    case "complete":
    case "completed":
    case "ready":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "queued":
    case "draft":
    case "pending":
      return "queued";
    default:
      return "running";
  }
}

function ms(from: Date, to: Date | null): number | null {
  return to ? to.getTime() - from.getTime() : null;
}

export async function listJobs(
  workspaceId: string,
  opts: { limit?: number; kinds?: JobKind[] } = {},
): Promise<JobView[]> {
  const limit = opts.limit ?? 40;
  const want = (k: JobKind) => !opts.kinds || opts.kinds.includes(k);

  const [campaigns, audits, aiJobs, builds, deployments, messages] = await Promise.all([
    want("discovery")
      ? prisma.campaign.findMany({
          where: { workspaceId },
          orderBy: { createdAt: "desc" },
          take: limit,
        })
      : [],
    want("audit")
      ? prisma.websiteAudit.findMany({
          where: { prospect: { workspaceId } },
          orderBy: { startedAt: "desc" },
          take: limit,
          include: { prospect: { include: { business: { select: { name: true } } } } },
        })
      : [],
    want("ai")
      ? prisma.aIJob.findMany({
          where: { workspaceId },
          orderBy: { createdAt: "desc" },
          take: limit,
        })
      : [],
    want("build")
      ? prisma.websiteBuild.findMany({
          where: { project: { workspaceId } },
          orderBy: { startedAt: "desc" },
          take: limit,
          include: { project: { include: { prospect: { include: { business: true } } } } },
        })
      : [],
    want("deployment")
      ? prisma.deployment.findMany({
          where: { project: { workspaceId } },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: { project: { include: { prospect: { include: { business: true } } } } },
        })
      : [],
    want("outreach")
      ? prisma.outreachMessage.findMany({
          where: { prospect: { workspaceId }, status: { in: ["sent", "bounced"] } },
          orderBy: { createdAt: "desc" },
          take: limit,
          include: { prospect: { include: { business: { select: { name: true } } } } },
        })
      : [],
  ]);

  const jobs: JobView[] = [];

  for (const c of campaigns) {
    const err = fromJson<{ message: string; remedy: string } | null>(c.error, null);
    jobs.push({
      id: `campaign:${c.id}`,
      kind: "discovery",
      status: normaliseStatus(c.status),
      title: c.name,
      detail: `${c.discovered} discovered, ${c.duplicates} already on file, ${c.audited} audited`,
      progress: { done: c.discovered, total: c.targetCount },
      provider: c.provider,
      isMock: c.isMock,
      startedAt: (c.startedAt ?? c.createdAt).toISOString(),
      completedAt: c.completedAt?.toISOString() ?? null,
      durationMs: ms(c.startedAt ?? c.createdAt, c.completedAt),
      error: err,
      href: `/discover/${c.id}`,
    });
  }

  for (const a of audits) {
    const err = fromJson<{ message: string; remedy: string } | null>(a.error, null);
    jobs.push({
      id: `audit:${a.id}`,
      kind: "audit",
      status: normaliseStatus(a.status),
      title: `Audit — ${a.prospect.business.name}`,
      detail: a.scoreOverall != null ? `Scored ${a.scoreOverall}/100` : (a.url ?? "No website"),
      progress: null,
      provider: a.engine,
      isMock: a.isMock,
      startedAt: a.startedAt.toISOString(),
      completedAt: a.completedAt?.toISOString() ?? null,
      durationMs: ms(a.startedAt, a.completedAt),
      error: err,
      href: `/prospects/${a.prospectId}?tab=audit`,
    });
  }

  for (const j of aiJobs) {
    const err = fromJson<{ message: string; remedy: string } | null>(j.error, null);
    jobs.push({
      id: `ai:${j.id}`,
      kind: "ai",
      status: normaliseStatus(j.status),
      title: j.type,
      detail: `${j.capability}${j.model ? ` · ${j.model}` : ""}${
        j.tokensOut ? ` · ${j.tokensOut} out` : ""
      }`,
      progress: null,
      provider: j.provider,
      isMock: j.isMock,
      startedAt: (j.startedAt ?? j.createdAt).toISOString(),
      completedAt: j.completedAt?.toISOString() ?? null,
      durationMs: j.durationMs,
      error: err,
      href: j.entityType === "prospect" && j.entityId ? `/prospects/${j.entityId}` : "/ai?tab=jobs",
    });
  }

  for (const b of builds) {
    jobs.push({
      id: `build:${b.id}`,
      kind: "build",
      status: normaliseStatus(b.status),
      title: `Build — ${b.project.prospect.business.name}`,
      detail: b.qualityScore != null ? `Quality ${b.qualityScore}/100` : (b.stage ?? b.status),
      progress: null,
      provider: b.provider,
      isMock: b.provider === "builtin-scaffold",
      startedAt: b.startedAt.toISOString(),
      completedAt: b.completedAt?.toISOString() ?? null,
      durationMs: ms(b.startedAt, b.completedAt),
      error: b.error ? { message: b.error, remedy: "Check the build log, then retry." } : null,
      href: `/studio/${b.projectId}?tab=builds`,
    });
  }

  for (const d of deployments) {
    jobs.push({
      id: `deploy:${d.id}`,
      kind: "deployment",
      status: normaliseStatus(d.status),
      title: `Deploy — ${d.project.prospect.business.name}`,
      detail: `${d.provider} · ${d.environment}${d.previewUrl || d.productionUrl ? ` · ${d.productionUrl ?? d.previewUrl}` : ""}`,
      progress: null,
      provider: d.provider,
      isMock: false,
      startedAt: d.createdAt.toISOString(),
      completedAt: d.completedAt?.toISOString() ?? null,
      durationMs: ms(d.createdAt, d.completedAt),
      error: d.error
        ? { message: d.error, remedy: "Check the provider dashboard, then redeploy." }
        : null,
      href: `/studio/${d.projectId}?tab=deploy`,
    });
  }

  for (const m of messages) {
    jobs.push({
      id: `outreach:${m.id}`,
      kind: "outreach",
      status: m.status === "bounced" ? "failed" : "completed",
      title: `${m.channel} — ${m.prospect.business.name}`,
      detail: m.failureReason ?? `${m.variant} message`,
      progress: null,
      provider: m.provider,
      isMock: m.provider === "mock",
      startedAt: m.createdAt.toISOString(),
      completedAt: m.sentAt?.toISOString() ?? null,
      durationMs: null,
      error: m.failureReason
        ? { message: m.failureReason, remedy: "Check the channel's connection in Settings." }
        : null,
      href: `/prospects/${m.prospectId}?tab=outreach`,
    });
  }

  return jobs
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
}

export type JobCounts = Record<JobStatus, number> & { total: number };

export async function jobCounts(workspaceId: string): Promise<JobCounts> {
  const jobs = await listJobs(workspaceId, { limit: 200 });
  const counts: JobCounts = {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    total: jobs.length,
  };
  for (const j of jobs) counts[j.status]++;
  return counts;
}

/** Live progress for one campaign, for the discovery screen to poll. */
export async function campaignJobView(
  workspaceId: string,
  campaignId: string,
): Promise<JobView | null> {
  const jobs = await listJobs(workspaceId, { kinds: ["discovery"], limit: 100 });
  return jobs.find((j) => j.id === `campaign:${campaignId}`) ?? null;
}
