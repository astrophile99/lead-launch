import type { ReactNode } from "react";

/**
 * The authentication screens sit outside the app shell: no sidebar, no tab bar,
 * nothing to click except the thing being asked for.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full grid lg:grid-cols-2">
      <div className="flex items-center justify-center px-5 py-12 sm:px-8">{children}</div>

      {/* A quiet statement of what the product does, not a marketing panel. */}
      <aside className="hidden lg:flex flex-col justify-center border-l border-line bg-surface px-10 py-12">
        <p className="label mb-4">What this is</p>
        <p className="text-[15px] text-ink leading-relaxed max-w-md">
          An operating system for turning local businesses into web projects: find them, audit what
          they have, score the opportunity honestly, build the replacement, and run the outreach.
        </p>
        <ol className="mt-8 flex flex-col gap-3 max-w-md">
          {[
            ["Discover", "Search a category and area. Duplicates are matched on phone, then domain."],
            ["Audit", "One real request per site, parsed into findings you can read and defend."],
            ["Score", "Seven weighted factors, each shown with the reasoning behind its number."],
            ["Build", "A brief you can edit, then a versioned site with a quality gate."],
            ["Reach out", "Grounded in what was actually observed. Nothing sends without approval."],
          ].map(([title, body], i) => (
            <li key={title} className="flex gap-3">
              <span
                aria-hidden
                className="size-5 shrink-0 rounded-full bg-surface-3 text-ink-3 text-[10px] font-semibold grid place-items-center mt-0.5"
              >
                {i + 1}
              </span>
              <span>
                <span className="block text-[12.5px] font-medium text-ink">{title}</span>
                <span className="block text-[12px] text-ink-3 leading-snug">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
