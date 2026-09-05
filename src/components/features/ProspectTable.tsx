"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  auditManyAction,
  bulkTagAction,
  exportProspectsCsvAction,
} from "@/app/actions";
import { STAGE_META, type PipelineStage } from "@/config/pipeline";
import { cn, formatCurrency, hostOf, relativeTime } from "@/lib/utils";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Panel,
  ScoreBadge,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";

export type ProspectRow = {
  id: string;
  name: string;
  category: string;
  city: string;
  area: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  websiteScore: number | null;
  mobileScore: number | null;
  seoScore: number | null;
  performanceScore: number | null;
  opportunityScore: number | null;
  contactability: number | null;
  stage: PipelineStage;
  estimatedValue: number | null;
  lastContactAt: string | null;
  nextAction: string | null;
  tags: string[];
  hasEmail: boolean;
  hasPhone: boolean;
  hasInstagram: boolean;
  isMock: boolean;
  discoveredAt: string;
};

type ColumnId =
  | "business" | "location" | "rating" | "reviews" | "website" | "websiteScore"
  | "mobileScore" | "seoScore" | "performanceScore" | "opportunityScore"
  | "contactability" | "stage" | "lastContact" | "nextAction" | "value";

const COLUMNS: { id: ColumnId; label: string; numeric?: boolean; defaultOn: boolean }[] = [
  { id: "business", label: "Business", defaultOn: true },
  { id: "location", label: "Location", defaultOn: true },
  { id: "rating", label: "Rating", numeric: true, defaultOn: true },
  { id: "reviews", label: "Reviews", numeric: true, defaultOn: true },
  { id: "website", label: "Website", defaultOn: true },
  { id: "websiteScore", label: "Site", numeric: true, defaultOn: true },
  { id: "mobileScore", label: "Mobile", numeric: true, defaultOn: false },
  { id: "seoScore", label: "SEO", numeric: true, defaultOn: false },
  { id: "performanceScore", label: "Perf", numeric: true, defaultOn: false },
  { id: "opportunityScore", label: "Opportunity", numeric: true, defaultOn: true },
  { id: "contactability", label: "Reach", numeric: true, defaultOn: true },
  { id: "stage", label: "Stage", defaultOn: true },
  { id: "value", label: "Value", numeric: true, defaultOn: false },
  { id: "lastContact", label: "Last contact", defaultOn: true },
  { id: "nextAction", label: "Next action", defaultOn: true },
];

type Filters = {
  q: string;
  website: "all" | "has" | "none" | "poor" | "good";
  score: "all" | "high" | "weak";
  stage: "all" | PipelineStage;
  contact: "all" | "email" | "phone" | "instagram";
  recency: "all" | "7d" | "30d";
  tag: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  website: "all",
  score: "all",
  stage: "all",
  contact: "all",
  recency: "all",
  tag: "all",
};

export type SavedViewRow = { id: string; name: string; config: Partial<Filters> };

export function ProspectTable({
  rows,
  tags,
  savedViews,
}: {
  rows: ProspectRow[];
  tags: { id: string; name: string }[];
  savedViews: SavedViewRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    website: (params.get("website") as Filters["website"]) ?? "all",
    score: (params.get("score") as Filters["score"]) ?? "all",
    stage: (params.get("stage") as Filters["stage"]) ?? "all",
  }));
  const [sort, setSort] = useState<{ col: ColumnId; dir: "asc" | "desc" }>({
    col: "opportunityScore",
    dir: "desc",
  });
  const [visible, setVisible] = useState<Set<ColumnId>>(
    () => new Set(COLUMNS.filter((c) => c.defaultOn).map((c) => c.id)),
  );
  const [showColumns, setShowColumns] = useState(false);
  // A single timestamp for the life of the view, so "last 7 days" does not
  // silently re-evaluate on every render.
  const [mountedAt] = useState(() => Date.now());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);

  // Changing a filter clears the selection, because a hidden row must never
  // stay selected and silently receive a bulk action. Done in the setter rather
  // than an effect so there is no extra render pass.
  const applyFilters = (next: Filters | ((f: Filters) => Filters)) => {
    setFilters(next);
    setSelected(new Set());
  };

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const now = mountedAt;
    return rows.filter((r) => {
      if (q) {
        const hay = `${r.name} ${r.category} ${r.area ?? ""} ${r.city} ${r.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.website === "has" && !r.website) return false;
      if (filters.website === "none" && r.website) return false;
      if (filters.website === "poor" && (r.websiteScore == null || r.websiteScore >= 55)) return false;
      if (filters.website === "good" && (r.websiteScore == null || r.websiteScore < 70)) return false;
      if (filters.score === "high" && (r.opportunityScore ?? 0) < 70) return false;
      if (filters.score === "weak" && (r.websiteScore == null || r.websiteScore >= 50)) return false;
      if (filters.stage !== "all" && r.stage !== filters.stage) return false;
      if (filters.contact === "email" && !r.hasEmail) return false;
      if (filters.contact === "phone" && !r.hasPhone) return false;
      if (filters.contact === "instagram" && !r.hasInstagram) return false;
      if (filters.recency !== "all") {
        const days = filters.recency === "7d" ? 7 : 30;
        if (now - new Date(r.discoveredAt).getTime() > days * 86_400_000) return false;
      }
      if (filters.tag !== "all" && !r.tags.includes(filters.tag)) return false;
      return true;
    });
  }, [rows, filters, mountedAt]);

  const sorted = useMemo(() => {
    const val = (r: ProspectRow): string | number | null => {
      switch (sort.col) {
        case "business": return r.name.toLowerCase();
        case "location": return `${r.city} ${r.area ?? ""}`.toLowerCase();
        case "rating": return r.rating;
        case "reviews": return r.reviewCount;
        case "website": return r.website ? 1 : 0;
        case "websiteScore": return r.websiteScore;
        case "mobileScore": return r.mobileScore;
        case "seoScore": return r.seoScore;
        case "performanceScore": return r.performanceScore;
        case "opportunityScore": return r.opportunityScore;
        case "contactability": return r.contactability;
        case "stage": return r.stage;
        case "value": return r.estimatedValue;
        case "lastContact": return r.lastContactAt ? new Date(r.lastContactAt).getTime() : null;
        case "nextAction": return r.nextAction?.toLowerCase() ?? null;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always last, regardless of direction
      if (bv == null) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sort]);

  const allSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));

  function toggleSort(col: ColumnId) {
    setSort((s) => (s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" }));
  }

  function runBulk(fn: () => Promise<void>) {
    setMessage(null);
    setError(null);
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  const show = (id: ColumnId) => visible.has(id);

  return (
    <>
      <Panel className="mb-3">
        <div className="p-3 flex flex-wrap items-end gap-2.5">
          <div className="flex-1 min-w-52">
            <Input
              value={filters.q}
              onChange={(e) => applyFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Filter by name, category, area or tag"
              aria-label="Filter prospects"
            />
          </div>

          <Select
            aria-label="Website filter"
            className="w-auto"
            value={filters.website}
            onChange={(e) => applyFilters((f) => ({ ...f, website: e.target.value as Filters["website"] }))}
          >
            <option value="all">Any website</option>
            <option value="has">Has website</option>
            <option value="none">No website</option>
            <option value="poor">Poor website (&lt;55)</option>
            <option value="good">Good website (≥70)</option>
          </Select>

          <Select
            aria-label="Score filter"
            className="w-auto"
            value={filters.score}
            onChange={(e) => applyFilters((f) => ({ ...f, score: e.target.value as Filters["score"] }))}
          >
            <option value="all">Any score</option>
            <option value="high">High opportunity (≥70)</option>
            <option value="weak">Weak site (&lt;50)</option>
          </Select>

          <Select
            aria-label="Stage filter"
            className="w-auto"
            value={filters.stage}
            onChange={(e) => applyFilters((f) => ({ ...f, stage: e.target.value as Filters["stage"] }))}
          >
            <option value="all">Any stage</option>
            {Object.entries(STAGE_META).map(([id, meta]) => (
              <option key={id} value={id}>
                {meta.label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Contact filter"
            className="w-auto"
            value={filters.contact}
            onChange={(e) => applyFilters((f) => ({ ...f, contact: e.target.value as Filters["contact"] }))}
          >
            <option value="all">Any contact</option>
            <option value="email">Email available</option>
            <option value="phone">Phone available</option>
            <option value="instagram">Instagram available</option>
          </Select>

          <Select
            aria-label="Recency filter"
            className="w-auto"
            value={filters.recency}
            onChange={(e) => applyFilters((f) => ({ ...f, recency: e.target.value as Filters["recency"] }))}
          >
            <option value="all">Any time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>

          {tags.length ? (
            <Select
              aria-label="Tag filter"
              className="w-auto"
              value={filters.tag}
              onChange={(e) => applyFilters((f) => ({ ...f, tag: e.target.value }))}
            >
              <option value="all">Any tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : null}

          <div className="relative">
            <Button size="md" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns}>
              Columns
            </Button>
            {showColumns ? (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setShowColumns(false)}
                />
                <div className="absolute right-0 top-9 z-40 w-52 bg-surface border border-line-strong rounded-[4px] shadow-overlay p-2 anim-pop">
                  {COLUMNS.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 px-1.5 py-1 text-[12px] text-ink-2 hover:bg-surface-2 rounded-[2px] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="accent-[var(--accent)]"
                        checked={visible.has(c.id)}
                        disabled={c.id === "business"}
                        onChange={(e) =>
                          setVisible((v) => {
                            const next = new Set(v);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            return next;
                          })
                        }
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <Button onClick={() => applyFilters(EMPTY_FILTERS)}>Reset</Button>
        </div>

        {savedViews.length ? (
          <div className="px-3 pb-3 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Saved views</span>
            {savedViews.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => applyFilters({ ...EMPTY_FILTERS, ...v.config })}
                className="h-6 px-2 text-[11.5px] rounded-[2px] border border-line text-ink-2 hover:border-line-strong hover:text-ink transition-colors"
              >
                {v.name}
              </button>
            ))}
          </div>
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-[12px] text-ink-3">
          <span className="tabular text-ink font-medium">{sorted.length}</span> of {rows.length} prospects
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={selected.size === 0 || pending}
            onClick={() =>
              runBulk(async () => {
                const res = await auditManyAction([...selected]);
                setMessage(
                  res.ok
                    ? `Audited ${res.data.completed}, ${res.data.failed} failed.`
                    : null,
                );
                if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
              })
            }
          >
            {pending ? "Working…" : `Audit selected`}
          </Button>

          {tags.length ? (
            <Select
              aria-label="Bulk tag"
              className="w-auto h-6.5 text-[12px]"
              value=""
              disabled={selected.size === 0 || pending}
              onChange={(e) => {
                const tagId = e.target.value;
                if (!tagId) return;
                e.currentTarget.value = "";
                runBulk(async () => {
                  const res = await bulkTagAction([...selected], tagId);
                  setMessage(res.ok ? `Tagged ${res.data.tagged} prospects.` : null);
                  if (!res.ok) setError({ message: res.error.message, remedy: res.error.remedy });
                });
              }}
            >
              <option value="">Tag selected…</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : null}

          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              runBulk(async () => {
                const res = await exportProspectsCsvAction();
                if (!res.ok) {
                  setError({ message: res.error.message, remedy: res.error.remedy });
                  return;
                }
                const blob = new Blob([res.data.csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                setMessage("CSV downloaded.");
              })
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      {message ? <p className="text-[12px] text-ok mb-2">{message}</p> : null}
      {error ? (
        <div className="mb-3">
          <ErrorState title="That did not work" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}

      <Panel>
        {sorted.length === 0 ? (
          <EmptyState
            title="Nothing matches these filters"
            body="Loosen a filter, or run a discovery campaign to add more businesses."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    className="accent-[var(--accent)] align-middle"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(sorted.map((r) => r.id)) : new Set())
                    }
                  />
                </Th>
                {COLUMNS.filter((c) => show(c.id)).map((c) => (
                  <Th key={c.id} className={c.numeric ? "text-right" : undefined}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.id)}
                      className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                    >
                      {c.label}
                      <span aria-hidden className="text-[9px]">
                        {sort.col === c.id ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    "hover:bg-surface-2 transition-colors",
                    selected.has(r.id) && "bg-accent-soft/40",
                  )}
                >
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.name}`}
                      className="accent-[var(--accent)] align-middle"
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                  </Td>

                  {show("business") ? (
                    <Td className="max-w-64">
                      <Link href={`/prospects/${r.id}`} className="text-ink font-medium hover:text-accent block truncate">
                        {r.name}
                      </Link>
                      <span className="text-[11px] text-ink-4 block truncate">
                        {r.category}
                        {r.tags.length ? ` · ${r.tags.join(", ")}` : ""}
                      </span>
                    </Td>
                  ) : null}

                  {show("location") ? (
                    <Td className="text-ink-3 whitespace-nowrap">{r.area ?? r.city}</Td>
                  ) : null}

                  {show("rating") ? (
                    <Td className="tabular text-right">{r.rating ?? "—"}</Td>
                  ) : null}

                  {show("reviews") ? (
                    <Td className="tabular text-right">{r.reviewCount ?? "—"}</Td>
                  ) : null}

                  {show("website") ? (
                    <Td className="max-w-44 truncate">
                      {r.website ? (
                        <a
                          href={r.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-3 hover:text-accent"
                        >
                          {hostOf(r.website)}
                        </a>
                      ) : (
                        <Badge tone="danger">None</Badge>
                      )}
                    </Td>
                  ) : null}

                  {show("websiteScore") ? (
                    <Td className="text-right"><ScoreBadge score={r.websiteScore} /></Td>
                  ) : null}
                  {show("mobileScore") ? (
                    <Td className="text-right"><ScoreBadge score={r.mobileScore} /></Td>
                  ) : null}
                  {show("seoScore") ? (
                    <Td className="text-right"><ScoreBadge score={r.seoScore} /></Td>
                  ) : null}
                  {show("performanceScore") ? (
                    <Td className="text-right"><ScoreBadge score={r.performanceScore} /></Td>
                  ) : null}
                  {show("opportunityScore") ? (
                    <Td className="text-right"><ScoreBadge score={r.opportunityScore} /></Td>
                  ) : null}
                  {show("contactability") ? (
                    <Td className="text-right"><ScoreBadge score={r.contactability} /></Td>
                  ) : null}

                  {show("stage") ? (
                    <Td className="whitespace-nowrap">
                      <Badge tone="neutral">{STAGE_META[r.stage]?.label ?? r.stage}</Badge>
                    </Td>
                  ) : null}

                  {show("value") ? (
                    <Td className="tabular text-right whitespace-nowrap">
                      {formatCurrency(r.estimatedValue)}
                    </Td>
                  ) : null}

                  {show("lastContact") ? (
                    <Td className="text-ink-3 whitespace-nowrap">
                      {r.lastContactAt ? relativeTime(r.lastContactAt) : "—"}
                    </Td>
                  ) : null}

                  {show("nextAction") ? (
                    <Td className="text-ink-3 max-w-56 truncate">{r.nextAction ?? "—"}</Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
