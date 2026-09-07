/**
 * Prospect lifecycle.
 *
 * The order here is the order of the Kanban columns, and it is deliberately a
 * *sales* order rather than a production order. Website production is not a
 * stage the prospect passes through on the way to a deal — it is something the
 * operator chooses to do, usually once a meeting has happened. Modelling it as
 * a stage was what made an automatic build look reasonable; it is now a
 * separate axis (see `canBuildWebsite`).
 */

export const PIPELINE_STAGES = [
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
  "lost",
  "not-interested",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_META: Record<
  PipelineStage,
  { label: string; group: "research" | "sales" | "closed"; hint: string }
> = {
  new: {
    label: "New",
    group: "research",
    hint: "Found by a campaign. Nothing has been checked yet.",
  },
  researched: {
    label: "Researched",
    group: "research",
    hint: "Presence gathered and the website audited.",
  },
  contacted: {
    label: "Contacted",
    group: "sales",
    hint: "An approved message was actually sent.",
  },
  responded: {
    label: "Responded",
    group: "sales",
    hint: "They wrote back. Read it before drafting anything else.",
  },
  qualified: {
    label: "Qualified",
    group: "sales",
    hint: "Worth spending real time on: budget, need and reachability line up.",
  },
  "meeting-scheduled": {
    label: "Meeting Scheduled",
    group: "sales",
    hint: "A call is booked.",
  },
  "meeting-completed": {
    label: "Meeting Completed",
    group: "sales",
    hint: "The conversation happened. This is where building usually starts.",
  },
  proposal: { label: "Proposal", group: "sales", hint: "Scope and price are out." },
  negotiation: {
    label: "Negotiation",
    group: "sales",
    hint: "Terms are being agreed.",
  },
  won: { label: "Won", group: "closed", hint: "Signed." },
  lost: { label: "Lost", group: "closed", hint: "Went elsewhere or went quiet." },
  "not-interested": {
    label: "Not Interested",
    group: "closed",
    hint: "Explicitly declined. Excluded from outreach.",
  },
};

/** Stages that count as active pipeline for value roll-ups. */
export const OPEN_STAGES: PipelineStage[] = PIPELINE_STAGES.filter(
  (s) => !["won", "lost", "not-interested"].includes(s),
) as PipelineStage[];

/** Stages from which outreach should not be drafted or sent. */
export const CLOSED_STAGES: PipelineStage[] = ["won", "lost", "not-interested"];

/* ------------------------------------------------------- website build gate */

/**
 * Where a website build is expected.
 *
 * This is a *recommendation*, not an authorisation check. Requirement: the
 * operator may always build, but building before a real conversation is
 * usually money spent on someone who never asked. So the UI surfaces the gap
 * and asks for a deliberate override; it does not refuse.
 *
 * Nothing in the codebase starts a build from a stage change. The only path
 * that creates a build job is an explicit, confirmed request from the operator
 * carrying a provider, a model and a quality mode.
 */
export const BUILD_READY_STAGES: PipelineStage[] = [
  "meeting-scheduled",
  "meeting-completed",
  "proposal",
  "negotiation",
  "won",
];

export type BuildGate =
  | { allowed: true; requiresOverride: false; reason: string }
  | { allowed: true; requiresOverride: true; reason: string };

export function buildGateFor(stage: string): BuildGate {
  if (BUILD_READY_STAGES.includes(stage as PipelineStage)) {
    return {
      allowed: true,
      requiresOverride: false,
      reason: `${STAGE_META[stage as PipelineStage]?.label ?? stage} — a conversation has happened.`,
    };
  }
  if (CLOSED_STAGES.includes(stage as PipelineStage)) {
    return {
      allowed: true,
      requiresOverride: true,
      reason: "This prospect is closed. Building now is unusual — confirm you mean to.",
    };
  }
  return {
    allowed: true,
    requiresOverride: true,
    reason:
      "No meeting is recorded for this prospect. Speculative builds cost real money and are rarely read.",
  };
}

/** The funnel reported in Analytics, in order. */
export const FUNNEL_STEPS: { id: string; label: string; stages: PipelineStage[] }[] = [
  { id: "discovered", label: "Discovered", stages: [...PIPELINE_STAGES] },
  {
    id: "researched",
    label: "Researched",
    stages: PIPELINE_STAGES.filter((s) => s !== "new") as PipelineStage[],
  },
  {
    id: "contacted",
    label: "Contacted",
    stages: [
      "contacted",
      "responded",
      "qualified",
      "meeting-scheduled",
      "meeting-completed",
      "proposal",
      "negotiation",
      "won",
      "lost",
    ],
  },
  {
    id: "replied",
    label: "Replied",
    stages: [
      "responded",
      "qualified",
      "meeting-scheduled",
      "meeting-completed",
      "proposal",
      "negotiation",
      "won",
    ],
  },
  {
    id: "meeting",
    label: "Meeting",
    stages: [
      "meeting-scheduled",
      "meeting-completed",
      "proposal",
      "negotiation",
      "won",
    ],
  },
  { id: "proposal", label: "Proposal", stages: ["proposal", "negotiation", "won"] },
  { id: "won", label: "Won", stages: ["won"] },
];

export const PROSPECT_PRIORITIES = ["low", "normal", "high"] as const;
export type ProspectPriority = (typeof PROSPECT_PRIORITIES)[number];

/**
 * Stages written by earlier versions of this app, mapped onto the current set.
 * Used by the migration and by any row that predates it.
 */
export const LEGACY_STAGE_MAP: Record<string, PipelineStage> = {
  discovered: "new",
  audited: "researched",
  concept: "researched",
  building: "researched",
  "website-ready": "researched",
  "follow-up": "contacted",
  meeting: "meeting-scheduled",
};

export function normaliseStage(stage: string): PipelineStage {
  if ((PIPELINE_STAGES as readonly string[]).includes(stage)) return stage as PipelineStage;
  return LEGACY_STAGE_MAP[stage] ?? "new";
}
