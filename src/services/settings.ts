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
};

const DEFAULTS: WorkspaceSettings = {
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
  costMode: "balanced",
  discoveryProvider: null,
  outreachRequiresApproval: true,
  maxQaIterations: 3,
  senderName: "",
  senderRole: "Web developer",
};

export async function getSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const rows = await prisma.setting.findMany({ where: { workspaceId } });
  const map = new Map(rows.map((r) => [r.key, r.valueJson]));
  return {
    scoringWeights: fromJson(map.get("scoring.weights"), DEFAULTS.scoringWeights),
    costMode: fromJson(map.get("ai.costMode"), DEFAULTS.costMode),
    discoveryProvider: fromJson(map.get("discovery.provider"), DEFAULTS.discoveryProvider),
    outreachRequiresApproval: fromJson(
      map.get("outreach.requiresApproval"),
      DEFAULTS.outreachRequiresApproval,
    ),
    maxQaIterations: fromJson(map.get("studio.maxQaIterations"), DEFAULTS.maxQaIterations),
    senderName: fromJson(map.get("outreach.senderName"), DEFAULTS.senderName),
    senderRole: fromJson(map.get("outreach.senderRole"), DEFAULTS.senderRole),
  };
}

const KEY_BY_FIELD: Record<keyof WorkspaceSettings, string> = {
  scoringWeights: "scoring.weights",
  costMode: "ai.costMode",
  discoveryProvider: "discovery.provider",
  outreachRequiresApproval: "outreach.requiresApproval",
  maxQaIterations: "studio.maxQaIterations",
  senderName: "outreach.senderName",
  senderRole: "outreach.senderRole",
};

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
