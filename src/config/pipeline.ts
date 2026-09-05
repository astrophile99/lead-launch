/** Prospect lifecycle. The order here is the order of the Kanban columns. */

export const PIPELINE_STAGES = [
  "discovered",
  "qualified",
  "audited",
  "concept",
  "building",
  "website-ready",
  "contacted",
  "follow-up",
  "meeting",
  "proposal",
  "negotiation",
  "won",
  "lost",
  "not-interested",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_META: Record<
  PipelineStage,
  { label: string; group: "research" | "production" | "sales" | "closed"; hint: string }
> = {
  discovered: {
    label: "Discovered",
    group: "research",
    hint: "Found by a campaign. Not yet assessed.",
  },
  qualified: {
    label: "Qualified",
    group: "research",
    hint: "Meets the bar on rating, reviews and reachability.",
  },
  audited: {
    label: "Audited",
    group: "research",
    hint: "Digital presence assessed and scored.",
  },
  concept: {
    label: "Website Concept",
    group: "production",
    hint: "A brief exists and is awaiting approval.",
  },
  building: {
    label: "Website Building",
    group: "production",
    hint: "A build job is in flight.",
  },
  "website-ready": {
    label: "Website Ready",
    group: "production",
    hint: "Passed the quality gate and is previewable.",
  },
  contacted: {
    label: "Contacted",
    group: "sales",
    hint: "An approved message has been sent.",
  },
  "follow-up": {
    label: "Follow-up",
    group: "sales",
    hint: "Awaiting reply; a follow-up task is scheduled.",
  },
  meeting: { label: "Meeting", group: "sales", hint: "A conversation is booked." },
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

/** The funnel reported in Analytics, in order. */
export const FUNNEL_STEPS: { id: string; label: string; stages: PipelineStage[] }[] =
  [
    { id: "discovered", label: "Discovered", stages: [...PIPELINE_STAGES] },
    {
      id: "qualified",
      label: "Qualified",
      stages: PIPELINE_STAGES.filter((s) => s !== "discovered") as PipelineStage[],
    },
    {
      id: "contacted",
      label: "Contacted",
      stages: [
        "contacted",
        "follow-up",
        "meeting",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ],
    },
    {
      id: "replied",
      label: "Replied",
      stages: ["meeting", "proposal", "negotiation", "won"],
    },
    {
      id: "meeting",
      label: "Meeting",
      stages: ["meeting", "proposal", "negotiation", "won"],
    },
    { id: "proposal", label: "Proposal", stages: ["proposal", "negotiation", "won"] },
    { id: "won", label: "Won", stages: ["won"] },
  ];

export const PROSPECT_PRIORITIES = ["low", "normal", "high"] as const;
export type ProspectPriority = (typeof PROSPECT_PRIORITIES)[number];
