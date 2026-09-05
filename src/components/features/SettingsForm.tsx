"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createTagAction,
  recordOptOutAction,
  removeOptOutAction,
  updateSettingsAction,
  updateWorkspaceAction,
} from "@/app/actions";
import { COST_MODES, type CostMode } from "@/config/ai";
import {
  FACTOR_DESCRIPTIONS,
  FACTOR_LABELS,
  SCORING_FACTORS,
  type ScoringWeights,
} from "@/config/scoring";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Button,
  Checkbox,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Meter,
  Panel,
  PanelHeader,
  Segmented,
  Select,
} from "@/components/ui/primitives";
import { formatCurrency, relativeTime } from "@/lib/utils";

type Err = { message: string; remedy: string } | null;

/* ------------------------------------------------------------------ scoring */

export function ScoringWeightsForm({ weights }: { weights: ScoringWeights }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(weights);
  const [pending, start] = useTransition();
  const [error, setError] = useState<Err>(null);

  const total = SCORING_FACTORS.reduce((s, f) => s + (draft[f] ?? 0), 0);

  return (
    <Panel>
      <PanelHeader
        title="Opportunity scoring weights"
        hint="Normalised before use, so they need not sum to exactly 1. Changing them rescores on demand."
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await updateSettingsAction({ scoringWeights: draft });
                if (!res.ok) {
                  setError({ message: res.error.message, remedy: res.error.remedy });
                  return;
                }
                toast.success(
                  "Weights saved",
                  'Run "Rescore all" in the Audit Center to apply them to existing prospects.',
                );
                router.refresh();
              })
            }
          >
            Save weights
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
                  onChange={(e) => setDraft((d) => ({ ...d, [factor]: Number(e.target.value) }))}
                  className="w-32 sm:w-40 accent-[var(--accent)]"
                />
              </div>
              <Meter value={share * 100} max={50} height="xs" />
              <p className="mt-1 text-[11.5px] text-ink-3 leading-snug">
                {FACTOR_DESCRIPTIONS[factor]}
              </p>
            </div>
          );
        })}
        <p className="pt-2 text-[11.5px] text-ink-3">
          Raw total {total.toFixed(2)} — normalised automatically.
        </p>
        {error ? (
          <div className="mt-2">
            <ErrorState title="Could not save" message={error.message} remedy={error.remedy} />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ budgets */

export function BudgetForm({
  monthlyBudgetUsd,
  campaignBudgetUsd,
  buildBudgetUsd,
  enforceBudget,
  costMode,
  buildQuality,
  spentUsd,
}: {
  monthlyBudgetUsd: number | null;
  campaignBudgetUsd: number | null;
  buildBudgetUsd: number | null;
  enforceBudget: boolean;
  costMode: CostMode;
  buildQuality: "economy" | "balanced" | "quality";
  spentUsd: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({
    monthlyBudgetUsd: monthlyBudgetUsd?.toString() ?? "",
    campaignBudgetUsd: campaignBudgetUsd?.toString() ?? "",
    buildBudgetUsd: buildBudgetUsd?.toString() ?? "",
    enforceBudget,
    costMode,
    buildQuality,
  });

  const monthly = draft.monthlyBudgetUsd === "" ? null : Number(draft.monthlyBudgetUsd);
  const pct = monthly && spentUsd != null ? Math.round((spentUsd / monthly) * 100) : null;

  return (
    <Panel>
      <PanelHeader
        title="AI budget and quality"
        hint="Budgets are evaluated against real recorded spend, so they only bite where model prices are configured."
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await updateSettingsAction({
                  monthlyBudgetUsd: monthly,
                  campaignBudgetUsd:
                    draft.campaignBudgetUsd === "" ? null : Number(draft.campaignBudgetUsd),
                  buildBudgetUsd:
                    draft.buildBudgetUsd === "" ? null : Number(draft.buildBudgetUsd),
                  enforceBudget: draft.enforceBudget,
                  costMode: draft.costMode,
                  buildQuality: draft.buildQuality,
                });
                if (!res.ok) {
                  toast.error("Could not save", res.error.message);
                  return;
                }
                toast.success("Budget settings saved");
                router.refresh();
              })
            }
          >
            Save
          </Button>
        }
      />

      <div className="px-4 py-3 flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Monthly AI budget (USD)"
            htmlFor="b-month"
            hint="Blank means no limit."
          >
            <Input
              id="b-month"
              type="number"
              min={0}
              step="1"
              placeholder="No limit"
              value={draft.monthlyBudgetUsd}
              onChange={(e) => setDraft((d) => ({ ...d, monthlyBudgetUsd: e.target.value }))}
            />
          </Field>
          <Field label="Per-campaign budget" htmlFor="b-campaign" hint="Warns before a large run.">
            <Input
              id="b-campaign"
              type="number"
              min={0}
              step="1"
              placeholder="No limit"
              value={draft.campaignBudgetUsd}
              onChange={(e) => setDraft((d) => ({ ...d, campaignBudgetUsd: e.target.value }))}
            />
          </Field>
          <Field label="Per-build budget" htmlFor="b-build" hint="Caps one website build.">
            <Input
              id="b-build"
              type="number"
              min={0}
              step="1"
              placeholder="No limit"
              value={draft.buildBudgetUsd}
              onChange={(e) => setDraft((d) => ({ ...d, buildBudgetUsd: e.target.value }))}
            />
          </Field>
        </div>

        {monthly ? (
          <div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[12px] text-ink-2">This month</span>
              <span className="tabular ml-auto text-[11.5px] text-ink-3">
                {spentUsd == null
                  ? "not priced"
                  : `${formatCurrency(spentUsd, "USD")} of ${formatCurrency(monthly, "USD")}`}
                {pct != null ? ` · ${pct}%` : ""}
              </span>
            </div>
            <Meter
              value={pct ?? 0}
              tone={pct != null && pct >= 100 ? "danger" : pct != null && pct >= 80 ? "warn" : "ok"}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-3">
              Warnings appear at 50% and 80%. At 100%, new AI jobs are refused if enforcement is on.
            </p>
          </div>
        ) : null}

        <Checkbox
          label="Refuse new AI jobs once the monthly budget is spent"
          hint="Turn this off to warn only. Unpriced models never block work either way."
          checked={draft.enforceBudget}
          onChange={(e) => setDraft((d) => ({ ...d, enforceBudget: e.target.checked }))}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="label mb-1.5">Cost mode</p>
            <Segmented
              ariaLabel="Cost mode"
              value={draft.costMode}
              onChange={(v) => setDraft((d) => ({ ...d, costMode: v }))}
              options={COST_MODES.map((m) => ({ value: m.id, label: m.label, title: m.description }))}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-3">
              {COST_MODES.find((m) => m.id === draft.costMode)?.description}
            </p>
          </div>

          <div>
            <p className="label mb-1.5">Default build quality</p>
            <Segmented
              ariaLabel="Build quality"
              value={draft.buildQuality}
              onChange={(v) => setDraft((d) => ({ ...d, buildQuality: v }))}
              options={[
                { value: "economy" as const, label: "Economy" },
                { value: "balanced" as const, label: "Balanced" },
                { value: "quality" as const, label: "Quality" },
              ]}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-3">
              Quality uses the premium model for anything a client will see. This is the default
              because a bad generated site costs more than the tokens saved.
            </p>
          </div>
        </div>

        {spentUsd == null ? (
          <InfoNote>
            No model prices are configured, so spend cannot be measured and budgets cannot bind. Add
            per-million-token prices in <code>src/config/ai.ts</code> to turn this on.
          </InfoNote>
        ) : null}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- workspace */

export function WorkspaceForm({
  name,
  currency,
  timezone,
  senderName,
  senderRole,
  maxQaIterations,
  notifyOnBuild,
  notifyOnAuditFailure,
  notifyOnReply,
  notifyOnFollowUpDue,
}: {
  name: string;
  currency: string;
  timezone: string;
  senderName: string;
  senderRole: string;
  maxQaIterations: number;
  notifyOnBuild: boolean;
  notifyOnAuditFailure: boolean;
  notifyOnReply: boolean;
  notifyOnFollowUpDue: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState({
    name,
    currency,
    timezone,
    senderName,
    senderRole,
    maxQaIterations,
    notifyOnBuild,
    notifyOnAuditFailure,
    notifyOnReply,
    notifyOnFollowUpDue,
  });
  const [error, setError] = useState<Err>(null);

  return (
    <Panel>
      <PanelHeader
        title="Workspace"
        actions={
          <Button
            variant="primary"
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const ws = await updateWorkspaceAction({
                  name: draft.name,
                  currency: draft.currency,
                  timezone: draft.timezone,
                });
                if (!ws.ok) {
                  setError({ message: ws.error.message, remedy: ws.error.remedy });
                  return;
                }
                const st = await updateSettingsAction({
                  senderName: draft.senderName,
                  senderRole: draft.senderRole,
                  maxQaIterations: draft.maxQaIterations,
                  notifyOnBuild: draft.notifyOnBuild,
                  notifyOnAuditFailure: draft.notifyOnAuditFailure,
                  notifyOnReply: draft.notifyOnReply,
                  notifyOnFollowUpDue: draft.notifyOnFollowUpDue,
                });
                if (!st.ok) {
                  setError({ message: st.error.message, remedy: st.error.remedy });
                  return;
                }
                toast.success("Workspace saved");
                router.refresh();
              })
            }
          >
            Save
          </Button>
        }
      />

      <div className="px-4 py-3 grid gap-3.5 sm:grid-cols-2">
        <Field label="Workspace name" htmlFor="ws-name" required>
          <Input
            id="ws-name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </Field>

        <Field label="Currency" htmlFor="ws-currency" hint="Three-letter code, for pipeline value.">
          <Select
            id="ws-currency"
            value={draft.currency}
            onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
          >
            {["INR", "USD", "GBP", "EUR", "AUD", "CAD", "AED", "SGD"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Timezone" htmlFor="ws-tz" hint="Used for due dates and daily spend windows.">
          <Input
            id="ws-tz"
            value={draft.timezone}
            onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
            placeholder="Asia/Kolkata"
          />
        </Field>

        <Field label="Max visual QA iterations" htmlFor="ws-qa" hint="Fix-and-recheck cycles per build.">
          <Input
            id="ws-qa"
            type="number"
            min={1}
            max={10}
            value={draft.maxQaIterations}
            onChange={(e) =>
              setDraft((d) => ({ ...d, maxQaIterations: Number(e.target.value) || 1 }))
            }
          />
        </Field>

        <Field label="Your name" htmlFor="ws-sender" hint="Signs off generated outreach.">
          <Input
            id="ws-sender"
            value={draft.senderName}
            onChange={(e) => setDraft((d) => ({ ...d, senderName: e.target.value }))}
            placeholder="Left blank, messages are unsigned"
          />
        </Field>

        <Field label="Your role" htmlFor="ws-role">
          <Input
            id="ws-role"
            value={draft.senderRole}
            onChange={(e) => setDraft((d) => ({ ...d, senderRole: e.target.value }))}
          />
        </Field>

        <div className="sm:col-span-2">
          <p className="label mb-2">Notify me about</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Checkbox
              label="Website build finished"
              checked={draft.notifyOnBuild}
              onChange={(e) => setDraft((d) => ({ ...d, notifyOnBuild: e.target.checked }))}
            />
            <Checkbox
              label="An audit failed"
              checked={draft.notifyOnAuditFailure}
              onChange={(e) => setDraft((d) => ({ ...d, notifyOnAuditFailure: e.target.checked }))}
            />
            <Checkbox
              label="A prospect replied"
              checked={draft.notifyOnReply}
              onChange={(e) => setDraft((d) => ({ ...d, notifyOnReply: e.target.checked }))}
            />
            <Checkbox
              label="A follow-up is due"
              checked={draft.notifyOnFollowUpDue}
              onChange={(e) => setDraft((d) => ({ ...d, notifyOnFollowUpDue: e.target.checked }))}
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="px-4 pb-3">
          <ErrorState title="Could not save" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------- tags */

export function TagManager({ tags }: { tags: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  return (
    <Panel>
      <PanelHeader title="Tags" hint="Used for filtering, bulk operations and CSV export." />
      <div className="px-4 py-3 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <Badge key={t.id} tone="neutral">
            {t.name}
          </Badge>
        ))}
        {tags.length === 0 ? <p className="text-[12px] text-ink-3">No tags yet.</p> : null}
      </div>
      <form
        className="px-4 pb-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          start(async () => {
            const res = await createTagAction(name);
            if (res.ok) {
              toast.success(`Tag "${name.trim()}" created`);
              setName("");
              router.refresh();
            } else {
              toast.error("Could not create the tag", res.error.message);
            }
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
        <Button type="submit" disabled={pending || !name.trim()}>
          Add tag
        </Button>
      </form>
    </Panel>
  );
}

/* ---------------------------------------------------------------- opt-outs */

export type OptOutRow = {
  id: string;
  channel: string;
  identifier: string;
  reason: string | null;
  at: string;
};

export function OptOutManager({ optOuts }: { optOuts: OptOutRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [channel, setChannel] = useState("all");
  const [identifier, setIdentifier] = useState("");

  return (
    <Panel>
      <PanelHeader
        title="Opt-outs"
        hint="Checked when a draft is written and again before it sends. Permanent by design."
      />

      <form
        className="px-4 py-3 flex flex-wrap items-end gap-2 border-b border-line"
        onSubmit={(e) => {
          e.preventDefault();
          if (!identifier.trim()) return;
          start(async () => {
            const res = await recordOptOutAction(channel, identifier.trim(), "Added by hand");
            if (res.ok) {
              toast.success("Opt-out recorded", "They will be excluded from every future draft.");
              setIdentifier("");
              router.refresh();
            } else {
              toast.error("Could not record the opt-out", res.error.message);
            }
          });
        }}
      >
        <Field label="Channel" htmlFor="oo-channel" className="w-32">
          <Select id="oo-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="all">All channels</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="linkedin">LinkedIn</option>
          </Select>
        </Field>
        <Field
          label="Email, phone or handle"
          htmlFor="oo-id"
          className="flex-1 min-w-52"
          hint="Normalised before matching, so formatting differences still block."
        >
          <Input
            id="oo-id"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="hello@example.com"
          />
        </Field>
        <Button type="submit" disabled={pending || !identifier.trim()} className="mb-5">
          Add opt-out
        </Button>
      </form>

      {optOuts.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">
          Nobody has opted out. Marking a prospect &ldquo;not interested&rdquo; records one here
          automatically for every identifier they expose.
        </p>
      ) : (
        <ul>
          {optOuts.map((o) => (
            <li
              key={o.id}
              className="px-4 py-2.5 border-b border-line last:border-0 flex items-center gap-3"
            >
              <Badge tone="neutral">{o.channel}</Badge>
              <span className="text-[12.5px] text-ink font-mono min-w-0 flex-1 truncate">
                {o.identifier}
              </span>
              <span className="text-[11.5px] text-ink-4 hidden sm:block">
                {o.reason ?? "no reason recorded"}
              </span>
              <span className="text-[11px] text-ink-4">{relativeTime(o.at)}</span>
              <Button
                size="xs"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await removeOptOutAction(o.id);
                    if (res.ok) {
                      toast.warning("Opt-out removed", "This contact can be messaged again.");
                      router.refresh();
                    }
                  })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
