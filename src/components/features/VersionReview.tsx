"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setVersionApprovalAction } from "@/app/actions";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  InfoNote,
  Panel,
  PanelHeader,
  ScoreBadge,
  Segmented,
  SkeletonText,
  Table,
  Td,
  Textarea,
  Th,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Human review of a built version.
 *
 * A version is a draft until a person says otherwise. There is no path that
 * marks one approved automatically — not a high quality score, not a clean
 * gate, not a successful build — because "the checks passed" and "I have
 * looked at this and it is good" are different claims and only the second one
 * is worth making to a client.
 */

export type VersionRow = {
  id: string;
  version: number;
  createdAt: string;
  provider: string | null;
  model: string | null;
  strategy: string;
  quality: string;
  qualityScore: number | null;
  approval: string;
  approvedAt: string | null;
  reviewNote: string | null;
  changes: string[];
  fileCount: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  durationMs: number | null;
  hasReadme: boolean;
};

const APPROVAL_TONE = {
  draft: "info",
  approved: "ok",
  rejected: "danger",
} as const;

const APPROVAL_LABEL = {
  draft: "Draft — not reviewed",
  approved: "Approved",
  rejected: "Rejected",
} as const;

function usage(v: VersionRow): string {
  if (v.strategy === "scaffold") return "No model was called";
  const tokens =
    v.tokensIn != null && v.tokensOut != null
      ? `${((v.tokensIn + v.tokensOut) / 1000).toFixed(1)}k tokens`
      : "usage not reported";
  const money = v.costUsd != null ? ` · $${v.costUsd.toFixed(3)}` : " · not priced";
  return `${tokens}${money}`;
}

export function VersionList({ versions }: { versions: VersionRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);

  if (versions.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No versions yet"
          body="A version appears after the first successful build. Nothing is built until you ask for it, with a model and a cost estimate in front of you."
        />
      </Panel>
    );
  }

  function setApproval(id: string, approval: "draft" | "approved" | "rejected", text?: string) {
    setError(null);
    start(async () => {
      const res = await setVersionApprovalAction(id, approval, text);
      if (!res.ok) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        return;
      }
      toast.success(
        approval === "approved"
          ? "Version approved"
          : approval === "rejected"
            ? "Version rejected"
            : "Version moved back to draft",
        approval === "approved"
          ? "It is still not deployed — deployment is a separate, manual step."
          : undefined,
      );
      setNoteFor(null);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorState title="Could not update" message={error.message} remedy={error.remedy} /> : null}

      {versions.map((v) => {
        const approval = (v.approval as keyof typeof APPROVAL_TONE) ?? "draft";
        return (
          <Panel key={v.id}>
            <PanelHeader
              title={
                <span className="flex items-center gap-2 flex-wrap">
                  Version {v.version}
                  <Badge tone={APPROVAL_TONE[approval]}>{APPROVAL_LABEL[approval]}</Badge>
                  <Badge tone={v.strategy === "agent" ? "accent" : "neutral"}>
                    {v.strategy === "agent" ? "AI agent" : "scaffold"}
                  </Badge>
                </span>
              }
              hint={`${formatDateTime(v.createdAt)} · ${
                v.strategy === "agent" ? `${v.provider} / ${v.model}` : "deterministic generator"
              } · ${v.quality} mode · ${usage(v)}`}
              actions={<ScoreBadge score={v.qualityScore} size="lg" />}
            />

            <div className="px-4 py-3 flex flex-col gap-3">
              {v.changes.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {v.changes.map((c) => (
                    <li key={c} className="text-[12.5px] text-ink-2 flex gap-2">
                      <span aria-hidden className="text-accent">
                        ·
                      </span>
                      {c}
                    </li>
                  ))}
                </ul>
              ) : null}

              {v.reviewNote ? (
                <p className="text-[12px] text-ink-3 border-l-2 border-line pl-2.5 italic">
                  {v.reviewNote}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/versions/${v.id}/download`}
                  className="inline-flex items-center h-7 px-2.5 rounded-sm border border-line-strong bg-surface-2 text-[12px] font-medium text-ink hover:bg-surface-3 transition-colors"
                >
                  Download ZIP ({v.fileCount} files)
                </a>
                <FileList versionId={v.id} />
                {v.hasReadme ? <ReadmeLink versionId={v.id} version={v.version} /> : null}

                <div className="ml-auto flex items-center gap-2">
                  {approval !== "approved" ? (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={pending}
                      onClick={() => setNoteFor(noteFor === v.id ? null : v.id)}
                    >
                      Mark approved
                    </Button>
                  ) : (
                    <Button size="sm" disabled={pending} onClick={() => setApproval(v.id, "draft")}>
                      Back to draft
                    </Button>
                  )}
                  {approval !== "rejected" ? (
                    <Button size="sm" disabled={pending} onClick={() => setApproval(v.id, "rejected")}>
                      Reject
                    </Button>
                  ) : null}
                </div>
              </div>

              {noteFor === v.id ? (
                <div className="border border-line rounded-md p-3 flex flex-col gap-2">
                  <label htmlFor={`note-${v.id}`} className="label">
                    What did you check? (optional)
                  </label>
                  <Textarea
                    id={`note-${v.id}`}
                    rows={2}
                    value={note}
                    maxLength={500}
                    placeholder="Opened it on a phone, checked the phone number and the opening hours against the listing."
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={pending}
                      onClick={() => setApproval(v.id, "approved", note)}
                    >
                      Approve version {v.version}
                    </Button>
                    <Button size="sm" onClick={() => setNoteFor(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- file list */

type FileRow = { path: string; bytes: number; contentType: string; sha256: string };

function FileList({ versionId }: { versionId: string }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || files) return;
    let cancelled = false;
    void fetch(`/api/versions/${versionId}/files`)
      .then((r) => r.json())
      .then((body: { success: boolean; data?: { files: FileRow[] }; error?: { message: string } }) => {
        if (cancelled) return;
        if (body.success && body.data) setFiles(body.data.files);
        else setError(body.error?.message ?? "Could not load the file list.");
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the file list.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, versionId, files]);

  return (
    <>
      <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "Hide files" : "View files"}
      </Button>
      {open ? (
        <div className="w-full order-last mt-1 border border-line rounded-md overflow-hidden">
          {error ? (
            <p className="px-3 py-2 text-[12px] text-danger">{error}</p>
          ) : !files ? (
            <div className="px-3 py-2">
              <SkeletonText lines={3} />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Path</Th>
                  <Th className="text-right">Size</Th>
                  <Th>Type</Th>
                  <Th>SHA-256</Th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.path}>
                    <Td className="text-ink font-mono text-[11.5px]">{f.path}</Td>
                    <Td className="tabular text-right text-ink-3">
                      {f.bytes < 1024 ? `${f.bytes} B` : `${(f.bytes / 1024).toFixed(1)} KB`}
                    </Td>
                    <Td className="text-ink-4 text-[11.5px]">{f.contentType.split(";")[0]}</Td>
                    <Td className="text-ink-4 font-mono text-[10.5px]">{f.sha256.slice(0, 12)}…</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      ) : null}
    </>
  );
}

function ReadmeLink({ versionId, version }: { versionId: string; version: number }) {
  return (
    <a
      href={`/api/versions/${versionId}/download`}
      className="text-[12px] text-accent hover:underline underline-offset-2"
      title={`The README is inside the v${version} archive`}
    >
      README included
    </a>
  );
}

/* ------------------------------------------------------- completion panel */

/**
 * Shown after a build. Deliberately does not offer "Deploy" as the primary
 * action — this product stops before deployment on purpose.
 */
export function BuildComplete({
  version,
  versionId,
  qualityScore,
  strategy,
  provider,
  model,
  files,
  durable,
  remainingIssues,
  prospectId,
  fallbackReason,
}: {
  version: number;
  versionId: string;
  qualityScore: number | null;
  strategy: string;
  provider: string;
  model: string;
  files: number;
  durable: boolean;
  remainingIssues: string[];
  prospectId: string;
  fallbackReason: string | null;
}) {
  const [tab, setTab] = useState<"summary" | "issues">("summary");

  return (
    <Panel>
      <PanelHeader
        title={`Version ${version} is ready to review`}
        hint={`${
          strategy === "agent" ? `${provider} / ${model}` : "Deterministic scaffold"
        } · ${files} files stored · nothing was deployed`}
        actions={<ScoreBadge score={qualityScore} size="lg" />}
      />

      {fallbackReason ? (
        <div className="px-4 pt-3">
          <InfoNote tone="warn">
            <strong className="font-semibold">The AI agent did not run.</strong> {fallbackReason} The
            deterministic scaffold produced this version instead, and it is labelled as such
            everywhere including in its README.
          </InfoNote>
        </div>
      ) : null}

      {!durable ? (
        <div className="px-4 pt-3">
          <InfoNote tone="warn">
            Stored on the local filesystem, which does not survive a restart on a serverless host.
            Download the ZIP now, or configure <code>STORAGE_PROVIDER=supabase</code>.
          </InfoNote>
        </div>
      ) : null}

      {remainingIssues.length > 0 ? (
        <div className="px-4 pt-3">
          <Segmented
            ariaLabel="Build result view"
            value={tab}
            onChange={setTab}
            options={[
              { value: "summary", label: "Summary" },
              { value: "issues", label: `Issues (${remainingIssues.length})` },
            ]}
          />
        </div>
      ) : null}

      <div className="px-4 py-3">
        {tab === "issues" ? (
          <ul className="flex flex-col gap-1">
            {remainingIssues.map((i) => (
              <li key={i} className="text-[12.5px] text-warn flex gap-2">
                <span aria-hidden>·</span>
                {i}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/versions/${versionId}/download`}
              className={cn(
                "inline-flex items-center h-8 px-3 rounded-sm bg-accent text-accent-ink",
                "text-[12.5px] font-medium hover:bg-accent-hover transition-colors",
              )}
            >
              Download website ZIP
            </a>
            <a
              href={`/prospects/${prospectId}`}
              className="inline-flex items-center h-8 px-3 rounded-sm border border-line-strong bg-surface-2 text-[12.5px] text-ink hover:bg-surface-3 transition-colors"
            >
              Back to prospect
            </a>
            <p className="text-[11.5px] text-ink-4 w-full mt-1">
              Review it, revise it yourself, and deploy it when you are ready. Lead → Launch stops
              here on purpose.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function LastBuiltLine({ at }: { at: string | null }) {
  if (!at) return <span className="text-ink-4">never built</span>;
  return <span className="text-ink-3">built {relativeTime(at)}</span>;
}
