import { Badge, EmptyState, Panel, PanelHeader, StatusDot, type Tone } from "@/components/ui/primitives";
import { NavIcon } from "@/components/shell/icon";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * One chronological conversation across every channel.
 *
 * Gmail, WhatsApp and Instagram interleaved by time rather than grouped by
 * integration, because the question a person actually has is "when did I last
 * speak to these people and what did I say", and that question does not care
 * which API carried it.
 *
 * Only real events appear. Every row here is an OutreachEvent that was written
 * when something happened — a draft written, an approval given, a provider
 * confirming a send. There is no synthesised "we probably followed up" entry.
 */

export type TimelineRow = {
  id: string;
  at: string;
  channel: string;
  channelLabel: string;
  kind: string;
  title: string;
  detail: string | null;
  messageId: string;
};

const KIND_TONE: Record<string, Tone> = {
  created: "info",
  approved: "accent",
  sent: "ok",
  delivered: "ok",
  opened: "ok",
  replied: "ok",
  failed: "danger",
  "opted-out": "neutral",
};

const CHANNEL_ICON: Record<string, string> = {
  email: "email",
  whatsapp: "phone",
  instagram: "instagram",
  linkedin: "linkedin",
  generic: "send",
};

function dayLabel(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const isToday = at.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (isToday) return "Today";
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ConversationTimeline({
  rows,
  nextAction,
}: {
  rows: TimelineRow[];
  nextAction?: { title: string; dueAt: string | null } | null;
}) {
  if (rows.length === 0) {
    return (
      <Panel>
        <PanelHeader title="Conversation" />
        <EmptyState
          title="Nothing has been said yet"
          body="Every message across Gmail, WhatsApp and Instagram appears here in one thread, once there is one."
          compact
        />
      </Panel>
    );
  }

  // Group by day so a burst of activity reads as one afternoon rather than as
  // eleven separate events.
  const days: { label: string; rows: TimelineRow[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(row.at);
    const last = days.at(-1);
    if (last && last.label === label) last.rows.push(row);
    else days.push({ label, rows: [row] });
  }

  return (
    <Panel>
      <PanelHeader
        title="Conversation"
        hint="Every channel, in the order it happened. Only events that actually occurred."
        actions={<Badge tone="neutral">{rows.length} events</Badge>}
      />

      {nextAction ? (
        <div className="px-4 py-2.5 border-b border-line bg-accent-soft flex items-center gap-2">
          <StatusDot tone="accent" />
          <p className="text-[12.5px] text-ink flex-1 min-w-0">{nextAction.title}</p>
          {nextAction.dueAt ? (
            <span className="text-[11.5px] text-ink-3 shrink-0">
              due {relativeTime(nextAction.dueAt)}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="px-4 py-3">
        {days.map((day) => (
          <section key={day.label} className="mb-3 last:mb-0">
            <p className="label mb-1.5">{day.label}</p>
            <ol className="flex flex-col">
              {day.rows.map((row, i) => (
                <li key={row.id} className="flex gap-3">
                  <div className="flex flex-col items-center shrink-0 pt-1.5">
                    <StatusDot tone={KIND_TONE[row.kind] ?? "neutral"} />
                    {i < day.rows.length - 1 ? (
                      <span aria-hidden className="w-px flex-1 bg-line my-1" />
                    ) : null}
                  </div>

                  <div
                    className={cn(
                      "min-w-0 flex-1",
                      i < day.rows.length - 1 ? "pb-3" : "pb-0.5",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <NavIcon
                        name={CHANNEL_ICON[row.channel] ?? "send"}
                        className="size-3.5 shrink-0 text-ink-4"
                      />
                      <span className="text-[12.5px] font-medium text-ink">{row.title}</span>
                      <span
                        className="tabular ml-auto text-[10.5px] text-ink-4 shrink-0"
                        title={formatDateTime(row.at)}
                      >
                        {new Date(row.at).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    {row.detail ? (
                      <p className="text-[11.5px] text-ink-3 leading-snug mt-0.5 break-words">
                        {row.detail}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </Panel>
  );
}
