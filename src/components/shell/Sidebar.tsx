"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV, NAV_GROUPS } from "@/config/nav";
import { cn, formatCurrency } from "@/lib/utils";
import { NavIcon } from "./icon";

export type ShellCounts = {
  drafts: number;
  tasks: number;
  unaudited: number;
  projects: number;
};

export type ShellSpend = {
  monthUsd: number | null;
  budgetUsd: number | null;
  jobsToday: number;
};

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop sidebar. The mobile equivalent is MobileNav. */
export function Sidebar({
  workspaceName,
  mode,
  counts,
  spend,
  userName,
  userEmail,
}: {
  workspaceName: string;
  mode: "demo" | "live";
  counts: ShellCounts;
  spend: ShellSpend;
  userName: string | null;
  userEmail: string | null;
}) {
  const pathname = usePathname();

  const budgetPct =
    spend.budgetUsd && spend.budgetUsd > 0 && spend.monthUsd != null
      ? Math.min(100, Math.round((spend.monthUsd / spend.budgetUsd) * 100))
      : null;

  return (
    <aside className="hidden lg:flex w-[13.5rem] shrink-0 border-r border-line bg-surface flex-col">
      <div className="h-12 flex items-center gap-2 px-3.5 border-b border-line shrink-0">
        <span
          aria-hidden
          className="size-5 rounded-sm bg-accent text-accent-ink text-[10px] font-bold grid place-items-center"
        >
          L
        </span>
        <span className="text-[13px] font-semibold tracking-[-0.015em]">
          Lead <span className="text-ink-4">&rarr;</span> Launch
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto flex flex-col gap-5 px-2.5 py-3" aria-label="Sections">
        {NAV_GROUPS.map((group) => {
          const items = NAV.filter((n) => n.group === group.id);
          if (!items.length) return null;
          return (
            <div key={group.id}>
              <p className="label px-2 mb-1.5">{group.label}</p>
              <ul className="flex flex-col gap-px">
                {items.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const count = item.badge ? counts[item.badge] : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        title={item.description}
                        className={cn(
                          "group relative flex items-center gap-2.5 h-7.5 px-2 rounded-sm text-[12.5px] transition-colors",
                          active
                            ? "bg-surface-3 text-ink font-medium"
                            : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                        )}
                      >
                        {active ? (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent"
                          />
                        ) : null}
                        <NavIcon
                          name={item.icon}
                          className={cn("size-3.5 shrink-0", active ? "text-accent" : "text-ink-4")}
                        />
                        <span className="truncate">{item.label}</span>
                        {count > 0 ? (
                          <span className="tabular ml-auto text-[10.5px] text-ink-3 bg-surface-2 border border-line rounded-sm px-1 leading-4">
                            {count}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line shrink-0">
        <Link
          href="/ai?tab=cost"
          className="block px-3.5 py-2.5 hover:bg-surface-2 transition-colors border-b border-line"
        >
          <div className="flex items-baseline gap-2">
            <span className="label">AI spend</span>
            <span className="tabular ml-auto text-[11.5px] text-ink-2">
              {spend.monthUsd == null ? "not priced" : formatCurrency(spend.monthUsd, "USD")}
            </span>
          </div>
          {budgetPct != null ? (
            <div className="mt-1.5 h-1 bg-surface-3 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  budgetPct >= 100 ? "bg-danger" : budgetPct >= 80 ? "bg-warn" : "bg-accent",
                )}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          ) : (
            <p className="mt-1 text-[10.5px] text-ink-4">
              {spend.jobsToday} job{spend.jobsToday === 1 ? "" : "s"} today
            </p>
          )}
        </Link>

        <Link
          href="/settings"
          className={cn(
            "flex items-center gap-2.5 px-3.5 py-2 text-[12.5px] transition-colors border-b border-line",
            isActivePath(pathname, "/settings")
              ? "bg-surface-3 text-ink"
              : "text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}
        >
          <NavIcon name="settings" className="size-3.5 text-ink-4" />
          Settings
        </Link>

        <Link
          href="/account"
          className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-surface-2 transition-colors"
        >
          <span
            aria-hidden
            className="size-6 rounded-full bg-surface-3 border border-line text-[10px] font-semibold text-ink-2 grid place-items-center shrink-0"
          >
            {(userName ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] text-ink truncate">{userName ?? "Not signed in"}</span>
            <span className="block text-[10.5px] text-ink-4 truncate">
              {userEmail ?? workspaceName}
            </span>
          </span>
        </Link>

        <p className="px-3.5 pb-2.5 text-[10.5px] text-ink-4">
          {mode === "demo" ? "Demo mode · mock providers" : "Live mode"}
        </p>
      </div>
    </aside>
  );
}
