"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  approveForSendAction,
  bulkSendApprovedAction,
  editMessageAction,
  retryFailedAction,
  sendApprovedAction,
} from "@/app/actions";
import { CHANNEL_LABEL } from "@/config/outreach";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  InfoNote,
  Input,
  Panel,
  PanelHeader,
  Segmented,
  StatusDot,
  Textarea,
  type Tone,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { NavIcon } from "@/components/shell/icon";
import { cn, relativeTime } from "@/lib/utils";

/**
 * The Outreach Command Center.
 *
 * One queue for every channel, and one flow: read it, edit it, approve it,
 * send it. The four are separate deliberately —
 *
 *   - **Approve does not send.** There is no combined control that quietly
 *     does both, and no setting that turns approval into sending.
 *   - **Send always names the recipient.** The confirmation repeats the
 *     address and the channel back, because "send" with the recipient off
 *     screen is how a message goes to the wrong person.
 *   - **Editing withdraws approval.** Shown in the UI, enforced in the
 *     service.
 *   - **Bulk sends only what was already approved one at a time**, and repeats
 *     the exact count back before doing it.
 *
 * Mobile is a card reviewer rather than a squeezed table: one message at a
 * time, full text, big targets — but the recipient and the channel are always
 * on screen.
 */

export type QueueRow = {
  id: string;
  prospectId: string;
  businessName: string;
  city: string;
  channel: string;
  channelLabel: string;
  variant: string;
  subject: string | null;
  body: string;
  recipient: string | null;
  transport: string | null;
  status: string;
  generatedByAI: boolean;
  provider: string | null;
  model: string | null;
  observations: string[];
  failureReason: string | null;
  externalId: string | null;
  threadId: string | null;
  draftId: string | null;
  createdAt: string;
  editedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  lastContactAt: string | null;
  stage: string;
};

const STATUS_TONE: Record<string, Tone> = {
  draft: "info",
  approved: "accent",
  sending: "warn",
  sent: "ok",
  failed: "danger",
  replied: "ok",
  "opted-out": "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Needs review",
  approved: "Approved · not sent",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  replied: "Replied",
  "opted-out": "Withdrawn",
};

const CHANNEL_ICON: Record<string, string> = {
  email: "email",
  whatsapp: "phone",
  instagram: "instagram",
  linkedin: "linkedin",
  generic: "send",
};

const FILTERS = [
  { value: "all", label: "All" },
  { value: "needs-review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "follow-up-due", label: "Follow-up due" },
  { value: "failed", label: "Failed" },
];

const CHANNELS = [
  { value: "all", label: "All channels" },
  { value: "email", label: CHANNEL_LABEL.email },
  { value: "whatsapp", label: CHANNEL_LABEL.whatsapp },
  { value: "instagram", label: CHANNEL_LABEL.instagram },
  { value: "linkedin", label: CHANNEL_LABEL.linkedin },
];

/* ------------------------------------------------------- send confirmation */

function SendConfirm({
  row,
  onCancel,
  onConfirm,
  pending,
}: {
  row: QueueRow;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="border border-accent/40 bg-accent-soft rounded-md p-3 flex flex-col gap-2.5">
      <p className="text-[12.5px] font-medium text-ink">Send this message?</p>
      <dl className="text-[12px] grid grid-cols-[5.5rem_1fr] gap-y-1">
        <dt className="text-ink-3">To</dt>
        <dd className="text-ink font-medium break-all">
          {row.recipient ?? (
            <span className="text-danger">No recipient on record — this will fail.</span>
          )}
        </dd>
        <dt className="text-ink-3">Channel</dt>
        <dd className="text-ink-2">
          {row.channelLabel}
          {row.transport ? ` · via ${row.transport}` : ""}
        </dd>
        {row.subject ? (
          <>
            <dt className="text-ink-3">Subject</dt>
            <dd className="text-ink-2 break-words">{row.subject}</dd>
          </>
        ) : null}
      </dl>
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" loading={pending} onClick={onConfirm}>
          Send message
        </Button>
        <Button size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- one card */

function MessageCard({
  row,
  selected,
  onSelect,
  onChanged,
}: {
  row: QueueRow;
  selected: boolean;
  onSelect: (id: string, on: boolean) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(row.subject ?? "");
  const [body, setBody] = useState(row.body);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);

  const dirty = editing && (body !== row.body || subject !== (row.subject ?? ""));

  function run(fn: () => Promise<{ ok: boolean; error?: { message: string; remedy: string } }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok && res.error) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        return;
      }
      onChanged();
    });
  }

  return (
    <Panel className={cn(selected && "border-accent")}>
      <div className="px-3.5 py-2.5 border-b border-line flex items-start gap-2.5">
        {row.status === "approved" ? (
          <span className="pt-0.5">
            <Checkbox
              checked={selected}
              onChange={(e) => onSelect(row.id, e.target.checked)}
              label=""
              aria-label={`Select the message to ${row.businessName}`}
            />
          </span>
        ) : null}

        <NavIcon
          name={CHANNEL_ICON[row.channel] ?? "send"}
          className="size-4 shrink-0 mt-0.5 text-ink-4"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/prospects/${row.prospectId}`}
              className="text-[13px] font-medium text-ink hover:text-accent transition-colors truncate"
            >
              {row.businessName}
            </Link>
            <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>
              {STATUS_LABEL[row.status] ?? row.status}
            </Badge>
            {!row.generatedByAI ? <Badge tone="neutral">edited by you</Badge> : null}
            {row.provider === "mock" ? (
              <Badge tone="warn" title="Rearranged from stored observations by the deterministic composer. No model was called and nothing was inferred.">
                composed, not written by a model
              </Badge>
            ) : null}
          </div>
          <p className="text-[11.5px] text-ink-4 mt-0.5 truncate">
            {row.channelLabel}
            {row.recipient ? ` · ${row.recipient}` : " · no recipient on record"}
            {row.sentAt
              ? ` · sent ${relativeTime(row.sentAt)}`
              : row.approvedAt
                ? ` · approved ${relativeTime(row.approvedAt)}`
                : ` · drafted ${relativeTime(row.createdAt)}`}
          </p>
        </div>

        {row.status === "sending" ? <StatusDot tone="warn" live /> : null}
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-2.5">
        {editing ? (
          <>
            {row.channel === "email" ? (
              <Input
                aria-label="Subject"
                value={subject}
                maxLength={200}
                placeholder="Subject"
                onChange={(e) => setSubject(e.target.value)}
              />
            ) : null}
            <Textarea
              aria-label="Message body"
              rows={8}
              value={body}
              maxLength={8000}
              onChange={(e) => setBody(e.target.value)}
            />
            {row.status === "approved" ? (
              <InfoNote tone="warn">
                Saving returns this to <strong className="font-semibold">needs review</strong>.
                Approval is of specific words, so changing them withdraws it.
              </InfoNote>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                loading={pending}
                disabled={!dirty}
                onClick={() =>
                  run(async () => {
                    const res = await editMessageAction({
                      messageId: row.id,
                      subject: row.channel === "email" ? subject : null,
                      body,
                    });
                    if (res.ok) {
                      setEditing(false);
                      toast.success("Draft saved", "It is back in review.");
                    }
                    return res;
                  })
                }
              >
                Save changes
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setBody(row.body);
                  setSubject(row.subject ?? "");
                }}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {row.subject ? (
              <p className="text-[12.5px] font-medium text-ink break-words">{row.subject}</p>
            ) : null}
            <p className="text-[12.5px] text-ink-2 whitespace-pre-wrap leading-relaxed break-words">
              {row.body}
            </p>
          </>
        )}

        {row.observations.length > 0 && !editing ? (
          <details className="text-[11.5px]">
            <summary className="text-ink-4 cursor-pointer hover:text-ink-3">
              Grounded in {row.observations.length} recorded observation
              {row.observations.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-1 flex flex-col gap-0.5 pl-3">
              {row.observations.map((o) => (
                <li key={o} className="text-ink-3 flex gap-1.5">
                  <span aria-hidden>·</span>
                  {o}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {row.failureReason ? (
          <InfoNote tone="danger">{row.failureReason}</InfoNote>
        ) : null}

        {error ? <ErrorState title="Could not do that" message={error.message} remedy={error.remedy} /> : null}

        {confirming ? (
          <SendConfirm
            row={row}
            pending={pending}
            onCancel={() => setConfirming(false)}
            onConfirm={() =>
              run(async () => {
                const res = await sendApprovedAction(row.id);
                if (res.ok) {
                  setConfirming(false);
                  if (res.data.status === "sent") {
                    toast.success(
                      `Sent to ${row.recipient}`,
                      `${res.data.detail} Provider id ${res.data.externalId}.`,
                    );
                  } else {
                    // Not sent. Say so as a warning, never as a success.
                    toast.warning("Nothing was sent", res.data.detail);
                  }
                }
                return res;
              })
            }
          />
        ) : !editing ? (
          <div className="flex flex-wrap items-center gap-2">
            {row.status === "draft" ? (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await approveForSendAction(row.id);
                      if (res.ok) {
                        toast.success(
                          "Approved",
                          "Nothing has been sent — sending is a separate step.",
                        );
                      }
                      return res;
                    })
                  }
                >
                  Approve
                </Button>
              </>
            ) : null}

            {row.status === "approved" ? (
              <>
                <Button size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="primary" size="sm" onClick={() => setConfirming(true)}>
                  Send…
                </Button>
                <span className="text-[11px] text-ink-4">
                  Approved is not sent. This message has not gone anywhere.
                </span>
              </>
            ) : null}

            {row.status === "failed" ? (
              <Button
                size="sm"
                loading={pending}
                onClick={() =>
                  run(async () => {
                    const res = await retryFailedAction(row.id);
                    if (res.ok) toast.info("Back in the queue", "Approved, and ready to send again.");
                    return res;
                  })
                }
              >
                Return to approved
              </Button>
            ) : null}

            {row.status === "sent" ? (
              <span className="text-[11.5px] text-ok">
                Confirmed by {row.transport ?? "the provider"}
                {row.externalId ? ` · id ${row.externalId.slice(0, 18)}` : ""}
              </span>
            ) : null}

            <Link
              href={`/prospects/${row.prospectId}?tab=outreach`}
              className="ml-auto text-[11.5px] text-accent hover:underline underline-offset-2"
            >
              Open prospect
            </Link>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------- the page */

export function OutreachCenter({
  rows,
  counts,
}: {
  rows: QueueRow[];
  counts: Record<string, number>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [pending, start] = useTransition();

  const state = params.get("state") ?? "all";
  const channel = params.get("channel") ?? "all";

  const approved = useMemo(() => rows.filter((r) => r.status === "approved"), [rows]);
  const selectedRows = approved.filter((r) => selected.has(r.id));

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete(key);
    else next.set(key, value);
    router.push(`/outreach${next.toString() ? `?${next}` : ""}`);
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          title="Queue"
          hint="Every channel in one place. Drafts are written by AI; nothing leaves the building without you reading it and pressing send."
          actions={
            <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
              <span className="tabular">{counts.draft ?? 0} to review</span>
              <span aria-hidden>·</span>
              <span className="tabular">{counts.approved ?? 0} approved</span>
            </div>
          }
        />
        <div className="px-3.5 py-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="overflow-x-auto -mx-1 px-1">
            <Segmented
              ariaLabel="Filter by state"
              size="sm"
              value={state}
              onChange={(v) => setParam("state", v)}
              options={FILTERS.map((f) => ({
                value: f.value,
                label: f.label,
              }))}
            />
          </div>
          <div className="sm:ml-auto overflow-x-auto -mx-1 px-1">
            <Segmented
              ariaLabel="Filter by channel"
              size="sm"
              value={channel}
              onChange={(v) => setParam("channel", v)}
              options={CHANNELS.map((c) => ({ value: c.value, label: c.label }))}
            />
          </div>
        </div>
      </Panel>

      {selectedRows.length > 0 ? (
        <Panel className="border-accent">
          <div className="px-3.5 py-3 flex flex-col gap-2.5">
            {!bulkConfirm ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12.5px] text-ink">
                  <strong className="font-semibold tabular">{selectedRows.length}</strong> approved
                  message{selectedRows.length === 1 ? "" : "s"} selected.
                </p>
                <Button variant="primary" size="sm" onClick={() => setBulkConfirm(true)}>
                  Send selected…
                </Button>
                <Button size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            ) : (
              <>
                <p className="text-[12.5px] text-ink">
                  Send <strong className="font-semibold tabular">{selectedRows.length}</strong>{" "}
                  message{selectedRows.length === 1 ? "" : "s"} to these recipients?
                </p>
                <ul className="max-h-40 overflow-y-auto border border-line rounded-sm divide-y divide-line">
                  {selectedRows.map((r) => (
                    <li key={r.id} className="px-2.5 py-1.5 text-[11.5px] flex gap-2">
                      <span className="text-ink-2 truncate flex-1">{r.businessName}</span>
                      <span className="text-ink-4">{r.channelLabel}</span>
                      <span className="text-ink-3 truncate max-w-48">{r.recipient ?? "—"}</span>
                    </li>
                  ))}
                </ul>
                <InfoNote tone="warn">
                  Each of these was approved individually. This sends them one at a time and stops
                  at the hourly rate limit; it cannot approve anything.
                </InfoNote>
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await bulkSendApprovedAction({
                          messageIds: selectedRows.map((r) => r.id),
                          // Repeated back so a list that changed underneath is
                          // refused rather than silently sent.
                          confirmedCount: selectedRows.length,
                        });
                        if (!res.ok) {
                          toast.error("Nothing was sent", res.error.message);
                          return;
                        }
                        const d = res.data;
                        const summary = [
                          `${d.sent} sent`,
                          d.manual ? `${d.manual} need sending by hand` : "",
                          d.failed ? `${d.failed} failed` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        if (d.sent > 0 && d.failed === 0 && d.manual === 0) {
                          toast.success("Sent", summary);
                        } else {
                          toast.warning(summary, d.details.join(" "));
                        }
                        setSelected(new Set());
                        setBulkConfirm(false);
                        router.refresh();
                      })
                    }
                  >
                    Send {selectedRows.length} message{selectedRows.length === 1 ? "" : "s"}
                  </Button>
                  <Button size="sm" disabled={pending} onClick={() => setBulkConfirm(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        </Panel>
      ) : null}

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            title={
              state === "needs-review"
                ? "No messages waiting for review"
                : state === "approved"
                  ? "Nothing approved and waiting"
                  : "No messages yet"
            }
            body={
              state === "all"
                ? "Draft outreach from a prospect once its audit has run. Messages are written only from observations that actually exist, so the audit comes first."
                : "Once you generate outreach for qualified prospects, their drafts appear here."
            }
            action={
              <Link
                href="/prospects?score=high"
                className="inline-flex items-center h-8 px-3 rounded-sm bg-accent text-accent-ink text-[12.5px] font-medium hover:bg-accent-hover transition-colors"
              >
                Find prospects worth writing to
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <MessageCard
              key={row.id}
              row={row}
              selected={selected.has(row.id)}
              onSelect={toggle}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
