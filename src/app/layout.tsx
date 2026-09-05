import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { getSpendSummary } from "@/services/costs";
import { getSettings } from "@/services/settings";
import { AppShell } from "@/components/shell/AppShell";
import type { NotificationRow } from "@/components/shell/Topbar";
import { ToastProvider } from "@/components/ui/Toast";

const sans = Inter({ variable: "--font-app-sans", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Lead → Launch",
    template: "%s · Lead → Launch",
  },
  description:
    "Prospecting, website auditing, website generation and outreach for a web studio.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
  ],
};

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
          ? prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true, email: true } })
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
  } catch {
    return { ok: false as const };
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const data = await chromeData();

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Applied before paint so the theme never flashes. Dark is the default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ll:theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`,
          }}
        />
      </head>
      <body className="h-full">
        <ToastProvider>
          {data.ok ? (
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
          ) : (
            <div className="h-full grid place-items-center px-6">
              <div className="max-w-md text-center">
                <h1 className="text-[18px] font-semibold mb-2">Database not initialised</h1>
                <p className="text-[13px] text-ink-2 leading-relaxed">
                  No workspace was found. Run the migration and seed once, then reload:
                </p>
                <pre className="mt-3 text-left text-[12px] bg-surface-2 border border-line rounded-md p-3 overflow-x-auto">
                  npm run db:migrate{"\n"}npm run db:seed
                </pre>
              </div>
            </div>
          )}
        </ToastProvider>
      </body>
    </html>
  );
}
