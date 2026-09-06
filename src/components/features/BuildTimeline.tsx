import { Badge, EmptyState, StatusDot, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/**
 * The build timeline.
 *
 * Parsed from the log the agent actually wrote, not from a script of steps we
 * hope it ran. A stage only appears here because a line for it exists, so a
 * build that failed halfway shows exactly how far it got.
 */

export type TimelineEntry = {
  at: string;
  stage: string;
  detail: string;
  tone: Tone;
};

const STAGE_TONE: Record<string, Tone> = {
  PLAN: "info",
  IMPLEMENT: "accent",
  TEST: "warn",
  REVIEW: "neutral",
  FINALIZE: "ok",
  FAILED: "danger",
};

const STAGE_LABEL: Record<string, string> = {
  PLAN: "Planning",
  IMPLEMENT: "Implementing",
  TEST: "Testing",
  REVIEW: "Visual review",
  FINALIZE: "Finalising",
  FAILED: "Failed",
};

/** Log lines look like: `<iso>  STAGE    detail`. */
export function parseBuildLog(log: string | null): TimelineEntry[] {
  if (!log) return [];

  return log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+([A-Z]+)\s+(.*)$/);
      if (!match) return null;
      const [, at, stage, detail] = match;
      return {
        at,
        stage,
        detail,
        // A FAIL line inside TEST is still a failure worth colouring red.
        tone: detail.startsWith("FAIL") ? "danger" : (STAGE_TONE[stage] ?? "neutral"),
      } satisfies TimelineEntry;
    })
    .filter((e): e is TimelineEntry => e !== null);
}

export function BuildTimeline({
  entries,
  status,
}: {
  entries: TimelineEntry[];
  status: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No log for this build"
        body="The timeline is parsed from what the agent wrote as it worked. A build with no log did not get far enough to write one."
        compact
      />
    );
  }

  // Group consecutive lines under their stage so the shape of the run is visible.
  const groups: { stage: string; entries: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.stage === entry.stage) last.entries.push(entry);
    else groups.push({ stage: entry.stage, entries: [entry] });
  }

  return (
    <ol className="px-4 py-3">
      {groups.map((group, gi) => {
        const failed = group.entries.some((e) => e.tone === "danger");
        const isLast = gi === groups.length - 1;
        return (
          <li key={`${group.stage}-${gi}`} className="flex gap-3">
            <div className="flex flex-col items-center shrink-0 pt-1">
              <StatusDot
                tone={failed ? "danger" : (STAGE_TONE[group.stage] ?? "neutral")}
                live={isLast && status === "building"}
              />
              {!isLast ? <span aria-hidden className="w-px flex-1 bg-line my-1" /> : null}
            </div>

            <div className={cn("min-w-0 flex-1", isLast ? "pb-1" : "pb-4")}>
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-medium text-ink">
                  {STAGE_LABEL[group.stage] ?? group.stage}
                </span>
                {failed ? <Badge tone="danger">issues</Badge> : null}
                <span className="tabular ml-auto text-[10.5px] text-ink-4">
                  {group.entries[0].at.slice(11, 19)}
                </span>
              </div>

              <ul className="mt-1 flex flex-col gap-0.5">
                {group.entries.map((e, i) => (
                  <li
                    key={`${e.at}-${i}`}
                    className={cn(
                      "text-[11.5px] leading-snug",
                      e.tone === "danger" ? "text-danger" : "text-ink-3",
                    )}
                  >
                    {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
