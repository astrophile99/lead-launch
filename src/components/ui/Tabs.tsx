import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Tabs driven by a query parameter rather than client state, so a tab is
 * linkable, survives a refresh, and works without JavaScript.
 */
export function QueryTabs({
  basePath,
  param = "tab",
  current,
  tabs,
}: {
  basePath: string;
  param?: string;
  current: string;
  tabs: { id: string; label: string; count?: number }[];
}) {
  return (
    <nav className="flex gap-0.5 border-b border-line overflow-x-auto" aria-label="Sections">
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <Link
            key={t.id}
            href={`${basePath}?${param}=${t.id}`}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "relative px-3 h-8 flex items-center gap-1.5 text-[12.5px] whitespace-nowrap transition-colors",
              active ? "text-ink font-medium" : "text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 ? (
              <span className="tabular text-[10.5px] text-ink-4 border border-line rounded-[2px] px-1 leading-4">
                {t.count}
              </span>
            ) : null}
            {active ? (
              <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-accent rounded-full" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
