import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the navigation-performance work.
 *
 * A note on what is deliberately *not* here. React's `cache()` only
 * deduplicates inside a request/render scope, and neither plain Node nor
 * `renderToStaticMarkup` provides one — verified both ways: three identical
 * calls ran the function three times. So there is no honest way to assert the
 * deduplication behaviourally from this harness, and a test that appeared to
 * would be worse than no test at all.
 *
 * What is asserted instead is the property that makes the memo safe and the
 * one that makes it present: that it is React's request-scoped `cache` rather
 * than a module-level map that would outlive the request and could serve one
 * workspace to another, and that it wraps the functions it should.
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

afterEach(() => vi.restoreAllMocks());

describe("request-scoped memoization", () => {
  it("memoizes the workspace context with React's request-scoped cache", () => {
    const src = read("src/db/workspace.ts");
    expect(src).toMatch(/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*"react"/);
    expect(src).toMatch(/export const getWorkspaceContext = cache\(/);
  });

  it("memoizes the Supabase server client, so one render means one JWKS fetch", () => {
    const src = read("src/lib/supabase/server.ts");
    expect(src).toMatch(/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*"react"/);
    expect(src).toMatch(/export const createSupabaseServerClient = cache\(/);
  });

  it("memoizes settings and shell spend", () => {
    expect(read("src/services/settings.ts")).toMatch(/export const getSettings = cache\(/);
    expect(read("src/services/costs.ts")).toMatch(/export const getShellSpend = cache\(/);
  });

  it("caches identity nowhere but the request", () => {
    // A module-level store would survive the request and could hand one
    // caller another caller's workspace. React's cache cannot: it is created
    // and discarded with the render.
    const src = read("src/db/workspace.ts");
    expect(src).not.toMatch(/new Map\(|new WeakMap\(|globalThis\.|unstable_cache/);
  });

  it("resolves the workspace from the auth identity and nothing the caller supplies", () => {
    const src = read("src/db/workspace.ts");
    // No parameters: there is no workspaceId, slug or header to spoof.
    expect(src).toMatch(/function getWorkspaceContext\(\)/);
    expect(src).toMatch(/authUserId/);
    expect(src).toMatch(/getClaims\(\)/);
    // Still fails closed when the token does not resolve to a user.
    expect(src).toMatch(/kind: "forbidden"/);
  });

  it("lets a settings write read back its own result", () => {
    // updateSettings must not return the memo that was populated before the
    // writes landed.
    const src = read("src/services/settings.ts");
    expect(src).toMatch(/return loadSettings\(workspaceId\);/);
    const update = src.slice(src.indexOf("export async function updateSettings"));
    expect(update).not.toMatch(/return getSettings\(/);
  });
});

describe("shell spend", () => {
  async function shellSpendWith(agg: { all: number; priced: number; sum: number | null }) {
    vi.resetModules();
    const aggregate = vi.fn().mockResolvedValue({
      _count: { _all: agg.all, costUsd: agg.priced },
      _sum: { costUsd: agg.sum },
    });
    vi.doMock("@/db/client", () => ({ prisma: { aIJob: { aggregate } } }));
    const { getShellSpend } = await import("@/services/costs");
    const result = await getShellSpend("ws_1");
    return { result, aggregate };
  }

  it("asks for two aggregates rather than loading 30 days of job rows", async () => {
    const { aggregate } = await shellSpendWith({ all: 3, priced: 3, sum: 1.5 });
    expect(aggregate).toHaveBeenCalledTimes(2);
    for (const call of aggregate.mock.calls) {
      expect(JSON.stringify(call[0])).toContain("workspaceId");
    }
  });

  it("reports an unpriced window as null, never as zero", async () => {
    // The distinction the money rule rests on: nothing measurable is not the
    // same as nothing spent.
    const { result } = await shellSpendWith({ all: 4, priced: 0, sum: null });
    expect(result.month.jobs).toBe(4);
    expect(result.month.costUsd).toBeNull();
    expect(result.today.costUsd).toBeNull();
  });

  it("rounds a priced window the way the full summary does", async () => {
    const { result } = await shellSpendWith({ all: 2, priced: 2, sum: 0.123456789 });
    expect(result.month.costUsd).toBe(0.1235);
    expect(result.month.jobs).toBe(2);
  });

  it("reports an empty window as zero jobs and no cost", async () => {
    const { result } = await shellSpendWith({ all: 0, priced: 0, sum: null });
    expect(result.month).toEqual({ jobs: 0, costUsd: null });
  });

  it("leaves the full summary to the screens that need the breakdowns", () => {
    expect(read("src/services/costs.ts")).toMatch(/export async function getSpendSummary/);
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("getShellSpend");
    expect(layout).not.toContain("getSpendSummary(");
    expect(read("src/app/(app)/ai/page.tsx")).toContain("getSpendSummary(");
    expect(read("src/app/(app)/settings/page.tsx")).toContain("getSpendSummary(");
  });
});

describe("streaming and navigation", () => {
  it("has a loading boundary for the dashboard, which is what enables prefetch", () => {
    // Every route under (app) is force-dynamic, and Next.js skips prefetching
    // a dynamic route unless it has a loading boundary. Without this file a
    // sidebar click had nothing warmed and nothing to show.
    expect(fs.existsSync(path.join(process.cwd(), "src/app/(app)/loading.tsx"))).toBe(true);
  });

  it("renders a skeleton rather than a spinner in a void", async () => {
    const Loading = (await import("@/app/(app)/loading")).default;
    const html = renderToStaticMarkup(createElement(Loading));
    expect(html).toContain("skeleton");
    expect(html).toContain('aria-busy="true"');
    // Announced to assistive tech rather than being a silent blank.
    expect(html).toContain("Loading");
    // Built from the design system's tokens rather than invented colours.
    expect(html).toMatch(/border-line|bg-surface/);
  });

  it("does not repaint the shell, which stays mounted and interactive", async () => {
    const Loading = (await import("@/app/(app)/loading")).default;
    const html = renderToStaticMarkup(createElement(Loading));
    for (const shellMarker of ["<nav", "Overview", "Discover", "Settings"]) {
      expect(html).not.toContain(shellMarker);
    }
  });

  it("keeps plain Link navigation, with prefetching left alone", () => {
    for (const rel of ["src/components/shell/Sidebar.tsx", "src/components/shell/MobileNav.tsx"]) {
      const src = read(rel);
      expect(src).toMatch(/import Link from "next\/link"/);
      // No opting out of prefetch, and no hand-rolled anchor navigation.
      expect(src).not.toMatch(/prefetch=\{false\}/);
      expect(src).not.toMatch(/<a\s+href=\{/);
    }
  });

  it("shows pending feedback through useLinkStatus, shared by both navs", () => {
    const pending = read("src/components/shell/NavPending.tsx");
    expect(pending).toMatch(/useLinkStatus/);
    expect(pending.startsWith('"use client"')).toBe(true);
    // One implementation, used by desktop and mobile alike.
    expect(read("src/components/shell/Sidebar.tsx")).toContain("NavPending");
    expect(read("src/components/shell/MobileNav.tsx")).toContain("NavPending");
  });
});

describe("query shape on the busiest route", () => {
  it("does not resolve the same fact twice in the app chrome", () => {
    const layout = read("src/app/(app)/layout.tsx");
    // The user row is already loaded by getWorkspaceContext.
    expect(layout).not.toMatch(/prisma\.user\.find/);
    // And the layout no longer verifies the token a second time itself.
    // Matches a call, not the word: the comment above it explains the removal.
    expect(layout).not.toMatch(/auth\.getClaims\(/);
    expect(layout).not.toMatch(/createSupabaseServerClient\(/);
    expect(layout).toContain("getWorkspaceContext");
  });

  it("still redirects an unauthenticated caller to sign-in", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toMatch(/redirect\("\/sign-in"\)/);
    expect(layout).toMatch(/unauthenticated/);
  });

  it("selects the columns the Overview actually renders", () => {
    const page = read("src/app/(app)/page.tsx");
    // `include: { business: true }` pulled every column, JSON blobs included.
    expect(page).not.toMatch(/include:\s*\{\s*business:\s*true\s*\}/);
    expect(page).toMatch(/select:\s*\{[\s\S]*?business:\s*\{\s*select:/);
  });

  it("issues the command centre's queries in one wave", () => {
    const src = read("src/services/command-center.ts");
    const body = src.slice(src.indexOf("export async function getCommandCenter"));
    // Two counts used to be awaited after the Promise.all, adding two serial
    // round trips to a remote database for facts nothing depended on.
    const afterAll = body.slice(body.indexOf("]);"));
    expect(afterAll).not.toMatch(/await prisma\./);
  });

  it("issues the funnel's queries in one wave", () => {
    const src = read("src/services/analytics.ts");
    const body = src.slice(src.indexOf("export async function getFunnel"));
    const end = body.indexOf("\nexport ", 10);
    const fn = end === -1 ? body : body.slice(0, end);
    expect(fn.match(/await prisma\./g) ?? []).toHaveLength(0);
    expect(fn).toMatch(/await Promise\.all\(\[/);
  });
});
