"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeTaskAction, setStageAction } from "@/app/actions";
import { PIPELINE_STAGES, STAGE_META, type PipelineStage } from "@/config/pipeline";
import { cn, formatCurrency, relativeTime } from "@/lib/utils";
import { Badge, ErrorState, ScoreBadge } from "@/components/ui/primitives";

export type BoardCard = {
  id: string;
  name: string;
  category: string;
  area: string;
  stage: PipelineStage;
  opportunityScore: number | null;
  websiteScore: number | null;
  estimatedValue: number | null;
  lastActivity: string | null;
  nextAction: string | null;
  nextActionTaskId: string | null;
};

/**
 * Kanban with native HTML5 drag-and-drop, plus a per-card stage selector so the
 * board is fully usable by keyboard and on touch devices.
 */
export function PipelineBoard({ cards }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<PipelineStage | null>(null);
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);

  function move(prospectId: string, stage: PipelineStage) {
    setError(null);
    start(async () => {
      const res = await setStageAction(prospectId, stage);
      if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
      router.refresh();
    });
  }

  return (
    <>
      {error ? (
        <div className="mb-3">
          <ErrorState title="Could not move the prospect" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
        {PIPELINE_STAGES.map((stage) => {
          const items = cards.filter((c) => c.stage === stage);
          const value = items.reduce((s, c) => s + (c.estimatedValue ?? 0), 0);
          return (
            <section
              key={stage}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain") || dragging;
                if (id) move(id, stage);
                setDragging(null);
              }}
              className={cn(
                "w-64 shrink-0 flex flex-col rounded-[3px] border transition-colors",
                over === stage ? "border-accent bg-accent-soft/40" : "border-line bg-surface-2",
              )}
            >
              <header className="px-2.5 py-2 border-b border-line sticky top-0 bg-inherit rounded-t-[3px]">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[12px] font-semibold text-ink">{STAGE_META[stage].label}</h2>
                  <span className="tabular text-[11px] text-ink-3">{items.length}</span>
                  {value > 0 ? (
                    <span className="tabular ml-auto text-[11px] text-ink-3">
                      {formatCurrency(value)}
                    </span>
                  ) : null}
                </div>
                <p className="text-[10.5px] text-ink-4 mt-0.5 leading-snug">{STAGE_META[stage].hint}</p>
              </header>

              <ul className="flex-1 p-1.5 flex flex-col gap-1.5 min-h-24">
                {items.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.id);
                      setDragging(c.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      "bg-surface border border-line rounded-[3px] p-2 shadow-panel cursor-grab active:cursor-grabbing",
                      dragging === c.id && "opacity-50",
                      pending && "pointer-events-none",
                    )}
                  >
                    <Link
                      href={`/prospects/${c.id}`}
                      className="text-[12px] font-medium text-ink hover:text-accent block truncate"
                    >
                      {c.name}
                    </Link>
                    <p className="text-[10.5px] text-ink-4 truncate">
                      {c.category} · {c.area}
                    </p>

                    <div className="flex items-center gap-1.5 mt-1.5">
                      <ScoreBadge score={c.opportunityScore} />
                      {c.websiteScore != null ? <ScoreBadge score={c.websiteScore} /> : <Badge tone="danger">no site</Badge>}
                      <span className="tabular ml-auto text-[10.5px] text-ink-3">
                        {formatCurrency(c.estimatedValue)}
                      </span>
                    </div>

                    {c.nextAction ? (
                      <div className="mt-1.5 flex items-start gap-1.5">
                        <p className="text-[10.5px] text-ink-2 leading-snug flex-1">{c.nextAction}</p>
                        {c.nextActionTaskId ? (
                          <button
                            type="button"
                            title="Mark this action done"
                            className="text-[10.5px] text-ink-4 hover:text-ok shrink-0"
                            onClick={() =>
                              start(async () => {
                                await completeTaskAction(c.nextActionTaskId!);
                                router.refresh();
                              })
                            }
                          >
                            ✓
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-1.5 flex items-center gap-1.5">
                      <label className="sr-only" htmlFor={`stage-${c.id}`}>
                        Stage for {c.name}
                      </label>
                      <select
                        id={`stage-${c.id}`}
                        value={c.stage}
                        onChange={(e) => move(c.id, e.target.value as PipelineStage)}
                        className="h-5.5 text-[10.5px] bg-surface-2 border border-line rounded-[2px] px-1 text-ink-2 flex-1 min-w-0"
                      >
                        {PIPELINE_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {STAGE_META[s].label}
                          </option>
                        ))}
                      </select>
                      <span className="text-[10px] text-ink-4 shrink-0">
                        {c.lastActivity ? relativeTime(c.lastActivity) : ""}
                      </span>
                    </div>
                  </li>
                ))}
                {items.length === 0 ? (
                  <li className="text-[11px] text-ink-4 text-center py-4 border border-dashed border-line rounded-[3px]">
                    Empty
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
