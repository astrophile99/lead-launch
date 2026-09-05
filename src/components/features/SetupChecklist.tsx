"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissSetupStepAction } from "@/app/actions";
import { Badge, Button, Meter, Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type SetupStepView = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
  optional: boolean;
};

/**
 * First-run checklist. Every item reflects real state, so it cannot be ticked
 * by clicking — only by actually connecting the thing.
 */
export function SetupChecklist({ steps }: { steps: SetupStepView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [collapsed, setCollapsed] = useState(false);

  const required = steps.filter((s) => !s.optional);
  const doneCount = steps.filter((s) => s.done).length;
  const requiredDone = required.filter((s) => s.done).length;
  const allRequiredDone = requiredDone === required.length;

  return (
    <Panel className="mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-line">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold text-ink">Set up Lead → Launch</h2>
            <Badge tone={allRequiredDone ? "ok" : "accent"}>
              {doneCount} / {steps.length}
            </Badge>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {allRequiredDone
              ? "The essentials are connected. The remaining steps unlock sending and deployment."
              : "The app works fully in demo mode. Connect these to work with real businesses."}
          </p>
        </div>
        <div className="w-32 shrink-0">
          <Meter value={doneCount} max={steps.length} tone={allRequiredDone ? "ok" : "accent"} />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "Show" : "Hide"}
        </Button>
      </div>

      {!collapsed ? (
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((step) => (
            <li key={step.id} className="border-b border-r border-line last:border-r-0">
              <div className="flex items-start gap-2.5 px-3.5 py-3 h-full">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 size-4 rounded-full border grid place-items-center text-[9px] shrink-0",
                    step.done
                      ? "bg-ok-soft border-ok-line text-ok"
                      : "bg-surface-2 border-line text-ink-4",
                  )}
                >
                  {step.done ? "✓" : ""}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Link
                      href={step.href}
                      className={cn(
                        "text-[12.5px] font-medium hover:text-accent transition-colors",
                        step.done ? "text-ink-3 line-through decoration-ink-4/50" : "text-ink",
                      )}
                    >
                      {step.label}
                    </Link>
                    {step.optional ? (
                      <span className="text-[10px] text-ink-4 uppercase tracking-wide">
                        optional
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-3 leading-snug">{step.detail}</p>
                </div>

                {!step.done ? (
                  <button
                    type="button"
                    title="Hide this step"
                    aria-label={`Hide ${step.label}`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await dismissSetupStepAction(step.id);
                        router.refresh();
                      })
                    }
                    className="text-ink-4 hover:text-ink-2 text-[13px] leading-none shrink-0 p-0.5"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
