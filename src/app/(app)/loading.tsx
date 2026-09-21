import { Panel, Skeleton } from "@/components/ui/primitives";

/**
 * The content-area skeleton shown while a dashboard route renders.
 *
 * This file does more than look busy. Every route under `(app)` is
 * `force-dynamic`, and Next.js skips prefetching a dynamic route entirely
 * unless it has a loading boundary — so without this file a sidebar click had
 * nothing warmed and nothing to show, and the app simply sat there until the
 * server finished. With it, the route is partially prefetched, the transition
 * starts immediately, and this renders while the page streams in behind it.
 *
 * It deliberately does not redraw the sidebar or topbar. Those live in the
 * layout, stay mounted across the transition, and stay interactive — a
 * skeleton that repainted them would make a working shell look like it had
 * been torn down and rebuilt.
 *
 * The geometry is the shared one: a page header, a row of stat tiles, and a
 * wide panel beside a narrow one. Matching the real layout is what stops the
 * hand-off from jumping; matching it only approximately would be worse than a
 * blank space. Shimmer, colours and radii all come from `.skeleton` in
 * globals.css, which already drops to a flat fill under
 * `prefers-reduced-motion`.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      {/* Screen readers get the status; the shapes are decorative. */}
      <span className="sr-only">Loading…</span>

      {/* PageHeader: title block, and the actions that usually sit opposite. */}
      <div
        aria-hidden
        className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-4 mb-5 border-b border-line"
      >
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <Skeleton className="h-5 w-52 sm:w-64" />
          <Skeleton className="mt-2 h-3 w-full max-w-md" />
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>

      {/* Stat tiles. Four across on desktop, two on a phone, as everywhere. */}
      <div aria-hidden className="grid gap-2.5 grid-cols-2 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Panel key={i} className="px-3 py-2.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-2.5 h-5 w-20" />
          </Panel>
        ))}
      </div>

      <div aria-hidden className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-5 min-w-0">
          <Panel>
            <div className="px-4 py-3 border-b border-line">
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="flex flex-col">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-0">
                  <Skeleton className="size-6 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="mt-1.5 h-2.5 w-2/3" />
                  </div>
                  <Skeleton className="h-4 w-10 shrink-0" />
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <Panel>
            <div className="px-4 py-3 border-b border-line">
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="flex flex-col">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="px-4 py-3 border-b border-line last:border-0">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="mt-1.5 h-2.5 w-1/3" />
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <div className="px-4 py-3 border-b border-line">
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
