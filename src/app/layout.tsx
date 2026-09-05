import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar, type NotificationRow } from "@/components/shell/Topbar";

const sans = Inter({ variable: "--font-app-sans", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lead → Launch",
  description:
    "Prospecting, website auditing, website generation and outreach for a web studio.",
};

// Chrome data is derived per request from real rows.
async function chromeData() {
  try {
    const ctx = await getWorkspaceContext();
    const [notifications, draftCount, openTasks, pendingAudits, readyProjects] = await Promise.all([
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
        where: { workspaceId: ctx.workspaceId, status: { in: ["brief", "ready", "building"] } },
      }),
    ]);
    return {
      ok: true as const,
      ctx,
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
      counts: {
        "/outreach": draftCount,
        "/pipeline": openTasks,
        "/audit": pendingAudits,
        "/studio": readyProjects,
      } as Record<string, number>,
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
        {/* Applied before paint so the theme never flashes. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('ll:theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
      </head>
      <body className="h-full">
        {data.ok ? (
          <div className="flex h-full">
            <Sidebar
              workspaceName={data.ctx.workspaceName}
              mode={appConfig.mode}
              openCounts={data.counts}
            />
            <div className="flex-1 flex flex-col min-w-0">
              <Topbar notifications={data.notifications} breadcrumb={data.ctx.workspaceName} />
              <main className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[104rem] px-4 sm:px-6 py-5 pb-20 lg:pb-8">
                  {children}
                </div>
              </main>
            </div>
            <CommandPalette />
          </div>
        ) : (
          <div className="h-full grid place-items-center px-6">
            <div className="max-w-md text-center">
              <h1 className="text-[18px] font-semibold mb-2">Database not initialised</h1>
              <p className="text-[13px] text-ink-2 leading-relaxed">
                No workspace was found. Run the migration and seed once, then reload:
              </p>
              <pre className="mt-3 text-left text-[12px] bg-surface-2 border border-line rounded-[3px] p-3 overflow-x-auto">
                npm run db:migrate{"\n"}npm run db:seed
              </pre>
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
