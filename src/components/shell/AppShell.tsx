"use client";

import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { markNotificationsReadAction } from "@/app/actions";
import { CommandPalette } from "./CommandPalette";
import { MobileNav } from "./MobileNav";
import { Sidebar, type ShellCounts, type ShellSpend } from "./Sidebar";
import { Topbar, type NotificationRow } from "./Topbar";

/**
 * Assembles the chrome. Everything it renders is driven by data the server
 * resolved for the current workspace; this component owns only interaction.
 */
export function AppShell({
  workspaceName,
  mode,
  counts,
  spend,
  notifications,
  userName,
  userEmail,
  children,
}: {
  workspaceName: string;
  mode: "demo" | "live";
  counts: ShellCounts;
  spend: ShellSpend;
  notifications: NotificationRow[];
  userName: string | null;
  userEmail: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, start] = useTransition();

  return (
    <div className="flex h-full">
      <Sidebar
        workspaceName={workspaceName}
        mode={mode}
        counts={counts}
        spend={spend}
        userName={userName}
        userEmail={userEmail}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          notifications={notifications}
          workspaceName={workspaceName}
          mode={mode}
          onMarkRead={() =>
            start(async () => {
              await markNotificationsReadAction();
              router.refresh();
            })
          }
        />

        <main className="flex-1 overflow-y-auto">
          {/* The bottom padding clears the mobile tab bar. */}
          <div className="mx-auto w-full max-w-[104rem] px-3 sm:px-5 lg:px-6 py-4 sm:py-5 pb-24 lg:pb-8">
            {children}
          </div>
        </main>
      </div>

      <MobileNav
        counts={counts}
        spend={spend}
        workspaceName={workspaceName}
        mode={mode}
        userName={userName}
        userEmail={userEmail}
      />
      <CommandPalette />
    </div>
  );
}
