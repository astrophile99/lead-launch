"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addNoteAction,
  analyseOpportunityAction,
  auditProspectAction,
  draftOutreachAction,
  generateBriefAction,
  optOutAction,
  setStageAction,
  toggleTagAction,
} from "@/app/actions";
import { PIPELINE_STAGES, STAGE_META } from "@/config/pipeline";
import {
  Button,
  ErrorState,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Err = { message: string; remedy: string } | null;

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<Err>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: { message: string; remedy: string } } & Record<string, unknown>>, success?: string) => {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await fn();
      if (!res.ok && res.error) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        return;
      }
      if (success) setNote(success);
      router.refresh();
    });
  };

  return { pending, error, note, run };
}

export function ProspectPrimaryActions({
  prospectId,
  hasAudit,
  hasOpportunityAnalysis,
  projectId,
  hasWebsite,
}: {
  prospectId: string;
  hasAudit: boolean;
  hasOpportunityAnalysis: boolean;
  projectId: string | null;
  hasWebsite: boolean;
}) {
  const router = useRouter();
  const { pending, error, note, run } = useAction();

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2 justify-end">
        <Button
          disabled={pending}
          onClick={() => run(() => auditProspectAction(prospectId), "Audit complete.")}
          title={hasWebsite ? "Fetch and analyse the live site" : "Record the absence of a website"}
        >
          {hasAudit ? "Re-audit" : "Audit website"}
        </Button>

        <Button
          disabled={pending || !hasAudit}
          title={hasAudit ? undefined : "Audit first — the analysis is grounded in audit findings."}
          onClick={() => run(() => analyseOpportunityAction(prospectId), "Sales angle ready.")}
        >
          {hasOpportunityAnalysis ? "Re-analyse" : "Generate sales angle"}
        </Button>

        <Button
          variant="primary"
          disabled={pending || !hasAudit}
          onClick={() =>
            run(async () => {
              const res = await generateBriefAction(prospectId);
              if (res.ok) router.push(`/studio/${res.data.projectId}`);
              return res;
            })
          }
        >
          {projectId ? "Regenerate concept" : "Create website concept"}
        </Button>

        {projectId ? (
          <Button onClick={() => router.push(`/studio/${projectId}`)}>Open studio</Button>
        ) : null}
      </div>

      {note ? <p className="text-[11.5px] text-ok">{note}</p> : null}
      {pending ? <p className="text-[11.5px] text-ink-3">Working…</p> : null}
      {error ? (
        <div className="w-full max-w-md">
          <ErrorState title="That step failed" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
    </div>
  );
}

export function StageSelect({ prospectId, stage }: { prospectId: string; stage: string }) {
  const { pending, error, run } = useAction();
  return (
    <div>
      <Select
        aria-label="Pipeline stage"
        className="w-auto"
        value={stage}
        disabled={pending}
        onChange={(e) => run(() => setStageAction(prospectId, e.target.value))}
      >
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_META[s].label}
          </option>
        ))}
      </Select>
      {error ? <p className="mt-1 text-[11.5px] text-danger">{error.message}</p> : null}
    </div>
  );
}

export function TagPicker({
  prospectId,
  tags,
  active,
}: {
  prospectId: string;
  tags: { id: string; name: string }[];
  active: string[];
}) {
  const { pending, run } = useAction();
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const on = active.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            disabled={pending}
            onClick={() => run(() => toggleTagAction(prospectId, t.id))}
            className={cn(
              "h-6 px-2 text-[11.5px] rounded-[2px] border transition-colors",
              on
                ? "bg-accent-soft border-accent/40 text-accent"
                : "border-line text-ink-3 hover:border-line-strong hover:text-ink",
            )}
          >
            {t.name}
          </button>
        );
      })}
      {tags.length === 0 ? (
        <p className="text-[12px] text-ink-3">No tags yet. Create them in Settings.</p>
      ) : null}
    </div>
  );
}

export function NoteComposer({ prospectId }: { prospectId: string }) {
  const [body, setBody] = useState("");
  const { pending, error, run } = useAction();

  return (
    <form
      className="p-4 border-t border-line flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        run(async () => {
          const res = await addNoteAction(prospectId, body);
          if (res.ok) setBody("");
          return res;
        });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you learn? Who did you speak to?"
        aria-label="New note"
      />
      {error ? <p className="text-[11.5px] text-danger">{error.message}</p> : null}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}

export function DraftOutreachControls({
  prospectId,
  canDraft,
}: {
  prospectId: string;
  canDraft: boolean;
}) {
  const { pending, error, run } = useAction();
  const [channel, setChannel] = useState("email");
  const [variant, setVariant] = useState("normal");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Channel"
          className="w-auto"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram DM</option>
          <option value="linkedin">LinkedIn</option>
          <option value="generic">Generic copy</option>
        </Select>
        <Select
          aria-label="Variant"
          className="w-auto"
          value={variant}
          onChange={(e) => setVariant(e.target.value)}
        >
          <option value="short">Short pitch</option>
          <option value="normal">Normal pitch</option>
          <option value="detailed">Detailed pitch</option>
          <option value="followup1">Follow-up 1</option>
          <option value="followup2">Follow-up 2</option>
          <option value="final">Final follow-up</option>
        </Select>
        <Button
          variant="primary"
          disabled={pending || !canDraft}
          title={canDraft ? undefined : "Run the audit first — drafts are grounded in recorded observations."}
          onClick={() => run(() => draftOutreachAction({ prospectId, channel, variant }))}
        >
          {pending ? "Drafting…" : "Draft message"}
        </Button>
      </div>
      {error ? <ErrorState title="Draft failed" message={error.message} remedy={error.remedy} /> : null}
    </div>
  );
}

export function OptOutButton({ prospectId }: { prospectId: string }) {
  const { pending, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        Mark not interested
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-ink-3">Withdraw drafts and exclude from outreach?</span>
      <Button
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={() => run(() => optOutAction(prospectId))}
      >
        Confirm
      </Button>
      <Button size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </div>
  );
}
