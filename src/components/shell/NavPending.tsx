"use client";

import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A pending marker for a navigation link, shared by the sidebar and the
 * mobile bar so both behave identically.
 *
 * Must be rendered *inside* the `<Link>` it describes — `useLinkStatus` reads
 * the transition state of the nearest enclosing link, which is what lets a
 * plain `<Link>` stay a plain `<Link>`. No click handlers, no router state, no
 * interception: prefetching and client-side transitions keep working exactly
 * as Next.js intends.
 *
 * This is a supplement to `loading.tsx`, not a replacement for it. The loading
 * boundary is what makes the destination appear instantly; this covers the gap
 * before it, when a slow network means even the prefetched fallback has not
 * arrived yet and the only honest thing to report is "your click registered".
 */
export function NavPending({
  className,
  children,
}: {
  className?: string;
  /**
   * Rendered in place of the spinner while the link is idle. Pass the item's
   * icon to swap it for the spinner (the mobile bar, where the row is a fixed
   * grid); omit it to have the spinner simply appear (the sidebar, where
   * there is a badge slot to occupy).
   */
  children?: ReactNode;
}) {
  const { pending } = useLinkStatus();
  if (!pending) return <>{children ?? null}</>;

  return (
    <span
      aria-hidden
      className={cn(
        "anim-spin inline-block size-3 shrink-0 rounded-full border-[1.5px] border-accent border-t-transparent",
        className,
      )}
    />
  );
}
