"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { cn, relativeTime } from "@/lib/utils";
import { Badge, StatusDot } from "@/components/ui/primitives";

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
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, () => "dark" as const);

  return (
    <button
      type="button"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
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
      className="size-7 grid place-items-center rounded-sm border border-line text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
    >
      <span aria-hidden className="text-[12px] leading-none">
        {theme === "dark" ? "☀" : "☾"}
      </span>
    </button>
  );
}

function NotificationBell({
  notifications,
  onMarkRead,
}: {
  notifications: NotificationRow[];
  onMarkRead: () => void;
}) {
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="h-7 px-2 rounded-sm border border-line text-[11.5px] text-ink-2 hover:bg-surface-2 hover:text-ink transition-colors flex items-center gap-1.5"
      >
        Activity
        {unread > 0 ? (
          <span className="tabular bg-accent text-accent-ink rounded-full min-w-4 h-4 px-1 text-[10px] grid place-items-center">
            {unread > 99 ? "99+" : unread}
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
          <div
            role="dialog"
            aria-label="Notifications"
            className="absolute right-0 top-9 z-40 w-[min(22rem,calc(100vw-2rem))] max-h-96 overflow-y-auto bg-surface border border-line-strong rounded-md shadow-overlay anim-pop"
          >
            <div className="sticky top-0 bg-surface border-b border-line px-3 py-2 flex items-center gap-2">
              <p className="label">Notifications</p>
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    onMarkRead();
                    setOpen(false);
                  }}
                  className="ml-auto text-[11px] text-accent hover:underline underline-offset-2"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
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
                        <span className="mt-1.5">
                          <StatusDot
                            tone={
                              n.level === "error"
                                ? "danger"
                                : n.level === "success"
                                  ? "ok"
                                  : n.level === "warning"
                                    ? "warn"
                                    : "info"
                            }
                          />
                        </span>
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
                        <Link
                          href={n.link}
                          onClick={() => setOpen(false)}
                          className="block hover:bg-surface-3"
                        >
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
  );
}

export function Topbar({
  notifications,
  workspaceName,
  mode,
  onMarkRead,
}: {
  notifications: NotificationRow[];
  workspaceName: string;
  mode: "demo" | "live";
  onMarkRead: () => void;
}) {
  return (
    <header className="h-12 shrink-0 border-b border-line bg-surface flex items-center gap-2 sm:gap-3 px-3 sm:px-4 sticky top-0 z-30">
      {/* The mark is the only branding on mobile, where the sidebar is gone. */}
      <span
        aria-hidden
        className="lg:hidden size-5 shrink-0 rounded-sm bg-accent text-accent-ink text-[10px] font-bold grid place-items-center"
      >
        L
      </span>

      <div className="hidden sm:flex items-center gap-2 min-w-0">
        <span className="text-[12.5px] text-ink-2 truncate font-medium">{workspaceName}</span>
        {mode === "demo" ? (
          <Badge tone="warn" title="No external credentials configured. Mock providers are in use.">
            Demo
          </Badge>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("ll:open-command"))}
        aria-label="Search or jump to"
        className="ml-auto flex items-center gap-2 h-7 pl-2.5 pr-1.5 rounded-sm border border-line bg-surface-2 text-[12px] text-ink-3 hover:border-line-strong hover:text-ink-2 transition-colors min-w-0 flex-1 sm:flex-none sm:w-[17rem] max-w-[17rem]"
      >
        <span className="truncate">Search or jump to…</span>
        <kbd className="hidden sm:block ml-auto text-[10px] border border-line rounded-sm px-1 py-px bg-surface text-ink-4">
          ⌘K
        </kbd>
      </button>

      <NotificationBell notifications={notifications} onMarkRead={onMarkRead} />
      <ThemeToggle />
    </header>
  );
}
