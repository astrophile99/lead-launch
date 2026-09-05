"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { estimateCampaignCostAction, launchCampaignAction } from "@/app/actions";
import { INDUSTRY_OPTIONS } from "@/config/industries";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Button,
  Checkbox,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Panel,
  Progress,
  Select,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const CITIES = ["Mumbai", "Pune", "Bengaluru", "Delhi", "Hyderabad", "Chennai"];

const STEPS = [
  { id: "target", label: "Target" },
  { id: "filters", label: "Filters" },
  { id: "source", label: "Source" },
  { id: "ai", label: "AI strategy" },
  { id: "review", label: "Review" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

export type ProviderChoice = { id: string; label: string; isMock: boolean; configured: boolean };

type Form = {
  category: string;
  country: string;
  city: string;
  area: string;
  targetCount: number;
  minRating: string;
  minReviews: string;
  websiteFilter: "any" | "none" | "poor" | "good";
  contactFilter: "any" | "email" | "phone";
  keywords: string;
  name: string;
  autoAudit: boolean;
  autoAnalyse: boolean;
};

const INITIAL: Form = {
  category: "Dental",
  country: "India",
  city: "Mumbai",
  area: "",
  targetCount: 25,
  minRating: "",
  minReviews: "",
  websiteFilter: "any",
  contactFilter: "any",
  keywords: "",
  name: "",
  autoAudit: true,
  autoAnalyse: false,
};

type Estimate = {
  lowUsd: number | null;
  highUsd: number | null;
  calls: number;
  assumptions: string[];
  priced: boolean;
};

/**
 * Campaign creation as a short, reviewable sequence rather than one dense form.
 * The point of the last step is the estimate: discovery and analysis cost money
 * and time, and the user should see the shape of that before committing.
 */
export function CampaignWizard({
  providers,
  analysisRoute,
}: {
  providers: ProviderChoice[];
  analysisRoute: { provider: string; model: string; isMock: boolean };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [step, setStep] = useState<StepId>("target");
  const [form, setForm] = useState<Form>(INITIAL);
  const [providerId, setProviderId] = useState(
    providers.find((p) => !p.isMock && p.configured)?.id ?? providers[0]?.id ?? "mock",
  );
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [result, setResult] = useState<{
    discovered: number;
    duplicates: number;
    audited: number;
    campaignId: string;
  } | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const index = STEPS.findIndex((s) => s.id === step);
  const provider = providers.find((p) => p.id === providerId);

  function goto(next: StepId) {
    setError(null);
    setStep(next);
    if (next === "review") loadEstimate();
  }

  function loadEstimate() {
    start(async () => {
      const res = await estimateCampaignCostAction({
        prospectCount: form.targetCount,
        autoAudit: form.autoAudit,
        autoAnalyse: form.autoAnalyse,
      });
      if (res.ok) setEstimate(res.data);
    });
  }

  function launch() {
    setError(null);
    setResult(null);
    start(async () => {
      const res = await launchCampaignAction({
        ...form,
        area: form.area || null,
        keywords: form.keywords || null,
        minRating: form.minRating === "" ? null : Number(form.minRating),
        minReviews: form.minReviews === "" ? null : Number(form.minReviews),
      });

      if (!res.ok) {
        setError({ message: res.error.message, remedy: res.error.remedy });
        toast.error("The campaign could not run", res.error.message);
        return;
      }

      setResult(res.data);
      toast.success(
        `Discovered ${res.data.discovered} ${res.data.discovered === 1 ? "business" : "businesses"}`,
        res.data.duplicates
          ? `${res.data.duplicates} were already on file.`
          : form.autoAudit
            ? `${res.data.audited} audited.`
            : undefined,
      );
      router.refresh();
    });
  }

  return (
    <Panel>
      {/* ---------------------------------------------------------- stepper */}
      <ol className="flex items-center gap-1 px-3 sm:px-4 py-3 border-b border-line overflow-x-auto">
        {STEPS.map((s, i) => {
          const state = i === index ? "current" : i < index ? "done" : "todo";
          return (
            <li key={s.id} className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => (i <= index ? goto(s.id) : undefined)}
                disabled={i > index}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 h-7 px-2 rounded-sm text-[12px] transition-colors",
                  state === "current"
                    ? "bg-accent-soft text-accent font-medium"
                    : state === "done"
                      ? "text-ink-2 hover:bg-surface-2"
                      : "text-ink-4 cursor-default",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-4 rounded-full grid place-items-center text-[9.5px] font-semibold",
                    state === "current"
                      ? "bg-accent text-accent-ink"
                      : state === "done"
                        ? "bg-ok-soft text-ok border border-ok-line"
                        : "bg-surface-3 text-ink-4",
                  )}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 ? (
                <span aria-hidden className="text-ink-4 text-[11px]">
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="p-4">
        {/* ------------------------------------------------------- 1 target */}
        {step === "target" ? (
          <div className="grid gap-4">
            <p className="text-[12.5px] text-ink-3 max-w-xl">
              Who are you looking for, and where? The category drives the industry profile used for
              scoring, the website brief and the outreach angle.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Industry" htmlFor="w-category" required>
                <Select
                  id="w-category"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o.id} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Country" htmlFor="w-country" required>
                <Input
                  id="w-country"
                  value={form.country}
                  onChange={(e) => set("country", e.target.value)}
                />
              </Field>

              <Field label="City" htmlFor="w-city" required>
                <Input
                  id="w-city"
                  list="wizard-cities"
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                />
                <datalist id="wizard-cities">
                  {CITIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>

              <Field label="Area" htmlFor="w-area" hint="Optional. Narrows the search radius.">
                <Input
                  id="w-area"
                  value={form.area}
                  onChange={(e) => set("area", e.target.value)}
                  placeholder="Bandra"
                />
              </Field>
            </div>

            <Field
              label="How many prospects"
              htmlFor="w-count"
              hint="1 to 200 per run. Duplicates already on file do not count toward this."
              className="max-w-xs"
            >
              <Input
                id="w-count"
                type="number"
                min={1}
                max={200}
                value={form.targetCount}
                onChange={(e) => set("targetCount", Number(e.target.value) || 1)}
              />
            </Field>
          </div>
        ) : null}

        {/* ------------------------------------------------------ 2 filters */}
        {step === "filters" ? (
          <div className="grid gap-4">
            <p className="text-[12.5px] text-ink-3 max-w-xl">
              Filters are applied by the provider where it supports them, and locally otherwise.
              Tighter filters mean fewer, better prospects — not a longer wait.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Minimum rating" htmlFor="w-rating" hint="Leave blank for any.">
                <Input
                  id="w-rating"
                  type="number"
                  step="0.1"
                  min={0}
                  max={5}
                  placeholder="Any"
                  value={form.minRating}
                  onChange={(e) => set("minRating", e.target.value)}
                />
              </Field>

              <Field label="Minimum reviews" htmlFor="w-reviews" hint="Proxy for established demand.">
                <Input
                  id="w-reviews"
                  type="number"
                  min={0}
                  placeholder="Any"
                  value={form.minReviews}
                  onChange={(e) => set("minReviews", e.target.value)}
                />
              </Field>

              <Field label="Website status" htmlFor="w-website">
                <Select
                  id="w-website"
                  value={form.websiteFilter}
                  onChange={(e) => set("websiteFilter", e.target.value as Form["websiteFilter"])}
                >
                  <option value="any">Any</option>
                  <option value="none">No website</option>
                  <option value="poor">Poor website</option>
                  <option value="good">Good website</option>
                </Select>
              </Field>

              <Field
                label="Contact available"
                htmlFor="w-contact"
                hint="Applied after discovery, from what the provider returned."
              >
                <Select
                  id="w-contact"
                  value={form.contactFilter}
                  onChange={(e) => set("contactFilter", e.target.value as Form["contactFilter"])}
                >
                  <option value="any">Any</option>
                  <option value="phone">Phone available</option>
                  <option value="email">Email available</option>
                </Select>
              </Field>
            </div>

            <Field
              label="Keywords"
              htmlFor="w-keywords"
              hint="Optional. Matched against the name, sub-category and services."
              className="max-w-md"
            >
              <Input
                id="w-keywords"
                value={form.keywords}
                onChange={(e) => set("keywords", e.target.value)}
                placeholder="implants, orthodontics"
              />
            </Field>

            {form.contactFilter !== "any" ? (
              <InfoNote>
                Google Places does not return email addresses. Filtering on email will only match
                businesses whose address was found during enrichment, so expect fewer results.
              </InfoNote>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------------- 3 source */}
        {step === "source" ? (
          <div className="grid gap-3">
            <p className="text-[12.5px] text-ink-3 max-w-xl">
              Where the businesses come from. A mock provider generates deterministic demo records
              and labels them everywhere they appear.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProviderId(p.id)}
                  disabled={!p.configured}
                  className={cn(
                    "text-left border rounded-md p-3 transition-colors",
                    providerId === p.id
                      ? "border-accent bg-accent-soft"
                      : "border-line hover:border-line-strong",
                    !p.configured && "opacity-55 cursor-not-allowed",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium text-ink">{p.label}</span>
                    {p.isMock ? (
                      <Badge tone="warn">demo</Badge>
                    ) : p.configured ? (
                      <Badge tone="ok">ready</Badge>
                    ) : (
                      <Badge tone="neutral">no key</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-[11.5px] text-ink-3 leading-snug">
                    {p.isMock
                      ? "Deterministic demo businesses. No external service is called."
                      : p.configured
                        ? "Real businesses from the live API."
                        : "Add the API key in Settings → Integrations to enable this."}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* ----------------------------------------------------------- 4 AI */}
        {step === "ai" ? (
          <div className="grid gap-4">
            <p className="text-[12.5px] text-ink-3 max-w-xl">
              What should run automatically once the businesses are found. Auditing is free — it is
              an HTTP request and local parsing. Opportunity analysis calls a model per prospect.
            </p>

            <div className="grid gap-2.5 max-w-xl">
              <div className="border border-line rounded-md p-3">
                <Checkbox
                  label="Audit each website as it is discovered"
                  hint="One real HTTP request per site. No AI tokens, no cost."
                  checked={form.autoAudit}
                  onChange={(e) => set("autoAudit", e.target.checked)}
                />
              </div>

              <div className="border border-line rounded-md p-3">
                <Checkbox
                  label="Generate the sales angle for every prospect"
                  hint={`One model call each via ${analysisRoute.provider}/${analysisRoute.model}.${
                    analysisRoute.isMock
                      ? " No provider is configured, so this is composed from stored data at no cost."
                      : ""
                  }`}
                  checked={form.autoAnalyse}
                  onChange={(e) => set("autoAnalyse", e.target.checked)}
                />
              </div>
            </div>

            <Field
              label="Campaign name"
              htmlFor="w-name"
              hint="Leave blank to name it from the query."
              className="max-w-md"
            >
              <Input
                id="w-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={`${form.category} — ${form.city}, ${new Date().toLocaleString("en", { month: "long", year: "numeric" })}`}
              />
            </Field>
          </div>
        ) : null}

        {/* ------------------------------------------------------- 5 review */}
        {step === "review" ? (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="border border-line rounded-md p-3">
                <p className="label mb-1.5">Target</p>
                <p className="text-[12.5px] text-ink">
                  {form.targetCount} × {form.category}
                </p>
                <p className="text-[11.5px] text-ink-3 mt-0.5">
                  {[form.area, form.city, form.country].filter(Boolean).join(", ")}
                </p>
              </div>

              <div className="border border-line rounded-md p-3">
                <p className="label mb-1.5">Filters</p>
                <p className="text-[12.5px] text-ink">
                  {[
                    form.minRating ? `≥${form.minRating}★` : null,
                    form.minReviews ? `≥${form.minReviews} reviews` : null,
                    form.websiteFilter !== "any" ? `${form.websiteFilter} site` : null,
                    form.contactFilter !== "any" ? `${form.contactFilter} available` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "None"}
                </p>
                {form.keywords ? (
                  <p className="text-[11.5px] text-ink-3 mt-0.5">“{form.keywords}”</p>
                ) : null}
              </div>

              <div className="border border-line rounded-md p-3">
                <p className="label mb-1.5">Operations</p>
                <p className="text-[12.5px] text-ink">
                  {provider?.label ?? providerId}
                  {provider?.isMock ? " (demo)" : ""}
                </p>
                <p className="text-[11.5px] text-ink-3 mt-0.5">
                  {form.autoAudit ? "Audit on arrival" : "No auto-audit"} ·{" "}
                  {form.autoAnalyse ? "Sales angle per prospect" : "No auto-analysis"}
                </p>
              </div>
            </div>

            <div className="border border-line rounded-md p-3">
              <div className="flex items-baseline gap-2 mb-2">
                <p className="label">Estimated cost</p>
                {pending && !estimate ? (
                  <span className="text-[11.5px] text-ink-4">calculating…</span>
                ) : null}
              </div>

              {estimate ? (
                <>
                  <p className="tabular text-[20px] font-semibold text-ink leading-none">
                    {estimate.priced && estimate.lowUsd != null
                      ? `$${estimate.lowUsd.toFixed(2)} – $${estimate.highUsd?.toFixed(2)}`
                      : estimate.calls === 0
                        ? "$0.00"
                        : "Not priced"}
                  </p>
                  <p className="text-[11.5px] text-ink-3 mt-1">
                    {estimate.calls} model call{estimate.calls === 1 ? "" : "s"}.{" "}
                    {estimate.priced
                      ? "An estimate, not a quote — real usage depends on page size and how much the model writes."
                      : estimate.calls > 0
                        ? "No price is configured for the selected model, so this cannot be costed. Add prices in src/config/ai.ts."
                        : ""}
                  </p>
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {estimate.assumptions.map((a) => (
                      <li key={a} className="text-[11.5px] text-ink-4">
                        · {a}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-[12px] text-ink-3">Working out what this run will cost…</p>
              )}
            </div>

            {error ? (
              <ErrorState
                title="The campaign could not run"
                message={error.message}
                remedy={error.remedy}
              />
            ) : null}

            {result ? (
              <InfoNote tone="ok">
                Discovered <strong>{result.discovered}</strong> new{" "}
                {result.discovered === 1 ? "business" : "businesses"}
                {result.duplicates ? `, skipped ${result.duplicates} already on file` : ""}
                {form.autoAudit ? `, audited ${result.audited}` : ""}.{" "}
                <a
                  href={`/discover/${result.campaignId}`}
                  className="text-accent underline underline-offset-2"
                >
                  Open the campaign
                </a>
                .
              </InfoNote>
            ) : null}

            {pending && !result ? (
              <div className="border border-line rounded-md p-3">
                <Progress
                  done={0}
                  total={null}
                  label="Discovering, de-duplicating and auditing…"
                  tone="accent"
                />
                <p className="mt-1.5 text-[11.5px] text-ink-3">
                  This runs synchronously; the counts below are written as the work completes.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---------------------------------------------------------- footer */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line bg-surface-2">
        <Button
          size="md"
          disabled={index === 0 || pending}
          onClick={() => goto(STEPS[Math.max(0, index - 1)].id)}
        >
          Back
        </Button>

        {step !== "review" ? (
          <Button
            variant="primary"
            onClick={() => goto(STEPS[index + 1].id)}
            disabled={pending || (step === "target" && (!form.category || !form.city))}
          >
            Continue
          </Button>
        ) : (
          <Button variant="primary" loading={pending} onClick={launch}>
            {pending ? "Running…" : "Launch campaign"}
          </Button>
        )}

        <p className="text-[11.5px] text-ink-3 ml-auto hidden sm:block">
          {step === "review"
            ? "Duplicates are detected by phone, then domain, then name and city."
            : `Step ${index + 1} of ${STEPS.length}`}
        </p>
      </div>
    </Panel>
  );
}
