import type { ReactNode } from "react";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { getSpendSummary } from "@/services/costs";
import { getSettings } from "@/services/settings";
import { AppShell } from "@/components/shell/AppShell";
import type { NotificationRow } from "@/components/shell/Topbar";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Chrome data, derived per request from real rows for the current workspace. */
async function chromeData() {
  try {
    const ctx = await getWorkspaceContext();
    const [notifications, drafts, tasks, unaudited, projects, spend, settings, user] =
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
        getSpendSummary(ctx.workspaceId),
        getSettings(ctx.workspaceId),
        ctx.userId
          ? prisma.user.findUnique({
              where: { id: ctx.userId },
              select: { name: true, email: true },
            })
          : Promise.resolve(null),
      ]);

    return {
      ok: true as const,
      ctx,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
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
    console.error("chromeData failed:", error);

    return {
      ok: false as const,
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
  // Check Supabase authentication BEFORE loading any dashboard data.
  const supabase = await createSupabaseServerClient();

const { data: claimsData, error: claimsError } =
  await supabase.auth.getClaims();

if (claimsError || !claimsData?.claims) {
  redirect("/sign-in");
}

  // Only authenticated users reach this point.
  const data = await chromeData();

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