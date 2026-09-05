"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NAV } from "@/config/nav";
import { cn } from "@/lib/utils";
import type { SearchHit } from "@/app/api/search/route";

type Command = {
  id: string;
  title: string;
  subtitle: string;
  group: string;
  href: string;
};

const STATIC_COMMANDS: Command[] = [
  ...NAV.map((n) => ({
    id: `nav:${n.href}`,
    title: n.label,
    subtitle: n.description,
    group: "Go to",
    href: n.href,
  })),
  {
    id: "act:campaign",
    title: "Start a discovery campaign",
    subtitle: "Find new businesses in a category and area",
    group: "Actions",
    href: "/discover?new=1",
  },
  {
    id: "act:audit",
    title: "Audit pending websites",
    subtitle: "Open the audit queue",
    group: "Actions",
    href: "/audit?status=pending",
  },
  {
    id: "act:approve",
    title: "Approve outreach drafts",
    subtitle: "Review messages waiting on you",
    group: "Actions",
    href: "/outreach?status=draft",
  },
  {
    id: "act:providers",
    title: "Change AI provider routing",
    subtitle: "Capability to provider and model",
    group: "Actions",
    href: "/ai",
  },
];

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  prospect: "Prospect",
  campaign: "Campaign",
  project: "Project",
  outreach: "Message",
  note: "Note",
  task: "Task",
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const openPalette = useCallback(() => {
    setQuery("");
    setHits([]);
    setCursor(0);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (v) return false;
          openPalette();
          return true;
        });
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("ll:open-command", openPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("ll:open-command", openPalette);
    };
  }, [openPalette]);

  // The query is the source of truth for whether results are shown; stale hits
  // are filtered out below rather than cleared through an extra render.
  const searching = open && query.trim().length >= 2;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    // The spinner is raised inside the debounce, not synchronously in the effect
    // body: typing should not flash "loading" between every keystroke.
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits ?? []);
      } catch {
        /* aborted or offline; the static commands still work */
      } finally {
        setLoading(false);
      }
    }, 140);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [query, searching]);

  const staticMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STATIC_COMMANDS;
    return STATIC_COMMANDS.filter(
      (c) => c.title.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q),
    );
  }, [query]);

  const rows: Command[] = useMemo(
    () => [
      ...(searching ? hits : []).map((h) => ({
        id: `${h.kind}:${h.id}`,
        title: h.title,
        subtitle: h.subtitle,
        group: KIND_LABEL[h.kind],
        href: h.href,
      })),
      ...staticMatches,
    ],
    [hits, searching, staticMatches],
  );

  // Clamped at the point of use: the list can shrink between renders, and an
  // effect correcting the cursor afterwards would render a stale highlight first.
  const activeIndex = Math.min(cursor, Math.max(0, rows.length - 1));

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  if (!open) return null;

  const grouped: { group: string; items: { cmd: Command; index: number }[] }[] = [];
  rows.forEach((cmd, index) => {
    const last = grouped.at(-1);
    if (last && last.group === cmd.group) last.items.push({ cmd, index });
    else grouped.push({ group: cmd.group, items: [{ cmd, index }] });
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 bg-ink/25 anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-xl bg-surface border border-line-strong rounded-[4px] shadow-overlay overflow-hidden anim-pop">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-line">
          <span className="text-ink-4 text-[12px]">&#9906;</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && rows[activeIndex]) {
                e.preventDefault();
                go(rows[activeIndex].href);
              }
            }}
            placeholder="Search prospects, campaigns, messages — or jump to a section"
            aria-label="Search"
            className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-4 outline-none"
          />
          {loading ? <span className="text-[11px] text-ink-4">…</span> : null}
          <kbd className="text-[10px] text-ink-4 border border-line rounded-[2px] px-1 py-0.5">esc</kbd>
        </div>

        <ul ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-[12.5px] text-ink-3">
              Nothing matched “{query}”.
            </li>
          ) : (
            grouped.map((section) => (
              <li key={`${section.group}-${section.items[0].index}`}>
                <p className="label px-3 pt-2 pb-1">{section.group}</p>
                <ul>
                  {section.items.map(({ cmd, index }) => (
                    <li key={cmd.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => go(cmd.href)}
                        className={cn(
                          "w-full text-left px-3 py-1.5 flex flex-col gap-0.5",
                          index === activeIndex ? "bg-surface-3" : "hover:bg-surface-2",
                        )}
                      >
                        <span className="text-[12.5px] text-ink truncate">{cmd.title}</span>
                        <span className="text-[11.5px] text-ink-3 truncate">{cmd.subtitle}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
