import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "@/config/scoring";
import type { CostMode } from "@/config/ai";
import { cache } from "react";
import { prisma } from "@/db/client";
import { fromJson, toJson } from "@/lib/json";

/** Per-workspace key/value settings with typed accessors and defaults. */

export type WorkspaceSettings = {
  scoringWeights: ScoringWeights;
  costMode: CostMode;
  discoveryProvider: string | null;
  outreachRequiresApproval: boolean;
  maxQaIterations: number;
  senderName: string;
  senderRole: string;

  /** Budgets, in USD. Null means "no limit configured". */
  monthlyBudgetUsd: number | null;
  campaignBudgetUsd: number | null;
  buildBudgetUsd: number | null;
  /** Refuse to start new AI jobs once the monthly budget is exhausted. */
  enforceBudget: boolean;

  /** Which build quality tier the Website Studio defaults to. */
  buildQuality: "economy" | "balanced" | "quality";

  /** Which notification kinds are surfaced. */
  notifyOnBuild: boolean;
  notifyOnAuditFailure: boolean;
  notifyOnReply: boolean;
  notifyOnFollowUpDue: boolean;

  /** Setup checklist items the user chose to dismiss. */
  dismissedSetupSteps: string[];
};

const DEFAULTS: WorkspaceSettings = {
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
  costMode: "balanced",
  discoveryProvider: null,
  outreachRequiresApproval: true,
  maxQaIterations: 3,
  senderName: "",
  senderRole: "Web developer",

  monthlyBudgetUsd: null,
  campaignBudgetUsd: null,
  buildBudgetUsd: null,
  enforceBudget: true,

  buildQuality: "quality",

  notifyOnBuild: true,
  notifyOnAuditFailure: true,
  notifyOnReply: true,
  notifyOnFollowUpDue: true,

  dismissedSetupSteps: [],
};

const KEY_BY_FIELD: Record<keyof WorkspaceSettings, string> = {
  scoringWeights: "scoring.weights",
  costMode: "ai.costMode",
  discoveryProvider: "discovery.provider",
  outreachRequiresApproval: "outreach.requiresApproval",
  maxQaIterations: "studio.maxQaIterations",
  senderName: "outreach.senderName",
  senderRole: "outreach.senderRole",
  monthlyBudgetUsd: "budget.monthlyUsd",
  campaignBudgetUsd: "budget.campaignUsd",
  buildBudgetUsd: "budget.buildUsd",
  enforceBudget: "budget.enforce",
  buildQuality: "studio.buildQuality",
  notifyOnBuild: "notify.build",
  notifyOnAuditFailure: "notify.auditFailure",
  notifyOnReply: "notify.reply",
  notifyOnFollowUpDue: "notify.followUpDue",
  dismissedSetupSteps: "setup.dismissed",
};

/**
 * Reads settings straight from the database, bypassing the request memo.
 *
 * Exists so a write can read its own result. See `getSettings` below.
 */
async function loadSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const rows = await prisma.setting.findMany({ where: { workspaceId } });
  const map = new Map(rows.map((r) => [r.key, r.valueJson]));
  const read = <K extends keyof WorkspaceSettings>(field: K): WorkspaceSettings[K] =>
    fromJson(map.get(KEY_BY_FIELD[field]), DEFAULTS[field]);

  return {
    scoringWeights: read("scoringWeights"),
    costMode: read("costMode"),
    discoveryProvider: read("discoveryProvider"),
    outreachRequiresApproval: read("outreachRequiresApproval"),
    maxQaIterations: read("maxQaIterations"),
    senderName: read("senderName"),
    senderRole: read("senderRole"),
    monthlyBudgetUsd: read("monthlyBudgetUsd"),
    campaignBudgetUsd: read("campaignBudgetUsd"),
    buildBudgetUsd: read("buildBudgetUsd"),
    enforceBudget: read("enforceBudget"),
    buildQuality: read("buildQuality"),
    notifyOnBuild: read("notifyOnBuild"),
    notifyOnAuditFailure: read("notifyOnAuditFailure"),
    notifyOnReply: read("notifyOnReply"),
    notifyOnFollowUpDue: read("notifyOnFollowUpDue"),
    dismissedSetupSteps: read("dismissedSetupSteps"),
  };
}

/**
 * Settings for the current render, resolved once per request.
 *
 * The app layout reads these for the sidebar budget and most pages read them
 * again, so a navigation used to run the same query two or three times.
 *
 * `cache()` is request-scoped, which is the only scope that is safe here:
 * settings are per-workspace data, and a cache that outlived the request
 * would be a cache that could serve one workspace's configuration to another.
 * It also means a mutation is visible on the very next request, with no
 * invalidation to remember.
 *
 * Within a single request a write must still see its own result, so
 * `updateSettings` deliberately returns `loadSettings` rather than this.
 */
export const getSettings = cache(loadSettings);

export async function updateSettings(
  workspaceId: string,
  patch: Partial<WorkspaceSettings>,
): Promise<WorkspaceSettings> {
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const key = KEY_BY_FIELD[field as keyof WorkspaceSettings];
    if (!key) continue;
    await prisma.setting.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      create: { workspaceId, key, valueJson: toJson(value) },
      update: { valueJson: toJson(value) },
    });
  }
  // Not `getSettings`: that memo was populated before these writes landed, so
  // returning it here would hand the caller back the values it just replaced.
  return loadSettings(workspaceId);
}
