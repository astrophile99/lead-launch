"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTagAction, updateSettingsAction } from "@/app/actions";
import { COST_MODES, type CostMode } from "@/config/ai";
import {
  FACTOR_DESCRIPTIONS,
  FACTOR_LABELS,
  SCORING_FACTORS,
  type ScoringWeights,
} from "@/config/scoring";
import {
  Button,
  ErrorState,
  Field,
  Input,
  Meter,
  Panel,
  PanelHeader,
  Select,
} from "@/components/ui/primitives";

export function ScoringWeightsForm({ weights }: { weights: ScoringWeights }) {
  const router = useRouter();
  const [draft, setDraft] = useState(weights);
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const total = SCORING_FACTORS.reduce((s, f) => s + (draft[f] ?? 0), 0);

  return (
    <Panel>
      <PanelHeader
        title="Opportunity scoring weights"
        hint="Weights are normalised before use, so they need not sum to exactly 1. Changing them rescores every prospect on demand."
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setSaved(false);
                const res = await updateSettingsAction({ scoringWeights: draft });
                if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
                else setSaved(true);
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save weights"}
          </Button>
        }
      />
      <div className="px-4 py-3">
        {SCORING_FACTORS.map((factor) => {
          const value = draft[factor] ?? 0;
          const share = total > 0 ? value / total : 0;
          return (
            <div key={factor} className="py-2.5 border-b border-line last:border-0">
              <div className="flex items-center gap-3 mb-1">
                <label htmlFor={`w-${factor}`} className="text-[12.5px] text-ink font-medium flex-1">
                  {FACTOR_LABELS[factor]}
                </label>
                <span className="tabular text-[11.5px] text-ink-3 w-14 text-right">
                  {(share * 100).toFixed(1)}%
                </span>
                <input
                  id={`w-${factor}`}
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={value}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [factor]: Number(e.target.value) }))
                  }
                  className="w-40 accent-[var(--accent)]"
                />
              </div>
              <Meter value={share * 100} max={50} />
              <p className="mt-1 text-[11.5px] text-ink-3 leading-snug">
                {FACTOR_DESCRIPTIONS[factor]}
              </p>
            </div>
          );
        })}
        <p className="pt-2 text-[11.5px] text-ink-3">
          Raw total {total.toFixed(2)} — normalised automatically.
        </p>
        {saved ? (
          <p className="mt-1 text-[11.5px] text-ok">
            Saved. Run “Rescore all” in the Audit Center to apply it to existing prospects.
          </p>
        ) : null}
        {error ? (
          <div className="mt-2">
            <ErrorState title="Could not save" message={error.message} remedy={error.remedy} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function WorkspacePreferencesForm({
  costMode,
  senderName,
  senderRole,
  maxQaIterations,
}: {
  costMode: CostMode;
  senderName: string;
  senderRole: string;
  maxQaIterations: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({ costMode, senderName, senderRole, maxQaIterations });
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Panel>
      <PanelHeader
        title="Preferences"
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setSaved(false);
                const res = await updateSettingsAction(draft);
                if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
                else setSaved(true);
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        }
      />
      <div className="px-4 py-3 grid gap-3.5 sm:grid-cols-2">
        <Field
          label="Cost mode"
          htmlFor="s-cost"
          hint={COST_MODES.find((m) => m.id === draft.costMode)?.description}
        >
          <Select
            id="s-cost"
            value={draft.costMode}
            onChange={(e) => setDraft((d) => ({ ...d, costMode: e.target.value as CostMode }))}
          >
            {COST_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Max visual QA iterations"
          htmlFor="s-qa"
          hint="Upper bound on fix-and-recheck cycles per build."
        >
          <Input
            id="s-qa"
            type="number"
            min={1}
            max={10}
            value={draft.maxQaIterations}
            onChange={(e) => setDraft((d) => ({ ...d, maxQaIterations: Number(e.target.value) }))}
          />
        </Field>

        <Field label="Your name" htmlFor="s-name" hint="Signs off generated outreach.">
          <Input
            id="s-name"
            value={draft.senderName}
            onChange={(e) => setDraft((d) => ({ ...d, senderName: e.target.value }))}
            placeholder="Left blank, messages are unsigned"
          />
        </Field>

        <Field label="Your role" htmlFor="s-role">
          <Input
            id="s-role"
            value={draft.senderRole}
            onChange={(e) => setDraft((d) => ({ ...d, senderRole: e.target.value }))}
          />
        </Field>
      </div>
      {saved ? <p className="px-4 pb-3 text-[11.5px] text-ok">Preferences saved.</p> : null}
      {error ? (
        <div className="px-4 pb-3">
          <ErrorState title="Could not save" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
    </Panel>
  );
}

export function TagManager({ tags }: { tags: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  return (
    <Panel>
      <PanelHeader title="Tags" hint="Used for filtering, bulk operations and CSV export." />
      <div className="px-4 py-3 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span
            key={t.id}
            className="h-6 px-2 inline-flex items-center text-[11.5px] rounded-[2px] border border-line text-ink-2"
          >
            {t.name}
          </span>
        ))}
        {tags.length === 0 ? <p className="text-[12px] text-ink-3">No tags yet.</p> : null}
      </div>
      <form
        className="px-4 pb-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          start(async () => {
            await createTagAction(name);
            setName("");
            router.refresh();
          });
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New tag name"
          aria-label="New tag name"
          className="max-w-56"
        />
        <Button type="submit" size="md" disabled={pending || !name.trim()}>
          Add tag
        </Button>
      </form>
    </Panel>
  );
}
