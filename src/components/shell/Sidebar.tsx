"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV, NAV_GROUPS } from "@/config/nav";
import { cn } from "@/lib/utils";
import { NavIcon } from "./icon";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  workspaceName,
  mode,
  openCounts,
}: {
  workspaceName: string;
  mode: "demo" | "live";
  openCounts: Record<string, number>;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-5 px-2.5 py-3" aria-label="Sections">
      {NAV_GROUPS.map((group) => {
        const items = NAV.filter((n) => n.group === group.id);
        if (!items.length) return null;
        return (
          <div key={group.id}>
            <p className="label px-2 mb-1.5">{group.label}</p>
            <ul className="flex flex-col gap-px">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                const count = openCounts[item.href] ?? 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // Closing on navigation belongs to the click, not to an
                      // effect watching the pathname.
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      title={item.description}
                      className={cn(
                        "group flex items-center gap-2.5 h-7.5 px-2 rounded-[3px] text-[12.5px] transition-colors",
                        active
                          ? "bg-surface-3 text-ink font-medium"
                          : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                      )}
                    >
                      <NavIcon
                        name={item.icon}
                        className={cn("size-3.5 shrink-0", active ? "text-accent" : "text-ink-4")}
                      />
                      <span className="truncate">{item.label}</span>
                      {count > 0 ? (
                        <span className="tabular ml-auto text-[10.5px] text-ink-3 bg-surface-2 border border-line rounded-[2px] px-1 leading-4">
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
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-expanded={mobileOpen}
        aria-controls="app-sidebar"
        // Bottom-right: the bottom-left corner is where the framework's dev
        // indicator sits, and it is the easier thumb reach in any case.
        className="lg:hidden fixed bottom-4 right-4 z-40 h-10 px-4 rounded-full bg-ink text-paper text-[12px] font-medium shadow-overlay"
      >
        {mobileOpen ? "Close" : "Menu"}
      </button>

      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-30 bg-ink/25 anim-fade"
        />
      ) : null}

      <aside
        id="app-sidebar"
        className={cn(
          "w-56 shrink-0 border-r border-line bg-surface flex flex-col",
          "fixed inset-y-0 left-0 z-30 transition-transform duration-200 lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="h-12 flex items-center gap-2 px-3.5 border-b border-line shrink-0">
          <span
            aria-hidden
            className="size-5 rounded-[3px] bg-accent text-accent-ink text-[10px] font-bold grid place-items-center"
          >
            L
          </span>
          <span className="text-[13px] font-semibold tracking-[-0.015em]">
            Lead <span className="text-ink-4">&rarr;</span> Launch
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">{nav}</div>

        <div className="px-3.5 py-2.5 border-t border-line text-[11.5px] shrink-0">
          <p className="text-ink-2 font-medium truncate">{workspaceName}</p>
          <p className="text-ink-4 mt-0.5">
            {mode === "demo" ? "Demo mode · mock providers" : "Live mode"}
          </p>
        </div>
      </aside>
    </>
  );
}
