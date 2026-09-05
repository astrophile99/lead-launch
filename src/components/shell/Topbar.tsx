"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/primitives";
import { cn, relativeTime } from "@/lib/utils";

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  level: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
};

/**
 * The document element is the source of truth for the theme - an inline script
 * in <head> stamps it before first paint so there is no flash. This subscribes
 * to that external store rather than mirroring it into React state through an
 * effect, which would render one frame with the wrong label.
 */
const THEME_EVENT = "ll:theme-change";

function subscribeToTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => "light" as const);

  return (
    <button
      type="button"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          window.localStorage.setItem("ll:theme", next);
        } catch {
          /* private mode: the choice simply does not persist */
        }
        window.dispatchEvent(new Event(THEME_EVENT));
      }}
      className="h-7 px-2 rounded-[3px] border border-line text-[11.5px] text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors"
    >
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}

export function Topbar({
  notifications,
  breadcrumb,
}: {
  notifications: NotificationRow[];
  breadcrumb: string;
}) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <header className="h-12 shrink-0 border-b border-line bg-surface flex items-center gap-3 px-4 sticky top-0 z-20">
      <p className="text-[12.5px] text-ink-3 truncate hidden sm:block">{breadcrumb}</p>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("ll:open-command"))}
        className="ml-auto flex items-center gap-2 h-7 pl-2.5 pr-1.5 rounded-[3px] border border-line bg-surface-2 text-[12px] text-ink-3 hover:border-line-strong hover:text-ink-2 transition-colors min-w-[9rem] sm:min-w-[15rem]"
      >
        <span className="truncate">Search or jump to…</span>
        <kbd className="ml-auto text-[10px] border border-line rounded-[2px] px-1 py-px bg-surface text-ink-4">
          ⌘K
        </kbd>
      </button>

      <div className="relative">
        <button
          type="button"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="h-7 px-2 rounded-[3px] border border-line text-[11.5px] text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors flex items-center gap-1.5"
        >
          Activity
          {unread > 0 ? (
            <span className="tabular bg-accent text-accent-ink rounded-full min-w-4 h-4 px-1 text-[10px] grid place-items-center">
              {unread}
            </span>
          ) : null}
        </button>

        {open ? (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-9 z-40 w-80 max-h-96 overflow-y-auto bg-surface border border-line-strong rounded-[4px] shadow-overlay anim-pop">
              <p className="label px-3 py-2 border-b border-line sticky top-0 bg-surface">
                Notifications
              </p>
              {notifications.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12px] text-ink-3">
                  Nothing yet. Meaningful events only — builds, failures, replies.
                </p>
              ) : (
                <ul>
                  {notifications.map((n) => {
                    const body = (
                      <div
                        className={cn(
                          "px-3 py-2 border-b border-line last:border-0",
                          !n.readAt && "bg-surface-2",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            aria-hidden
                            className={cn(
                              "mt-1 size-1.5 rounded-full shrink-0",
                              n.level === "error"
                                ? "bg-danger"
                                : n.level === "success"
                                  ? "bg-ok"
                                  : n.level === "warning"
                                    ? "bg-warn"
                                    : "bg-info",
                            )}
                          />
                          <div className="min-w-0">
                            <p className="text-[12px] text-ink leading-snug">{n.title}</p>
                            {n.body ? (
                              <p className="text-[11.5px] text-ink-3 leading-snug mt-0.5">{n.body}</p>
                            ) : null}
                            <p className="text-[11px] text-ink-4 mt-1">{relativeTime(n.createdAt)}</p>
                          </div>
                        </div>
                      </div>
                    );
                    return (
                      <li key={n.id}>
                        {n.link ? (
                          <Link href={n.link} onClick={() => setOpen(false)} className="block hover:bg-surface-3">
                            {body}
                          </Link>
                        ) : (
                          body
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>

      <ThemeToggle />
    </header>
  );
}

export function ModeBadge({ mode }: { mode: "demo" | "live" }) {
  return mode === "demo" ? (
    <Badge tone="warn" title="No external API keys are configured. Mock providers are in use.">
      Demo mode
    </Badge>
  ) : (
    <Badge tone="ok">Live</Badge>
  );
}
