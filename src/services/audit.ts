import { prisma } from "@/db/client";
import { AppError, toAppError } from "@/lib/errors";
import { fromJson, toJson } from "@/lib/json";
import { startJob } from "@/lib/logger";
import { normaliseUrl } from "@/lib/utils";
import { getAuditProvider } from "@/providers/audit";
import type { AuditScores, AuditSignals, FindingInput } from "@/types";
import { interpretAudit, NO_WEBSITE_SCORES, noWebsiteFindings } from "./audit-scoring";
import { logActivity, notify } from "./activity";
import { rescoreProspect } from "./opportunity";

/**
 * Runs a full audit for one prospect and persists the result.
 *
 * A failure is recorded as a failed audit row with the structured error, not
 * swallowed - the Audit Center lists failures with their remedy and a retry.
 */
export async function auditProspect(
  workspaceId: string,
  prospectId: string,
): Promise<{ auditId: string; status: string; scores: AuditScores | null }> {
  const prospect = await prisma.prospect.findFirst({
    where: { id: prospectId, workspaceId },
    include: { business: true },
  });
  if (!prospect) {
    throw new AppError({
      kind: "not-found",
      message: "Prospect not found in this workspace.",
      remedy: "Refresh the prospect list.",
    });
  }

  const url = normaliseUrl(prospect.business.website);
  const log = startJob("audit.run", { prospectId, url: url ?? "none" });

  // No website is a legitimate, fully-scored outcome - not a failure.
  if (!url) {
    const audit = await prisma.websiteAudit.create({
      data: {
        prospectId,
        url: null,
        status: "complete",
        engine: "no-website",
        isMock: false,
        scorePerformance: 0,
        scoreAccessibility: 0,
        scoreBestPractices: 0,
        scoreSeo: 0,
        scoreUx: 0,
        scoreTechnical: 0,
        scoreOverall: 0,
        completedAt: new Date(),
        findings: {
          create: noWebsiteFindings(prospect.business.name).map(toFindingRow),
        },
      },
    });
    await prisma.prospect.update({
      where: { id: prospectId },
      data: { websiteScore: 0, stage: advanceStage(prospect.stage) },
    });
    await logActivity({
      workspaceId,
      prospectId,
      type: "audit.completed",
      message: "Audit completed: no website on record.",
      meta: { auditId: audit.id, engine: "no-website" },
    });
    await rescoreProspect(workspaceId, prospectId);
    log.done({ engine: "no-website" });
    return { auditId: audit.id, status: "complete", scores: NO_WEBSITE_SCORES };
  }

  const provider = getAuditProvider(url);
  const audit = await prisma.websiteAudit.create({
    data: { prospectId, url, status: "running", engine: provider.id, isMock: provider.isMock },
  });

  await logActivity({
    workspaceId,
    prospectId,
    type: "audit.started",
    message: `Audit started against ${url} using ${provider.label}.`,
    meta: { auditId: audit.id },
  });

  try {
    const result = await provider.inspect(url, { seed: prospect.business.dedupeKey });
    const { scores, findings } = interpretAudit(result.signals);

    await prisma.websiteAudit.update({
      where: { id: audit.id },
      data: {
        status: "complete",
        engine: result.engine,
        isMock: result.isMock,
        httpStatus: result.signals.fetch.httpStatus,
        https: result.signals.fetch.https,
        loadMs: result.signals.fetch.loadMs,
        pageBytes: result.signals.fetch.bytes,
        redirected: result.signals.fetch.redirected,
        finalUrl: result.signals.fetch.finalUrl,
        scorePerformance: scores.performance,
        scoreAccessibility: scores.accessibility,
        scoreBestPractices: scores.bestPractices,
        scoreSeo: scores.seo,
        scoreUx: scores.ux,
        scoreTechnical: scores.technical,
        scoreOverall: scores.overall,
        signalsJson: toJson(result.signals),
        completedAt: new Date(),
        findings: { create: findings.map(toFindingRow) },
      },
    });

    await prisma.prospect.update({
      where: { id: prospectId },
      data: { websiteScore: scores.overall, stage: advanceStage(prospect.stage) },
    });

    await logActivity({
      workspaceId,
      prospectId,
      type: "audit.completed",
      message: `Audit completed: ${scores.overall}/100 overall, ${findings.length} findings.`,
      meta: { auditId: audit.id, engine: result.engine, isMock: result.isMock },
    });

    await rescoreProspect(workspaceId, prospectId);
    log.done({ score: scores.overall, findings: findings.length });
    return { auditId: audit.id, status: "complete", scores };
  } catch (e) {
    const err = toAppError(e, "Retry the audit.");
    await prisma.websiteAudit.update({
      where: { id: audit.id },
      data: { status: "failed", error: toJson(err.toJSON()), completedAt: new Date() },
    });
    await logActivity({
      workspaceId,
      prospectId,
      type: "audit.failed",
      message: `Audit failed: ${err.message}`,
      meta: { auditId: audit.id, kind: err.kind },
    });
    await notify({
      workspaceId,
      type: "audit.failed",
      title: `Audit failed for ${prospect.business.name}`,
      body: `${err.message} ${err.remedy}`,
      level: "error",
      link: `/prospects/${prospectId}?tab=audit`,
    });
    log.fail(err);
    return { auditId: audit.id, status: "failed", scores: null };
  }
}

function toFindingRow(f: FindingInput) {
  return {
    category: f.category,
    severity: f.severity,
    title: f.title,
    whatIsWrong: f.whatIsWrong,
    whyItMatters: f.whyItMatters,
    recommendation: f.recommendation,
    effort: f.effort,
    impact: f.impact,
    evidence: f.evidence ?? null,
    source: f.source ?? "heuristic",
  };
}

function advanceStage(current: string): string {
  return current === "discovered" || current === "qualified" ? "audited" : current;
}

/** Latest completed audit for a prospect, with signals decoded. */
export async function latestAudit(prospectId: string) {
  const audit = await prisma.websiteAudit.findFirst({
    where: { prospectId },
    orderBy: { startedAt: "desc" },
    include: { findings: true },
  });
  if (!audit) return null;
  return {
    ...audit,
    signals: fromJson<AuditSignals | null>(audit.signalsJson, null),
    errorInfo: fromJson<{ message: string; remedy: string; kind: string } | null>(
      audit.error,
      null,
    ),
  };
}

/** Runs audits sequentially with a concurrency cap, reporting progress. */
export async function auditMany(
  workspaceId: string,
  prospectIds: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ completed: number; failed: number }> {
  let completed = 0;
  let failed = 0;
  const concurrency = 4;

  for (let i = 0; i < prospectIds.length; i += concurrency) {
    const slice = prospectIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      slice.map((id) => auditProspect(workspaceId, id)),
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.status === "complete") completed++;
      else failed++;
    }
    onProgress?.(Math.min(i + concurrency, prospectIds.length), prospectIds.length);
  }

  return { completed, failed };
}
