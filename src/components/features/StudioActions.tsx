"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deployProjectAction,
  restoreVersionAction,
  startBuildAction,
  updateBriefAction,
} from "@/app/actions";
import type { WebsiteBrief } from "@/types";
import {
  Button,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Panel,
  PanelHeader,
  Textarea,
} from "@/components/ui/primitives";

type Err = { message: string; remedy: string } | null;

export function BuildControls({
  projectId,
  hasVersions,
  strategyLabel,
}: {
  projectId: string;
  hasVersions: boolean;
  strategyLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<Err>(null);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              setNote(null);
              const res = await startBuildAction(projectId);
              if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
              else setNote(`v${res.data.version} built · quality ${res.data.qualityScore}/100`);
              router.refresh();
            })
          }
        >
          {pending ? "Building…" : hasVersions ? "Rebuild" : "Build website"}
        </Button>
      </div>
      <p className="text-[11.5px] text-ink-3">{strategyLabel}</p>
      {note ? <p className="text-[11.5px] text-ok">{note}</p> : null}
      {error ? (
        <div className="w-full max-w-md">
          <ErrorState title="Build failed" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
    </div>
  );
}

export function DeployControls({
  projectId,
  configured,
  providerLabel,
  setupHint,
}: {
  projectId: string;
  configured: boolean;
  providerLabel: string;
  setupHint: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<Err>(null);
  const [url, setUrl] = useState<string | null>(null);

  function deploy(environment: "preview" | "production") {
    start(async () => {
      setError(null);
      setUrl(null);
      const res = await deployProjectAction(projectId, environment);
      if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
      else setUrl(res.data.url);
      router.refresh();
    });
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-2.5">
      {!configured ? (
        <InfoNote tone="warn">
          <strong className="font-semibold">No deployment provider is configured.</strong> {setupHint}{" "}
          The generated files are on disk under the projects root and can be deployed by hand in the
          meantime.
        </InfoNote>
      ) : (
        <p className="text-[12px] text-ink-3">Deploying through {providerLabel}.</p>
      )}
      <div className="flex items-center gap-2">
        <Button disabled={pending || !configured} onClick={() => deploy("preview")}>
          Deploy preview
        </Button>
        <Button variant="primary" disabled={pending || !configured} onClick={() => deploy("production")}>
          Deploy to production
        </Button>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent hover:underline">
          {url}
        </a>
      ) : null}
      {error ? <ErrorState title="Deployment failed" message={error.message} remedy={error.remedy} /> : null}
    </div>
  );
}

export function RestoreVersionButton({
  projectId,
  versionId,
  version,
}: {
  projectId: string;
  versionId: string;
  version: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<Err>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await restoreVersionAction(projectId, versionId);
            if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
            router.refresh();
          })
        }
      >
        {pending ? "Restoring…" : `Restore v${version}`}
      </Button>
      {error ? <p className="text-[11px] text-danger max-w-64 text-right">{error.message}</p> : null}
    </div>
  );
}

const TEXT_FIELDS: { key: keyof WebsiteBrief; label: string; long?: boolean }[] = [
  { key: "positioning", label: "Positioning", long: true },
  { key: "targetAudience", label: "Target audience", long: true },
  { key: "primaryGoal", label: "Primary conversion goal" },
  { key: "designStyle", label: "Design style", long: true },
  { key: "colorDirection", label: "Colour direction", long: true },
  { key: "typographyDirection", label: "Typography direction", long: true },
  { key: "ctaStrategy", label: "CTA strategy", long: true },
  { key: "contentStrategy", label: "Content strategy", long: true },
  { key: "seoStrategy", label: "SEO strategy", long: true },
  { key: "mobileStrategy", label: "Mobile strategy", long: true },
  { key: "animationDirection", label: "Animation direction", long: true },
  { key: "socialProof", label: "Social proof", long: true },
];

export function BriefEditor({ projectId, brief }: { projectId: string; brief: WebsiteBrief }) {
  const router = useRouter();
  const [draft, setDraft] = useState<WebsiteBrief>(brief);
  const [pending, start] = useTransition();
  const [error, setError] = useState<Err>(null);
  const [saved, setSaved] = useState(false);

  return (
    <Panel>
      <PanelHeader
        title="Brief"
        hint={`Generated by ${brief.generatedBy}. Edit it before building — the build agent works from exactly this document.`}
        actions={
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setSaved(false);
                const res = await updateBriefAction(projectId, draft);
                if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
                else setSaved(true);
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save brief"}
          </Button>
        }
      />
      <div className="px-4 py-4 grid gap-3.5 lg:grid-cols-2">
        {TEXT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`brief-${f.key}`} className={f.long ? "lg:col-span-1" : ""}>
            {f.long ? (
              <Textarea
                id={`brief-${f.key}`}
                value={String(draft[f.key] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            ) : (
              <Input
                id={`brief-${f.key}`}
                value={String(draft[f.key] ?? "")}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}

        <Field
          label="Requires client input"
          htmlFor="brief-unknowns"
          hint="One per line. These render as visible placeholders on the site instead of invented copy."
          className="lg:col-span-2"
        >
          <Textarea
            id="brief-unknowns"
            value={draft.requiresClientInput.join("\n")}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                requiresClientInput: e.target.value.split("\n").filter((l) => l.trim()),
              }))
            }
          />
        </Field>
      </div>
      {saved ? <p className="px-4 pb-3 text-[11.5px] text-ok">Brief saved.</p> : null}
      {error ? (
        <div className="px-4 pb-3">
          <ErrorState title="Could not save" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}
    </Panel>
  );
}
