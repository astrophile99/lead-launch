import Link from "next/link";
import type {
  AttentionItem,
  BuildQueueItem,
  PipelinePulse,
  TodayCounts,
} from "@/services/command-center";
import { Badge, Panel, PanelHeader, ScoreBadge, StatusDot, type Tone } from "@/components/ui/primitives";
import { NavIcon } from "@/components/shell/icon";
import { cn, formatCurrency, relativeTime } from "@/lib/utils";

/**
 * The command centre.
 *
 * Two design decisions worth stating:
 *
 * The oversized numbers are the point. On a screen you look at every morning,
 * six figures that can be read at arm's length beat twenty that need
 * inspecting, so this deliberately shows fewer things larger.
 *
 * Nothing here is a trigger. "Ready to build" is a count of prospects who have
 * had a conversation and no site yet — it links to the list, and building is
 * still a dialog with a model and a cost in it. A dashboard tile that started
 * work would be the exact bug this release removes.
 */

const TODAY_TILES: {
  key: keyof TodayCounts;
  label: string;
  href: string;
  hint: string;
  tone?: Tone;
}[] = [
  {
    key: "newLeads",
    label: "New leads",
    href: "/prospects?recency=week",
    hint: "Discovered in the last seven days",
  },
  {
    key: "needsFollowUp",
    label: "Needs follow-up",
    href: "/outreach?state=follow-up-due",
    hint: "Contacted, gone quiet",
    tone: "warn",
  },
  {
    key: "meetings",
    label: "Meetings",
    href: "/pipeline",
    hint: "Booked or already had",
    tone: "accent",
  },
  {
    key: "highValue",
    label: "High value",
    href: "/prospects?score=high",
    hint: "Scoring 75 or above, still open",
  },
  {
    key: "readyToBuild",
    label: "Ready to build",
    href: "/prospects?stage=meeting-completed",
    hint: "Spoke to them, no site built yet",
  },
  {
    key: "awaitingReview",
    label: "Awaiting review",
    href: "/studio",
    hint: "Built, not yet read by a person",
    tone: "info",
  },
];

export function TodayGrid({ counts }: { counts: TodayCounts }) {
  return (
    <section aria-label="Today">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        {TODAY_TILES.map((tile) => {
          const value = counts[tile.key];
          const live = value > 0;
          return (
            <Link
              key={tile.key}
              href={tile.href}
              className={cn(
                "group relative border border-line rounded-md bg-surface px-3.5 py-3",
                "transition-colors hover:border-line-strong hover:bg-surface-2",
                live && tile.tone === "warn" && "border-warn/35",
                live && tile.tone === "accent" && "border-accent/35",
              )}
            >
              <p className="label">{tile.label}</p>
              <p
                className={cn(
                  "tabular mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.03em]",
                  !live && "text-ink-4",
                  live && tile.tone === "warn" && "text-warn",
                  live && tile.tone === "accent" && "text-accent",
                )}
              >
                {value}
              </p>
              <p className="mt-1.5 text-[11px] text-ink-4 leading-snug">{tile.hint}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const SEVERITY_TONE: Record<AttentionItem["severity"], Tone> = {
  high: "danger",
  medium: "warn",
  low: "info",
};

export function Attention({ items }: { items: AttentionItem[] }) {
  return (
    <Panel>
      <PanelHeader
        title="Attention"
        hint="Ordered by what it costs to ignore, not by how alarming it looks."
        actions={
          items.length === 0 ? (
            <Badge tone="ok" dot>
              nothing outstanding
            </Badge>
          ) : (
            <Badge tone={SEVERITY_TONE[items[0].severity]}>{items.length}</Badge>
          )
        }
      />
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">
          Nothing needs you. Everything drafted has been read, everything approved has been sent,
          and every built site has been reviewed.
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id} className="border-b border-line last:border-0">
              <Link
                href={item.href}
                className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2 transition-colors group"
              >
                <span className="mt-1.5 shrink-0">
                  <StatusDot tone={SEVERITY_TONE[item.severity]} live={item.severity === "high"} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-ink">{item.title}</span>
                  <span className="block text-[11.5px] text-ink-3 leading-snug mt-0.5">
                    {item.detail}
                  </span>
                  {/* Below the text on a phone, beside it from sm up. Keeping
                      it on one line at 375px pushed the row off the edge. */}
                  <span className="sm:hidden block mt-1.5 text-[11.5px] text-accent">
                    {item.action} →
                  </span>
                </span>
                <span className="hidden sm:block shrink-0 text-[11.5px] text-ink-4 group-hover:text-accent transition-colors self-center whitespace-nowrap">
                  {item.action} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function PipelinePulseBar({ pulse }: { pulse: PipelinePulse[] }) {
  const total = pulse.reduce((n, p) => n + p.count, 0);
  const max = Math.max(1, ...pulse.map((p) => p.count));

  return (
    <Panel>
      <PanelHeader
        title="Pipeline pulse"
        hint="Where every open prospect actually sits. Website production is not a stage — it is something you choose to do."
        actions={
          <Link
            href="/pipeline"
            className="text-[11.5px] text-accent hover:underline underline-offset-2"
          >
            Open the board →
          </Link>
        }
      />
      {total === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">
          No prospects yet. Run a discovery campaign to start the pipeline.
        </p>
      ) : (
        <div className="px-4 py-3.5">
          <ol className="flex flex-col gap-1.5">
            {pulse.map((p) => (
              <li key={p.stage}>
                <Link
                  href={`/prospects?stage=${p.stage}`}
                  className="group flex items-center gap-3 py-0.5"
                >
                  <span className="w-[6rem] sm:w-[8.5rem] shrink-0 text-[12px] text-ink-3 group-hover:text-ink transition-colors truncate">
                    {p.label}
                  </span>
                  <span className="flex-1 h-4 relative min-w-0">
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-sm transition-colors",
                        p.count === 0
                          ? "bg-surface-3"
                          : p.stage === "won"
                            ? "bg-ok/70"
                            : "bg-accent/70 group-hover:bg-accent",
                      )}
                      style={{ width: `${Math.max(p.count === 0 ? 0.5 : 4, (p.count / max) * 100)}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      "tabular w-8 shrink-0 text-right text-[12.5px]",
                      p.count > 0 ? "text-ink font-medium" : "text-ink-4",
                    )}
                  >
                    {p.count}
                  </span>
                  <span className="tabular hidden sm:block w-20 shrink-0 text-right text-[11.5px] text-ink-4">
                    {p.value > 0 ? formatCurrency(p.value) : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

const BUILD_TONE: Record<string, Tone> = {
  complete: "ok",
  failed: "danger",
  building: "warn",
  queued: "info",
};

export function BuildQueue({ items }: { items: BuildQueueItem[] }) {
  return (
    <Panel>
      <PanelHeader
        title="Build queue"
        hint="Every build was started by hand. Nothing here began on its own."
        actions={
          <Link href="/studio" className="text-[11.5px] text-accent hover:underline underline-offset-2">
            Studio →
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">
          No websites have been built. Building starts from a prospect that has had a conversation —
          it is never triggered by a score.
        </p>
      ) : (
        <ul>
          {items.map((b) => (
            <li key={b.id} className="border-b border-line last:border-0">
              <Link
                href={`/studio/${b.projectId}?tab=versions`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors"
              >
                <StatusDot tone={BUILD_TONE[b.status] ?? "neutral"} live={b.status === "building"} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-ink truncate">{b.businessName}</span>
                  <span className="block text-[11px] text-ink-4 truncate">
                    {b.strategy === "agent" ? `${b.provider} / ${b.model}` : "deterministic scaffold"}
                    {" · "}
                    {b.quality}
                    {" · "}
                    {relativeTime(b.startedAt)}
                  </span>
                </span>
                {b.approval === "draft" ? (
                  <Badge tone="info">needs review</Badge>
                ) : b.approval === "approved" ? (
                  <Badge tone="ok">approved</Badge>
                ) : null}
                <ScoreBadge score={b.qualityScore} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** A compact header strip: the one number that matters, plus mode. */
export function PulseStrip({
  workspaceName,
  mode,
  monthUsd,
  budgetUsd,
  jobsToday,
}: {
  workspaceName: string;
  mode: "demo" | "live";
  monthUsd: number | null;
  budgetUsd: number | null;
  jobsToday: number;
}) {
  const pct =
    budgetUsd && budgetUsd > 0 && monthUsd != null
      ? Math.min(100, Math.round((monthUsd / budgetUsd) * 100))
      : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-3">
      <span className="flex items-center gap-1.5">
        <NavIcon name="cpu" className="size-3.5 text-ink-4" />
        <span className="tabular text-ink-2">{jobsToday}</span> AI job
        {jobsToday === 1 ? "" : "s"} today
      </span>
      <span className="flex items-center gap-1.5">
        AI spend this month
        <span className="tabular text-ink-2">
          {monthUsd == null ? "not priced" : formatCurrency(monthUsd, "USD")}
        </span>
        {pct != null ? (
          <span className={cn("tabular", pct >= 80 ? "text-warn" : "text-ink-4")}>
            ({pct}% of budget)
          </span>
        ) : null}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {workspaceName}
        <Badge tone={mode === "demo" ? "warn" : "ok"} dot>
          {mode}
        </Badge>
      </span>
    </div>
  );
}
