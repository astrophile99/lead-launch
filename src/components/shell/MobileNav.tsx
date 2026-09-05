"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MOBILE_MORE, MOBILE_PRIMARY, NAV } from "@/config/nav";
import { cn, formatCurrency } from "@/lib/utils";
import { NavIcon } from "./icon";
import { isActivePath, type ShellCounts, type ShellSpend } from "./Sidebar";

/**
 * Mobile navigation.
 *
 * Not a shrunken sidebar: four thumb-reachable destinations plus a More sheet
 * carrying everything else. The bar is fixed to the bottom and respects the
 * home-indicator safe area, and the app reserves space for it so nothing is
 * ever hidden behind it.
 */
export function MobileNav({
  counts,
  spend,
  workspaceName,
  mode,
  userName,
  userEmail,
}: {
  counts: ShellCounts;
  spend: ShellSpend;
  workspaceName: string;
  mode: "demo" | "live";
  userName: string | null;
  userEmail: string | null;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Lock the page behind the sheet, or iOS scrolls the body under it.
  useEffect(() => {
    if (!moreOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [moreOpen]);

  const primary = MOBILE_PRIMARY.map((href) => NAV.find((n) => n.href === href)).filter(
    (n): n is (typeof NAV)[number] => Boolean(n),
  );
  const more = MOBILE_MORE.map((href) => NAV.find((n) => n.href === href)).filter(
    (n): n is (typeof NAV)[number] => Boolean(n),
  );

  const moreActive = more.some((n) => isActivePath(pathname, n.href));

  return (
    <>
      <nav
        aria-label="Primary"
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-surface/95 backdrop-blur border-t border-line pb-safe"
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const active = isActivePath(pathname, item.href);
            const count = item.badge ? counts[item.badge] : 0;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-1 h-14 text-[10.5px] font-medium transition-colors",
                    active ? "text-accent" : "text-ink-3",
                  )}
                >
                  <span className="relative">
                    <NavIcon name={item.icon} className="size-[18px]" />
                    {count > 0 ? (
                      <span className="tabular absolute -top-1 -right-2 min-w-3.5 h-3.5 px-0.5 rounded-full bg-accent text-accent-ink text-[9px] leading-[14px] text-center">
                        {count > 99 ? "99+" : count}
                      </span>
                    ) : null}
                  </span>
                  {item.shortLabel ?? item.label}
                </Link>
              </li>
            );
          })}

          <li>
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-controls="mobile-more-sheet"
              onClick={() => setMoreOpen((v) => !v)}
              className={cn(
                "w-full flex flex-col items-center justify-center gap-1 h-14 text-[10.5px] font-medium transition-colors",
                moreOpen || moreActive ? "text-accent" : "text-ink-3",
              )}
            >
              <NavIcon name="more" className="size-[18px]" />
              More
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen ? (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/55 anim-fade"
          />
          <div
            id="mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More sections"
            className="relative anim-sheet bg-surface border-t border-line-strong rounded-t-lg max-h-[80vh] overflow-y-auto pb-safe"
          >
            <div className="sticky top-0 bg-surface border-b border-line px-4 py-3 flex items-center gap-3">
              <span
                aria-hidden
                className="size-7 rounded-full bg-surface-3 border border-line text-[11px] font-semibold text-ink-2 grid place-items-center"
              >
                {(userName ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink truncate">
                  {userName ?? workspaceName}
                </p>
                <p className="text-[11.5px] text-ink-4 truncate">
                  {userEmail ?? (mode === "demo" ? "Demo mode" : "Live mode")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                className="size-8 grid place-items-center rounded-sm text-ink-3 hover:bg-surface-2"
              >
                ×
              </button>
            </div>

            <ul className="p-2">
              {more.map((item) => {
                const active = isActivePath(pathname, item.href);
                const count = item.badge ? counts[item.badge] : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 px-2.5 h-12 rounded-md transition-colors",
                        active ? "bg-surface-3 text-ink" : "text-ink-2 active:bg-surface-2",
                      )}
                    >
                      <NavIcon
                        name={item.icon}
                        className={cn("size-4 shrink-0", active ? "text-accent" : "text-ink-4")}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate">{item.label}</span>
                        <span className="block text-[11px] text-ink-4 truncate">
                          {item.description}
                        </span>
                      </span>
                      {count > 0 ? (
                        <span className="tabular text-[11px] text-ink-3 bg-surface-2 border border-line rounded-sm px-1.5 py-0.5">
                          {count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}

              <li className="mt-1 pt-1 border-t border-line">
                <Link
                  href="/account"
                  onClick={() => setMoreOpen(false)}
                  className="flex items-center gap-3 px-2.5 h-12 rounded-md text-ink-2 active:bg-surface-2"
                >
                  <NavIcon name="settings" className="size-4 text-ink-4" />
                  <span className="text-[13px] font-medium">Account &amp; profile</span>
                </Link>
              </li>
            </ul>

            <div className="px-4 pb-4 pt-1">
              <div className="flex items-center justify-between text-[11.5px] text-ink-3 border border-line rounded-md px-3 py-2 bg-surface-2">
                <span>AI spend this month</span>
                <span className="tabular text-ink-2">
                  {spend.monthUsd == null ? "not priced" : formatCurrency(spend.monthUsd, "USD")}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
