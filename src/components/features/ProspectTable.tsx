"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { auditManyAction, bulkTagAction, exportProspectsCsvAction } from "@/app/actions";
import { PIPELINE_STAGES, STAGE_META } from "@/config/pipeline";
import type { ProspectFilters, ProspectRow, ProspectSort } from "@/services/prospects";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Panel,
  ScoreBadge,
  Segmented,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { cn, formatCurrency, hostOf, relativeTime } from "@/lib/utils";

type ColumnId =
  | "business" | "location" | "rating" | "reviews" | "website" | "websiteScore"
  | "mobileScore" | "seoScore" | "performanceScore" | "opportunityScore"
  | "contactability" | "stage" | "lastContact" | "nextAction" | "value";

const COLUMNS: {
  id: ColumnId;
  label: string;
  numeric?: boolean;
  defaultOn: boolean;
  sort?: ProspectSort;
}[] = [
  { id: "business", label: "Business", defaultOn: true, sort: "name" },
  { id: "location", label: "Location", defaultOn: true },
  { id: "rating", label: "Rating", numeric: true, defaultOn: true, sort: "rating" },
  { id: "reviews", label: "Reviews", numeric: true, defaultOn: true, sort: "reviews" },
  { id: "website", label: "Website", defaultOn: true },
  { id: "websiteScore", label: "Site", numeric: true, defaultOn: true, sort: "website" },
  { id: "mobileScore", label: "Mobile", numeric: true, defaultOn: false },
  { id: "seoScore", label: "SEO", numeric: true, defaultOn: false },
  { id: "performanceScore", label: "Perf", numeric: true, defaultOn: false },
  {
    id: "opportunityScore",
    label: "Opportunity",
    numeric: true,
    defaultOn: true,
    sort: "opportunity",
  },
  { id: "contactability", label: "Reach", numeric: true, defaultOn: true },
  { id: "stage", label: "Stage", defaultOn: true },
  { id: "value", label: "Value", numeric: true, defaultOn: false, sort: "value" },
  { id: "lastContact", label: "Last contact", defaultOn: true },
  { id: "nextAction", label: "Next action", defaultOn: true },
];

export type ViewMode = "table" | "cards" | "board";

/**
 * The prospect workspace.
 *
 * Filtering, sorting and paging live in the URL and are executed by the
 * database, so the browser only ever holds one page. Selection is client state
 * and is cleared whenever the filter changes — a hidden row must never
 * silently receive a bulk action.
 */
export function ProspectTable({
  rows,
  total,
  page,
  pageCount,
  filters,
  sort,
  view,
  tags,
  campaigns,
  savedViews,
}: {
  rows: ProspectRow[];
  total: number;
  page: number;
  pageCount: number;
  filters: ProspectFilters;
  sort: ProspectSort;
  view: ViewMode;
  tags: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  savedViews: { id: string; name: string; config: Partial<ProspectFilters> }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [visible, setVisible] = useState<Set<ColumnId>>(
    () => new Set(COLUMNS.filter((c) => c.defaultOn).map((c) => c.id)),
  );
  const [showColumns, setShowColumns] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(filters.q);

  /** Filters live in the URL so a view is linkable and survives a refresh. */
  const push = useMemo(
    () =>
      (patch: Record<string, string | number | undefined>, opts: { resetPage?: boolean } = {}) => {
        const next = new URLSearchParams(params.toString());
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === "" || v === "all") next.delete(k);
          else next.set(k, String(v));
        }
        if (opts.resetPage !== false) next.delete("page");
        setSelected(new Set());
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      },
    [params, pathname, router],
  );

  const show = (id: ColumnId) => visible.has(id);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const activeFilterCount = Object.entries(filters).filter(
    ([k, v]) => v !== "all" && !(k === "q" && v === ""),
  ).length;

  function runBulk(fn: () => Promise<void>) {
    start(async () => {
      await fn();
      router.refresh();
    });
  }

  return (
    <>
      {/* ------------------------------------------------------------ filters */}
      <Panel className="mb-3">
        <div className="p-3 flex flex-wrap items-center gap-2">
          <form
            className="flex-1 min-w-52"
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: search });
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => search !== filters.q && push({ q: search })}
              placeholder="Filter by name, category, area or tag"
              aria-label="Filter prospects"
            />
          </form>

          <Select
            aria-label="Website filter"
            className="w-auto"
            value={filters.website}
            onChange={(e) => push({ website: e.target.value })}
          >
            <option value="all">Any website</option>
            <option value="has">Has website</option>
            <option value="none">No website</option>
            <option value="poor">Poor site (&lt;55)</option>
            <option value="good">Good site (≥70)</option>
          </Select>

          <Select
            aria-label="Opportunity filter"
            className="w-auto"
            value={filters.score}
            onChange={(e) => push({ score: e.target.value })}
          >
            <option value="all">Any score</option>
            <option value="high">High (≥70)</option>
            <option value="medium">Medium (45–69)</option>
            <option value="weak">Low (&lt;45)</option>
          </Select>

          <Select
            aria-label="Stage filter"
            className="w-auto"
            value={filters.stage}
            onChange={(e) => push({ stage: e.target.value })}
          >
            <option value="all">Any stage</option>
            {PIPELINE_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_META[s].label}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Contact filter"
            className="w-auto"
            value={filters.contact}
            onChange={(e) => push({ contact: e.target.value })}
          >
            <option value="all">Any contact</option>
            <option value="email">Email available</option>
            <option value="phone">Phone available</option>
            <option value="instagram">Instagram available</option>
          </Select>

          <Select
            aria-label="Discovered filter"
            className="w-auto"
            value={filters.recency}
            onChange={(e) => push({ recency: e.target.value })}
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
              onChange={(e) => push({ tag: e.target.value })}
            >
              <option value="all">Any tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : null}

          {campaigns.length ? (
            <Select
              aria-label="Campaign filter"
              className="w-auto max-w-44"
              value={filters.campaign}
              onChange={(e) => push({ campaign: e.target.value })}
            >
              <option value="all">Any campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : null}

          {activeFilterCount > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch("");
                router.push(pathname, { scroll: false });
              }}
            >
              Clear {activeFilterCount}
            </Button>
          ) : null}
        </div>

        {savedViews.length ? (
          <div className="px-3 pb-3 flex flex-wrap items-center gap-1.5">
            <span className="label mr-1">Saved views</span>
            {savedViews.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => push({ ...EMPTY_QUERY, ...v.config } as Record<string, string>)}
                className="h-6 px-2 text-[11.5px] rounded-sm border border-line text-ink-3 hover:border-line-strong hover:text-ink transition-colors"
              >
                {v.name}
              </button>
            ))}
          </div>
        ) : null}
      </Panel>

      {/* ------------------------------------------------------------ toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="text-[12px] text-ink-3">
          <span className="tabular text-ink font-medium">{total}</span> prospects
          {selected.size > 0 ? ` · ${selected.size} selected` : ""}
        </p>

        <Segmented
          ariaLabel="View mode"
          size="sm"
          value={view}
          onChange={(v) => push({ view: v }, { resetPage: false })}
          options={[
            { value: "table" as const, label: "Table" },
            { value: "cards" as const, label: "Cards" },
            { value: "board" as const, label: "Board" },
          ]}
        />

        <Select
          aria-label="Sort by"
          className="w-auto h-7 text-[12px]"
          value={sort}
          onChange={(e) => push({ sort: e.target.value }, { resetPage: false })}
        >
          <option value="opportunity">Opportunity ↓</option>
          <option value="website">Weakest site ↑</option>
          <option value="rating">Rating ↓</option>
          <option value="reviews">Reviews ↓</option>
          <option value="value">Value ↓</option>
          <option value="recent">Newest</option>
          <option value="name">Name A–Z</option>
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {view === "table" ? (
            <div className="relative">
              <Button size="sm" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns}>
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
                  <div className="absolute right-0 top-8 z-40 w-52 bg-surface border border-line-strong rounded-md shadow-overlay p-2 anim-pop">
                    {COLUMNS.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-1.5 py-1 text-[12px] text-ink-2 hover:bg-surface-2 rounded-sm cursor-pointer"
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
          ) : null}

          <Button
            size="sm"
            disabled={selected.size === 0 || pending}
            loading={pending && selected.size > 0}
            onClick={() =>
              runBulk(async () => {
                const res = await auditManyAction([...selected]);
                if (res.ok) {
                  toast.success(
                    `Audited ${res.data.completed}`,
                    res.data.failed ? `${res.data.failed} failed.` : undefined,
                  );
                } else {
                  toast.error("Bulk audit failed", res.error.message);
                }
              })
            }
          >
            Audit selected
          </Button>

          {tags.length ? (
            <Select
              aria-label="Tag selected prospects"
              className="w-auto h-7 text-[12px]"
              value=""
              disabled={selected.size === 0 || pending}
              onChange={(e) => {
                const tagId = e.target.value;
                if (!tagId) return;
                e.currentTarget.value = "";
                runBulk(async () => {
                  const res = await bulkTagAction([...selected], tagId);
                  if (res.ok) toast.success(`Tagged ${res.data.tagged} prospects`);
                  else toast.error("Could not tag", res.error.message);
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
                  toast.error("Export failed", res.error.message);
                  return;
                }
                const blob = new Blob([res.data.csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("CSV downloaded", "Every prospect, not just this page.");
              })
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* --------------------------------------------------------------- body */}
      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            title={activeFilterCount ? "Nothing matches these filters" : "No prospects yet"}
            body={
              activeFilterCount
                ? "Loosen a filter, or run a discovery campaign to add more businesses."
                : "Launch your first campaign to start finding businesses worth building for."
            }
            action={
              activeFilterCount ? (
                <Button size="sm" onClick={() => router.push(pathname)}>
                  Clear filters
                </Button>
              ) : (
                <Link
                  href="/discover"
                  className="inline-flex items-center h-8 px-3 rounded-sm bg-accent text-accent-ink text-[12.5px] font-medium"
                >
                  Start discovery
                </Link>
              )
            }
          />
        </Panel>
      ) : view === "cards" ? (
        <ProspectCards rows={rows} selected={selected} onToggle={setSelected} />
      ) : view === "board" ? (
        <ProspectBoard rows={rows} />
      ) : (
        <Panel>
          <Table>
            <thead>
              <tr>
                <Th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    className="accent-[var(--accent)] align-middle"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                  />
                </Th>
                {COLUMNS.filter((c) => show(c.id)).map((c) => (
                  <Th key={c.id} className={c.numeric ? "text-right" : undefined}>
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => push({ sort: c.sort }, { resetPage: false })}
                        className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                      >
                        {c.label}
                        {sort === c.sort ? (
                          <span aria-hidden className="text-[9px] text-accent">
                            ▼
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      c.label
                    )}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                      <Link
                        href={`/prospects/${r.id}`}
                        className="text-ink font-medium hover:text-accent block truncate"
                      >
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
                  {show("rating") ? <Td className="tabular text-right">{r.rating ?? "—"}</Td> : null}
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
                    <Td className="text-right">
                      <ScoreBadge score={r.websiteScore} />
                    </Td>
                  ) : null}
                  {show("mobileScore") ? (
                    <Td className="text-right">
                      <ScoreBadge score={r.mobileScore} />
                    </Td>
                  ) : null}
                  {show("seoScore") ? (
                    <Td className="text-right">
                      <ScoreBadge score={r.seoScore} />
                    </Td>
                  ) : null}
                  {show("performanceScore") ? (
                    <Td className="text-right">
                      <ScoreBadge score={r.performanceScore} />
                    </Td>
                  ) : null}
                  {show("opportunityScore") ? (
                    <Td className="text-right">
                      <ScoreBadge score={r.opportunityScore} />
                    </Td>
                  ) : null}
                  {show("contactability") ? (
                    <Td className="text-right">
                      <ScoreBadge score={r.contactability} />
                    </Td>
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
        </Panel>
      )}

      {/* ----------------------------------------------------------- paging */}
      {pageCount > 1 ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            disabled={page <= 1}
            onClick={() => push({ page: page - 1 }, { resetPage: false })}
          >
            Previous
          </Button>
          <span className="tabular text-[12px] text-ink-3">
            Page {page} of {pageCount}
          </span>
          <Button
            size="sm"
            disabled={page >= pageCount}
            onClick={() => push({ page: page + 1 }, { resetPage: false })}
          >
            Next
          </Button>
        </div>
      ) : null}
    </>
  );
}

const EMPTY_QUERY: Record<string, string> = {
  q: "",
  website: "all",
  score: "all",
  stage: "all",
  contact: "all",
  recency: "all",
  tag: "all",
  campaign: "all",
};

/** Card view — the readable shape on a phone, where a 15-column table is not. */
function ProspectCards({
  rows,
  selected,
  onToggle,
}: {
  rows: ProspectRow[];
  selected: Set<string>;
  onToggle: (fn: (s: Set<string>) => Set<string>) => void;
}) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <div
          key={r.id}
          className={cn(
            "bg-surface border rounded-md p-3 shadow-panel transition-colors",
            selected.has(r.id) ? "border-accent" : "border-line hover:border-line-strong",
          )}
        >
          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              aria-label={`Select ${r.name}`}
              className="mt-1 accent-[var(--accent)] shrink-0"
              checked={selected.has(r.id)}
              onChange={(e) =>
                onToggle((s) => {
                  const next = new Set(s);
                  if (e.target.checked) next.add(r.id);
                  else next.delete(r.id);
                  return next;
                })
              }
            />
            <div className="min-w-0 flex-1">
              <Link
                href={`/prospects/${r.id}`}
                className="text-[13px] font-semibold text-ink hover:text-accent block truncate"
              >
                {r.name}
              </Link>
              <p className="text-[11.5px] text-ink-3 truncate">
                {r.category} · {r.area ?? r.city}
                {r.rating != null ? ` · ${r.rating}★ (${r.reviewCount ?? 0})` : ""}
              </p>
            </div>
            <ScoreBadge score={r.opportunityScore} />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {r.website ? (
              <ScoreBadge score={r.websiteScore} label="site" />
            ) : (
              <Badge tone="danger">No site</Badge>
            )}
            <Badge tone="neutral">{STAGE_META[r.stage]?.label ?? r.stage}</Badge>
            {r.hasEmail ? <Badge tone="neutral">email</Badge> : null}
            {r.hasPhone ? <Badge tone="neutral">phone</Badge> : null}
            <span className="tabular ml-auto text-[11.5px] text-ink-3">
              {formatCurrency(r.estimatedValue)}
            </span>
          </div>

          {r.nextAction ? (
            <p className="mt-2 text-[11.5px] text-ink-2 leading-snug border-t border-line pt-2">
              {r.nextAction}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** A read-only board grouped by stage; drag-and-drop lives on /pipeline. */
function ProspectBoard({ rows }: { rows: ProspectRow[] }) {
  const stages = PIPELINE_STAGES.filter((s) => rows.some((r) => r.stage === s));

  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {stages.map((stage) => {
        const items = rows.filter((r) => r.stage === stage);
        return (
          <section
            key={stage}
            className="w-60 shrink-0 bg-surface-2 border border-line rounded-md flex flex-col"
          >
            <header className="px-2.5 py-2 border-b border-line">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[12px] font-semibold text-ink">{STAGE_META[stage].label}</h3>
                <span className="tabular text-[11px] text-ink-3">{items.length}</span>
              </div>
            </header>
            <ul className="p-1.5 flex flex-col gap-1.5">
              {items.map((r) => (
                <li key={r.id} className="bg-surface border border-line rounded-sm p-2">
                  <Link
                    href={`/prospects/${r.id}`}
                    className="text-[12px] font-medium text-ink hover:text-accent block truncate"
                  >
                    {r.name}
                  </Link>
                  <p className="text-[10.5px] text-ink-4 truncate">{r.area ?? r.city}</p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <ScoreBadge score={r.opportunityScore} />
                    <span className="tabular ml-auto text-[10.5px] text-ink-3">
                      {formatCurrency(r.estimatedValue)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
