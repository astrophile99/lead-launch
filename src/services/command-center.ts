import { prisma } from "@/db/client";
import { BUILD_READY_STAGES, normaliseStage, STAGE_META, type PipelineStage } from "@/config/pipeline";

/**
 * The Home screen's data.
 *
 * Not "revenue, leads, conversion". The question this screen answers is the
 * one actually asked at 9am: *what needs me today, and what is quietly going
 * wrong*. Every number is a count of rows, and every attention item names the
 * specific thing to do and links straight to it — an alert you cannot act on
 * is just anxiety.
 */

export type TodayCounts = {
  newLeads: number;
  needsFollowUp: number;
  meetings: number;
  highValue: number;
  readyToBuild: number;
  awaitingReview: number;
};

export type AttentionItem = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  href: string;
  action: string;
  count: number;
};

export type PipelinePulse = {
  stage: PipelineStage;
  label: string;
  count: number;
  value: number;
};

export type BuildQueueItem = {
  id: string;
  projectId: string;
  businessName: string;
  status: string;
  strategy: string;
  provider: string | null;
  model: string | null;
  quality: string;
  startedAt: string;
  completedAt: string | null;
  qualityScore: number | null;
  approval: string | null;
  versionId: string | null;
  version: number | null;
};

const FOLLOW_UP_DAYS = 4;
const NEW_LEAD_WINDOW_MS = 7 * 86_400_000;

export async function getCommandCenter(workspaceId: string) {
  const now = Date.now();
  const followUpCutoff = new Date(now - FOLLOW_UP_DAYS * 86_400_000);
  const newCutoff = new Date(now - NEW_LEAD_WINDOW_MS);

  const [
    newLeads,
    needsFollowUp,
    meetings,
    highValue,
    readyToBuild,
    awaitingReview,
    byStage,
    builds,
    staleResearch,
    failedSends,
    unaudited,
    noOwnerHot,
  ] = await Promise.all([
    prisma.prospect.count({ where: { workspaceId, createdAt: { gte: newCutoff } } }),

    // Sent, no reply, and long enough ago to be worth a nudge.
    prisma.prospect.count({
      where: {
        workspaceId,
        stage: "contacted",
        messages: { some: { status: "sent", sentAt: { lt: followUpCutoff } } },
        NOT: { messages: { some: { status: "replied" } } },
      },
    }),

    prisma.prospect.count({
      where: { workspaceId, stage: { in: ["meeting-scheduled", "meeting-completed"] } },
    }),

    prisma.prospect.count({
      where: { workspaceId, opportunityScore: { gte: 75 }, stage: { notIn: ["won", "lost", "not-interested"] } },
    }),

    // A conversation has happened and no site has been built yet. This is a
    // *suggestion*, never a trigger: nothing here starts a build.
    prisma.prospect.count({
      where: {
        workspaceId,
        stage: { in: BUILD_READY_STAGES },
        projects: { none: { versions: { some: {} } } },
      },
    }),

    prisma.websiteVersion.count({
      where: { project: { workspaceId }, approval: "draft" },
    }),

    prisma.prospect.groupBy({
      by: ["stage"],
      where: { workspaceId },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    }),

    prisma.websiteBuild.findMany({
      where: { project: { workspaceId } },
      orderBy: { startedAt: "desc" },
      take: 6,
      include: {
        project: { include: { prospect: { include: { business: true } } } },
        versions: { orderBy: { version: "desc" }, take: 1 },
      },
    }),

    prisma.researchRecord.count({
      where: { workspaceId, source: "crawl", expiresAt: { lt: new Date() } },
    }),

    prisma.outreachMessage.count({
      where: { prospect: { workspaceId }, status: "failed" },
    }),

    prisma.prospect.count({
      where: { workspaceId, audits: { none: { status: "complete" } } },
    }),

    prisma.prospect.count({
      where: { workspaceId, opportunityScore: { gte: 80 }, messages: { none: {} } },
    }),
  ]);

  const drafts = await prisma.outreachMessage.count({
    where: { prospect: { workspaceId }, status: "draft" },
  });
  const approvedUnsent = await prisma.outreachMessage.count({
    where: { prospect: { workspaceId }, status: "approved" },
  });

  const today: TodayCounts = {
    newLeads,
    needsFollowUp,
    meetings,
    highValue,
    readyToBuild,
    awaitingReview,
  };

  /**
   * Attention items.
   *
   * Ordered by how much it costs to ignore them, not by how alarming they
   * look. A failed send is top because the operator believes that message went
   * out; an unaudited prospect is bottom because nothing is wrong, there is
   * simply work to do.
   */
  const attention: AttentionItem[] = [];

  if (failedSends > 0) {
    attention.push({
      id: "failed-sends",
      severity: "high",
      title: `${failedSends} message${failedSends === 1 ? "" : "s"} failed to send`,
      detail:
        "The provider refused these. Nothing was delivered, and nobody is waiting on a reply that will never come.",
      href: "/outreach?state=failed",
      action: "Read the reason",
      count: failedSends,
    });
  }

  if (approvedUnsent > 0) {
    attention.push({
      id: "approved-unsent",
      severity: "medium",
      title: `${approvedUnsent} approved message${approvedUnsent === 1 ? "" : "s"} not yet sent`,
      detail:
        "You read these and approved them. They will not go on their own — sending is deliberately a separate step.",
      href: "/outreach?state=approved",
      action: "Send them",
      count: approvedUnsent,
    });
  }

  if (needsFollowUp > 0) {
    attention.push({
      id: "follow-up",
      severity: "medium",
      title: `${needsFollowUp} prospect${needsFollowUp === 1 ? " has" : "s have"} gone quiet`,
      detail: `Contacted more than ${FOLLOW_UP_DAYS} days ago with no reply.`,
      href: "/outreach?state=follow-up-due",
      action: "Follow up",
      count: needsFollowUp,
    });
  }

  if (awaitingReview > 0) {
    attention.push({
      id: "review",
      severity: "medium",
      title: `${awaitingReview} built website${awaitingReview === 1 ? "" : "s"} waiting for review`,
      detail:
        "Software checked these. A person has not. Nothing is approved until you have actually looked at it.",
      href: "/studio",
      action: "Review",
      count: awaitingReview,
    });
  }

  if (noOwnerHot > 0) {
    attention.push({
      id: "hot-untouched",
      severity: "medium",
      title: `${noOwnerHot} strong prospect${noOwnerHot === 1 ? " has" : "s have"} never been contacted`,
      detail: "Scored 80 or above and nothing has been written to them.",
      href: "/prospects?score=high&contact=none",
      action: "Draft a message",
      count: noOwnerHot,
    });
  }

  if (drafts > 0) {
    attention.push({
      id: "drafts",
      severity: "low",
      title: `${drafts} draft${drafts === 1 ? "" : "s"} waiting to be read`,
      detail: "Written from recorded observations. None of them will send themselves.",
      href: "/outreach?state=needs-review",
      action: "Review",
      count: drafts,
    });
  }

  if (staleResearch > 0) {
    attention.push({
      id: "stale-research",
      severity: "low",
      title: `Research on ${staleResearch} business${staleResearch === 1 ? "" : "es"} is out of date`,
      detail:
        "Nothing re-crawls on its own. Refresh the ones you are about to write to, not all of them.",
      href: "/prospects",
      action: "Open prospects",
      count: staleResearch,
    });
  }

  if (unaudited > 0) {
    attention.push({
      id: "unaudited",
      severity: "low",
      title: `${unaudited} prospect${unaudited === 1 ? "" : "s"} not audited`,
      detail: "A message cannot be written until there is something real to say.",
      href: "/audit",
      action: "Run audits",
      count: unaudited,
    });
  }

  const stageMap = new Map(
    byStage.map((row) => [
      normaliseStage(row.stage),
      { count: row._count._all, value: row._sum.estimatedValue ?? 0 },
    ]),
  );

  const pulse: PipelinePulse[] = (
    [
      "new",
      "researched",
      "contacted",
      "responded",
      "qualified",
      "meeting-scheduled",
      "meeting-completed",
      "proposal",
      "negotiation",
      "won",
    ] as PipelineStage[]
  ).map((stage) => ({
    stage,
    label: STAGE_META[stage].label,
    count: stageMap.get(stage)?.count ?? 0,
    value: stageMap.get(stage)?.value ?? 0,
  }));

  const buildQueue: BuildQueueItem[] = builds.map((b) => ({
    id: b.id,
    projectId: b.projectId,
    businessName: b.project.prospect.business.name,
    status: b.status,
    strategy: b.strategy,
    provider: b.provider,
    model: b.model,
    quality: b.quality,
    startedAt: b.startedAt.toISOString(),
    completedAt: b.completedAt?.toISOString() ?? null,
    qualityScore: b.qualityScore,
    approval: b.versions[0]?.approval ?? null,
    versionId: b.versions[0]?.id ?? null,
    version: b.versions[0]?.version ?? null,
  }));

  return { today, attention, pulse, buildQueue };
}
