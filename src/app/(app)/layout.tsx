import type { ReactNode } from "react";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { getShellSpend } from "@/services/costs";
import { getSettings } from "@/services/settings";
import { AppShell } from "@/components/shell/AppShell";
import type { NotificationRow } from "@/components/shell/Topbar";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";

/**
 * Chrome data, derived per request from real rows for the current workspace.
 *
 * Everything here runs on *every* navigation, so it is kept to the smallest
 * set of facts the sidebar and topbar actually render. Two things used to make
 * it much more expensive than it looks: it called `getSpendSummary`, which
 * loads 30 days of AI job rows to build per-provider and per-task breakdowns
 * the chrome never shows, and it queried the user's name and email even though
 * `getWorkspaceContext` had just loaded that same row.
 */
async function chromeData() {
  try {
    const ctx = await getWorkspaceContext();
    const [notifications, drafts, tasks, unaudited, projects, spend, settings] =
      await Promise.all([
        prisma.notification.findMany({
          where: { workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 15,
        }),
        prisma.outreachMessage.count({
          where: { prospect: { workspaceId: ctx.workspaceId }, status: "draft" },
        }),
        prisma.task.count({ where: { workspaceId: ctx.workspaceId, status: "open" } }),
        prisma.prospect.count({ where: { workspaceId: ctx.workspaceId, websiteScore: null } }),
        prisma.websiteProject.count({
          where: { workspaceId: ctx.workspaceId, status: { in: ["brief", "building", "ready"] } },
        }),
        getShellSpend(ctx.workspaceId),
        getSettings(ctx.workspaceId),
      ]);

    return {
      ok: true as const,
      ctx,
      // Already loaded by getWorkspaceContext; re-querying it was a round trip
      // for two columns we were holding.
      userName: ctx.userName,
      userEmail: ctx.userEmail,
      notifications: notifications.map(
        (n): NotificationRow => ({
          id: n.id,
          title: n.title,
          body: n.body,
          level: n.level,
          link: n.link,
          createdAt: n.createdAt.toISOString(),
          readAt: n.readAt?.toISOString() ?? null,
        }),
      ),
      counts: { drafts, tasks, unaudited, projects },
      spend: {
        monthUsd: spend.month.costUsd,
        budgetUsd: settings.monthlyBudgetUsd,
        jobsToday: spend.today.jobs,
      },
    };
  } catch (error) {
    // An unauthenticated caller is not a broken dashboard - it is a redirect.
    // Distinguished here so the layout does not render a database-error panel
    // at someone whose session simply expired.
    if (error instanceof AppError && error.kind === "forbidden") {
      return { ok: false as const, unauthenticated: true as const, error: error.message };
    }

    console.error("chromeData failed:", error);

    return {
      ok: false as const,
      unauthenticated: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Unknown database error",
    };
  }
}

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Authentication happens inside getWorkspaceContext, which verifies the
  // caller's Supabase claims before it will return a workspace at all - so the
  // separate getClaims() that used to sit here was checking the same token a
  // second time, on a second client, with a second JWKS fetch.
  //
  // Unauthenticated callers still never reach the dashboard: the context
  // throws `forbidden`, and that is turned back into the sign-in redirect
  // below. Failing closed is the default, because the only way past this line
  // is a context that was successfully resolved.
  const data = await chromeData();

  if (!data.ok && data.unauthenticated) {
    redirect("/sign-in");
  }

  if (!data.ok) {
    return (
      <div className="h-full grid place-items-center px-6">
        <div className="max-w-lg text-center">
          <h1 className="text-[18px] font-semibold mb-2">
            Dashboard data failed to load
          </h1>

          <p className="text-[13px] text-ink-2 leading-relaxed mb-4">
            The application could not load its workspace data. The actual error
            is shown below.
          </p>

          <pre className="text-left text-[12px] bg-surface-2 border border-line rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
            {data.error}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      workspaceName={data.ctx.workspaceName}
      mode={appConfig.mode}
      counts={data.counts}
      spend={data.spend}
      notifications={data.notifications}
      userName={data.userName}
      userEmail={data.userEmail}
    >
      {children}
    </AppShell>
  );
}