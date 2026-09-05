"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { launchCampaignAction } from "@/app/actions";
import { INDUSTRY_OPTIONS } from "@/config/industries";
import {
  Button,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Panel,
  PanelHeader,
  Select,
} from "@/components/ui/primitives";

const CITIES = ["Mumbai", "Pune", "Bengaluru", "Delhi", "Hyderabad", "Chennai"];

export function CampaignForm({
  providerLabel,
  isMock,
}: {
  providerLabel: string;
  isMock: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [result, setResult] = useState<{ discovered: number; duplicates: number; audited: number } | null>(null);

  const [form, setForm] = useState({
    category: "Dental",
    country: "India",
    city: "Mumbai",
    area: "",
    targetCount: 25,
    minRating: "",
    minReviews: "",
    websiteFilter: "any" as "any" | "none" | "poor" | "good",
    keywords: "",
    autoAudit: true,
    name: "",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
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
        return;
      }
      setResult({
        discovered: res.data.discovered,
        duplicates: res.data.duplicates,
        audited: res.data.audited,
      });
      router.refresh();
    });
  }

  return (
    <Panel>
      <PanelHeader
        title="Launch a campaign"
        hint={`Discovery runs through ${providerLabel}${isMock ? " — results are demo data and are labelled as such." : "."}`}
      />
      <form onSubmit={submit} className="p-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Category" htmlFor="c-category">
            <Select
              id="c-category"
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

          <Field label="City" htmlFor="c-city">
            <Input
              id="c-city"
              list="city-options"
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              required
            />
            <datalist id="city-options">
              {CITIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>

          <Field label="Area" htmlFor="c-area" hint="Optional. Narrows the search.">
            <Input
              id="c-area"
              value={form.area}
              onChange={(e) => set("area", e.target.value)}
              placeholder="Bandra"
            />
          </Field>

          <Field label="Prospects" htmlFor="c-count" hint="1 to 200 per run.">
            <Input
              id="c-count"
              type="number"
              min={1}
              max={200}
              value={form.targetCount}
              onChange={(e) => set("targetCount", Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Minimum rating" htmlFor="c-rating">
            <Input
              id="c-rating"
              type="number"
              step="0.1"
              min={0}
              max={5}
              placeholder="Any"
              value={form.minRating}
              onChange={(e) => set("minRating", e.target.value)}
            />
          </Field>

          <Field label="Minimum reviews" htmlFor="c-reviews">
            <Input
              id="c-reviews"
              type="number"
              min={0}
              placeholder="Any"
              value={form.minReviews}
              onChange={(e) => set("minReviews", e.target.value)}
            />
          </Field>

          <Field label="Website" htmlFor="c-website">
            <Select
              id="c-website"
              value={form.websiteFilter}
              onChange={(e) => set("websiteFilter", e.target.value as typeof form.websiteFilter)}
            >
              <option value="any">Any</option>
              <option value="none">No website</option>
              <option value="poor">Poor website</option>
              <option value="good">Good website</option>
            </Select>
          </Field>

          <Field label="Keywords" htmlFor="c-keywords" hint="Optional free text.">
            <Input
              id="c-keywords"
              value={form.keywords}
              onChange={(e) => set("keywords", e.target.value)}
              placeholder="implants"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
          <Field label="Campaign name" htmlFor="c-name" hint="Leave blank to name it from the query.">
            <Input
              id="c-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Mumbai Dentists — September 2026"
            />
          </Field>

          <label className="flex items-center gap-2 h-8 text-[12.5px] text-ink-2 select-none">
            <input
              type="checkbox"
              checked={form.autoAudit}
              onChange={(e) => set("autoAudit", e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Audit each result immediately
          </label>
        </div>

        {error ? (
          <ErrorState title="The campaign could not run" message={error.message} remedy={error.remedy} />
        ) : null}

        {result ? (
          <InfoNote tone="ok">
            Discovered <strong>{result.discovered}</strong> new{" "}
            {result.discovered === 1 ? "business" : "businesses"}
            {result.duplicates ? `, skipped ${result.duplicates} already on file` : ""}
            {form.autoAudit ? `, audited ${result.audited}` : ""}.
          </InfoNote>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Running…" : "Launch campaign"}
          </Button>
          <p className="text-[11.5px] text-ink-3">
            {pending
              ? "Discovering, de-duplicating and auditing. This blocks until the run finishes."
              : "Duplicates are detected by phone number, then domain, then name and city."}
          </p>
        </div>
      </form>
    </Panel>
  );
}
