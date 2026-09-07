"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  estimateBuildAction,
  getBuildOptionsAction,
  startBuildAction,
} from "@/app/actions";
import { BUILD_QUALITIES, BUILD_QUALITY, STRATEGY_META, type BuildQuality } from "@/config/build";
import { STAGE_META, type PipelineStage } from "@/config/pipeline";
import {
  Badge,
  Button,
  Checkbox,
  DetailList,
  ErrorState,
  InfoNote,
  ScoreBadge,
  SkeletonText,
  Spinner,
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import type { BuildEstimateView, BuildOptionsView } from "@/types";

/**
 * The Build Website dialog.
 *
 * Four steps, and none of them can be skipped: what we know, which model,
 * how hard to try, and a final confirmation that repeats the choice back with
 * a cost estimate. Clicking "Build website" on the previous screen opens this;
 * it does not start anything. Nothing spends money until the button on step 4.
 *
 * The stage override lives here too. Where the prospect has not reached a
 * stage at which a build is expected, the checkbox is unticked, the reason is
 * shown, and the confirm button stays disabled — but the override exists,
 * because refusing outright would be the app overruling its operator.
 */

type Options = BuildOptionsView;
type Estimate = BuildEstimateView;

type Step = 1 | 2 | 3 | 4;

const STEP_LABEL: Record<Step, string> = {
  1: "Context",
  2: "Model",
  3: "Quality",
  4: "Confirm",
};

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 border-b border-line overflow-x-auto">
      {([1, 2, 3, 4] as Step[]).map((n) => (
        <li key={n} className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "tabular size-[18px] rounded-full grid place-items-center text-[10px] font-semibold transition-colors",
              n < step && "bg-ok/15 text-ok",
              n === step && "bg-accent text-accent-ink",
              n > step && "bg-surface-3 text-ink-4",
            )}
          >
            {n < step ? "✓" : n}
          </span>
          <span
            className={cn(
              "text-[11.5px]",
              n === step ? "text-ink font-medium" : "text-ink-4",
            )}
          >
            {STEP_LABEL[n]}
          </span>
          {n < 4 ? <span aria-hidden className="w-4 h-px bg-line ml-1" /> : null}
        </li>
      ))}
    </ol>
  );
}

function Money({ estimate }: { estimate: Estimate }) {
  if (estimate.strategy === "scaffold") {
    return <span className="text-ok font-medium">Free — no model is called</span>;
  }
  if (!estimate.priced) {
    return (
      <span className="text-ink-3">
        not priced
        <span className="text-ink-4"> — no price is configured for this model</span>
      </span>
    );
  }
  return (
    <span className="tabular text-ink font-medium">
      ${estimate.lowUsd?.toFixed(2)} – ${estimate.highUsd?.toFixed(2)}
    </span>
  );
}

/**
 * Mounted only while open, so every run starts from clean state.
 *
 * The alternative - one long-lived component that resets its own fields in an
 * effect when `open` flips - renders once with the previous build's choices
 * still on screen, which on this particular dialog means briefly showing the
 * wrong model next to a cost estimate.
 */
function BuildWizardBody({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; remedy: string } | null>(null);

  const [provider, setProvider] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [quality, setQuality] = useState<BuildQuality>("balanced");
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState(false);

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, startEstimate] = useTransition();
  const [building, startBuild] = useTransition();
  const [buildError, setBuildError] = useState<{ message: string; remedy: string } | null>(null);

  /* Load the options on mount. Opening the dialog is always free. */
  useEffect(() => {
    let cancelled = false;
    void getBuildOptionsAction(projectId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setLoadError({ message: res.error.message, remedy: res.error.remedy });
        return;
      }
      setOptions(res.data);
      if (res.data.recommended) {
        setProvider(res.data.recommended.provider);
        setModel(res.data.recommended.model);
      } else {
        const first = res.data.providers.find((p) => p.configured) ?? res.data.providers[0];
        setProvider(first?.id ?? "anthropic");
        setModel(first?.models.find((m) => m.supported)?.id ?? "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /* Re-estimate whenever the choice changes. */
  useEffect(() => {
    if (!provider || !model) return;
    startEstimate(async () => {
      const res = await estimateBuildAction({ provider, model, quality });
      if (res.ok) setEstimate(res.data);
    });
  }, [provider, model, quality]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !building) onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [building, onClose]);

  const providerRow = options?.providers.find((p) => p.id === provider);
  const modelRow = providerRow?.models.find((m) => m.id === model);
  const needsOverride = options?.gate.requiresOverride ?? false;
  const canConfirm =
    Boolean(options?.hasBrief) && Boolean(model) && (!needsOverride || override) && !building;

  function confirm() {
    if (!options) return;
    setBuildError(null);
    startBuild(async () => {
      const res = await startBuildAction({
        projectId,
        provider,
        model,
        quality,
        overrideStage: needsOverride ? override : false,
        notes,
      });
      if (!res.ok) {
        setBuildError({ message: res.error.message, remedy: res.error.remedy });
        return;
      }
      const d = res.data;
      toast.toast({
        kind: d.fallbackReason ? "warning" : "success",
        title: `Version ${d.version} built`,
        detail: d.fallbackReason
          ? `The agent did not run: ${d.fallbackReason} The deterministic scaffold produced v${d.version} instead. Nothing was deployed.`
          : `${d.strategy === "agent" ? `${d.provider}/${d.model}` : "Deterministic scaffold"} · quality ${d.qualityScore}/100 · ${d.files} files stored. Nothing was deployed.`,
      });
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex sm:items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        disabled={building}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 anim-fade"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Build website for ${options?.businessName ?? "this prospect"}`}
        tabIndex={-1}
        className="relative w-full sm:max-w-2xl bg-surface sm:border border-line-strong sm:rounded-lg shadow-overlay flex flex-col mt-auto sm:mt-0 max-h-[92vh] sm:max-h-[85vh] anim-sheet sm:anim-pop outline-none"
      >
        <header className="px-4 sm:px-5 py-3 border-b border-line flex items-start gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-ink truncate">
              Build website{options ? ` for ${options.businessName}` : ""}
            </h2>
            <p className="text-[11.5px] text-ink-4 mt-0.5">
              Nothing runs until you confirm on the last step.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={building}
            aria-label="Close"
            className="size-7 grid place-items-center rounded-sm text-ink-3 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          >
            ×
          </button>
        </header>

        <Stepper step={step} />

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
          {loadError ? (
            <ErrorState
              title="Could not load the build options"
              message={loadError.message}
              remedy={loadError.remedy}
            />
          ) : !options ? (
            <SkeletonText lines={8} />
          ) : (
            <>
              {step === 1 ? (
                <div className="flex flex-col gap-4">
                  <DetailList
                    items={[
                      ["Business", options.businessName],
                      ["Industry", options.industry],
                                              [
                          "Current website",
                          options.currentWebsite ?? "None on record",
                        ],
                                              [
                          "Sales stage",
                          STAGE_META[options.stage as PipelineStage]?.label ?? options.stage,
                        ],
                                              [
                          "Audit score",
                          options.auditScore != null ? (
                            <ScoreBadge key="audit" score={options.auditScore} />
                          ) : (
                            "Not audited"
                          ),
                        ],
                                              [
                          "Opportunity",
                          options.opportunityScore != null ? (
                            <ScoreBadge key="opportunity" score={options.opportunityScore} />
                          ) : (
                            "Not scored"
                          ),
                        ],
                      ["This will be", `Version ${options.nextVersion}`],
                    ]}
                  />

                  {options.concept ? (
                    <div>
                      <p className="label mb-1.5">Approved concept</p>
                      <p className="text-[12.5px] text-ink-2 leading-relaxed">{options.concept}</p>
                    </div>
                  ) : (
                    <InfoNote tone="warn">
                      <strong className="font-semibold">This project has no brief.</strong> Generate
                      and review the website concept first — the build works from exactly that
                      document, and building without one produces a generic site.
                    </InfoNote>
                  )}

                  {options.weaknesses.length > 0 ? (
                    <div>
                      <p className="label mb-1.5">
                        Existing website weaknesses the build will address
                      </p>
                      <ul className="flex flex-col gap-1">
                        {options.weaknesses.map((w) => (
                          <li key={w} className="text-[12.5px] text-ink-2 flex gap-2">
                            <span className="text-accent shrink-0">·</span>
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {needsOverride ? (
                    <InfoNote tone="warn">
                      <strong className="font-semibold">
                        This prospect is not at a stage where a build is expected.
                      </strong>{" "}
                      {options.gate.reason} You can still build — you will be asked to confirm that
                      deliberately on the last step.
                    </InfoNote>
                  ) : (
                    <InfoNote tone="ok">{options.gate.reason}</InfoNote>
                  )}
                </div>
              ) : null}

              {step === 2 ? (
                <div className="flex flex-col gap-4">
                  {options.recommended ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProvider(options.recommended!.provider);
                        setModel(options.recommended!.model);
                      }}
                      className={cn(
                        "text-left border rounded-md p-3 transition-colors w-full",
                        provider === options.recommended.provider &&
                          model === options.recommended.model
                          ? "border-accent bg-accent-soft"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Badge tone="accent">Recommended</Badge>
                        <span className="text-[12.5px] font-medium text-ink">
                          {options.recommended.provider} — {options.recommended.model}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-ink-3 leading-snug">
                        {options.recommended.reason}
                      </p>
                    </button>
                  ) : (
                    <InfoNote tone="warn">
                      <strong className="font-semibold">No AI provider has a key on this server.</strong>{" "}
                      The build will fall back to the deterministic scaffold, which produces a real
                      site from the business record but writes nothing itself. Add
                      <code> ANTHROPIC_API_KEY</code> (or another provider) to enable the agent.
                    </InfoNote>
                  )}

                  <div>
                    <p className="label mb-2">Provider</p>
                    <div className="grid sm:grid-cols-3 gap-2">
                      {options.providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProvider(p.id);
                            const first = p.models.find((m) => m.supported);
                            if (first) setModel(first.id);
                          }}
                          className={cn(
                            "text-left border rounded-md px-3 py-2 transition-colors",
                            provider === p.id
                              ? "border-accent bg-accent-soft"
                              : "border-line hover:border-line-strong",
                          )}
                        >
                          <span className="block text-[12.5px] font-medium text-ink">{p.label}</span>
                          <span
                            className={cn(
                              "block text-[11px] mt-0.5",
                              p.configured ? "text-ok" : "text-ink-4",
                            )}
                          >
                            {p.configured ? "Key configured" : "No key on this server"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="label mb-2">Model</p>
                    <div className="flex flex-col gap-1.5">
                      {(providerRow?.models ?? []).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          disabled={!m.supported}
                          onClick={() => setModel(m.id)}
                          className={cn(
                            "text-left border rounded-md px-3 py-2 flex items-center gap-2.5 transition-colors",
                            model === m.id
                              ? "border-accent bg-accent-soft"
                              : "border-line hover:border-line-strong",
                            !m.supported && "opacity-45 cursor-not-allowed",
                          )}
                        >
                          <span className="text-[12.5px] font-medium text-ink flex-1 min-w-0 truncate">
                            {m.label}
                          </span>
                          <Badge
                            tone={
                              m.tier === "premium" ? "accent" : m.tier === "balanced" ? "info" : "neutral"
                            }
                          >
                            {m.tier}
                          </Badge>
                          {!m.supported ? <Badge tone="warn">no code generation</Badge> : null}
                        </button>
                      ))}
                    </div>
                  </div>

                  {providerRow && !providerRow.configured ? (
                    <InfoNote tone="warn">
                      {providerRow.label} has no API key on this server. If you build with it anyway,
                      the deterministic scaffold runs instead — and the result will say so
                      everywhere, including in its README.
                    </InfoNote>
                  ) : null}
                </div>
              ) : null}

              {step === 3 ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    {BUILD_QUALITIES.map((q) => {
                      const spec = BUILD_QUALITY[q];
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => setQuality(q)}
                          className={cn(
                            "text-left border rounded-md p-3 transition-colors",
                            quality === q
                              ? "border-accent bg-accent-soft"
                              : "border-line hover:border-line-strong",
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[12.5px] font-medium text-ink">{spec.label}</span>
                            {q === "balanced" ? <Badge tone="info">recommended</Badge> : null}
                            <span className="tabular ml-auto text-[11px] text-ink-4">
                              up to {spec.maxIterations} iteration{spec.maxIterations === 1 ? "" : "s"}
                            </span>
                          </div>
                          <p className="text-[11.5px] text-ink-3 leading-snug">{spec.summary}</p>
                          <ul className="mt-1.5 flex flex-col gap-0.5">
                            {spec.notes.map((n) => (
                              <li key={n} className="text-[11px] text-ink-4 flex gap-1.5">
                                <span aria-hidden>·</span>
                                {n}
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <label
                      htmlFor="build-notes"
                      className="label block mb-1.5"
                    >
                      Direction for this build (optional)
                    </label>
                    <Textarea
                      id="build-notes"
                      rows={3}
                      value={notes}
                      maxLength={1000}
                      placeholder="e.g. lead with the emergency appointment line; keep it to one page."
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    <p className="text-[11px] text-ink-4 mt-1">
                      Added to the build prompt. It cannot introduce facts — anything not on the
                      business record is still written as [CLIENT TO CONFIRM].
                    </p>
                  </div>
                </div>
              ) : null}

              {step === 4 ? (
                <div className="flex flex-col gap-4">
                  <DetailList
                    items={[
                      ["Prospect", options.businessName],
                                              [
                          "Strategy",
                          estimate ? STRATEGY_META[estimate.strategy].label : "—",
                        ],
                      ["Provider", providerRow?.label ?? provider],
                      ["Model", modelRow?.label ?? model],
                      ["Quality", BUILD_QUALITY[quality].label],
                                              [
                          "Planned QA iterations",
                          `${BUILD_QUALITY[quality].maxIterations} (gate at ${BUILD_QUALITY[quality].gateThreshold}/100)`,
                        ],
                                              [
                          "Storage",
                          (
                          <span key="storage" className="flex items-center gap-1.5">
                            {options.storage.label}
                            {!options.storage.durable ? (
                              <Badge tone="warn">not durable</Badge>
                            ) : (
                              <Badge tone="ok">durable</Badge>
                            )}
                          </span>
                        ),
                        ],
                      ["Version", `v${options.nextVersion}`],
                    ]}
                  />

                  <div className="border border-line rounded-md">
                    <div className="px-3 py-2 border-b border-line flex items-center gap-2">
                      <p className="label">Estimated AI usage</p>
                      {estimating ? <Spinner className="size-3" /> : null}
                      <span className="ml-auto text-[11px] text-ink-4">
                        Estimated — actual usage may vary.
                      </span>
                    </div>
                    {estimate ? (
                      <dl className="px-3 py-2.5 grid grid-cols-2 gap-y-1.5 gap-x-4 text-[12px]">
                        <dt className="text-ink-3">Model calls</dt>
                        <dd className="tabular text-ink-2 text-right">~{estimate.calls}</dd>
                        <dt className="text-ink-3">Input tokens</dt>
                        <dd className="tabular text-ink-2 text-right">
                          ~{(estimate.tokensIn / 1000).toFixed(0)}k
                        </dd>
                        <dt className="text-ink-3">Output tokens</dt>
                        <dd className="tabular text-ink-2 text-right">
                          ~{(estimate.tokensOut / 1000).toFixed(0)}k
                        </dd>
                        <dt className="text-ink-3">Estimated cost</dt>
                        <dd className="text-right">
                          <Money estimate={estimate} />
                        </dd>
                      </dl>
                    ) : (
                      <div className="px-3 py-2.5">
                        <SkeletonText lines={3} />
                      </div>
                    )}
                    {estimate ? (
                      <ul className="px-3 pb-2.5 flex flex-col gap-0.5 border-t border-line pt-2">
                        {estimate.assumptions.map((a) => (
                          <li key={a} className="text-[11px] text-ink-4 leading-snug flex gap-1.5">
                            <span aria-hidden>·</span>
                            {a}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  {needsOverride ? (
                    <div className="border border-warn/40 bg-warn/5 rounded-md p-3">
                      <Checkbox
                        checked={override}
                        onChange={(e) => setOverride(e.target.checked)}
                        label="Build anyway — no meeting is recorded for this prospect"
                      />
                      <p className="text-[11px] text-ink-3 mt-1.5 leading-snug pl-6">
                        {options.gate.reason} This is recorded against the build, so you can see
                        later which sites were speculative.
                      </p>
                    </div>
                  ) : null}

                  <InfoNote>
                    This build will <strong className="font-semibold">not</strong> create a GitHub
                    repository, push a commit, or deploy anything. It produces a downloadable
                    project you review by hand.
                  </InfoNote>

                  {buildError ? (
                    <ErrorState
                      title="Build failed"
                      message={buildError.message}
                      remedy={buildError.remedy}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="px-4 sm:px-5 py-3 border-t border-line flex items-center gap-2 shrink-0 pb-safe">
          {step > 1 ? (
            <Button onClick={() => setStep((s) => (s - 1) as Step)} disabled={building}>
              Back
            </Button>
          ) : null}
          <Button onClick={onClose} disabled={building} className={step > 1 ? "" : ""}>
            Cancel
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {step < 4 ? (
              <Button
                variant="primary"
                disabled={!options || (step === 1 && !options.hasBrief)}
                onClick={() => setStep((s) => (s + 1) as Step)}
              >
                Continue
              </Button>
            ) : (
              <Button variant="primary" disabled={!canConfirm} loading={building} onClick={confirm}>
                {building ? "Building…" : "Build website"}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

export function BuildWizard({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <BuildWizardBody projectId={projectId} onClose={onClose} />;
}

/** The trigger. Opens the dialog; never starts a build itself. */
export function BuildWebsiteButton({
  projectId,
  hasVersions,
  size = "md",
}: {
  projectId: string;
  hasVersions: boolean;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" size={size} onClick={() => setOpen(true)}>
        {hasVersions ? "Build a new version" : "Build website"}
      </Button>
      <BuildWizard projectId={projectId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
