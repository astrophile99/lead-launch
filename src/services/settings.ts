import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "@/config/scoring";
import type { CostMode } from "@/config/ai";
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

export async function getSettings(workspaceId: string): Promise<WorkspaceSettings> {
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
  return getSettings(workspaceId);
}
