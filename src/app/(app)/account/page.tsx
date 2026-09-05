import Link from "next/link";
import { appConfig, capabilities } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { formatDateTime } from "@/lib/utils";
import {
  Badge,
  DetailList,
  InfoNote,
  LinkButton,
  Panel,
  PanelHeader,
  PageHeader,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await getWorkspaceContext();

  const [user, workspace, memberCount] = await Promise.all([
    ctx.userId
      ? prisma.user.findUnique({ where: { id: ctx.userId } })
      : Promise.resolve(null),
    prisma.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    prisma.user.count({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  return (
    <>
      <PageHeader
        title="Account"
        description="Who you are signed in as, and which workspace you are working in."
        meta={
          capabilities.hasAuth ? (
            <Badge tone="ok" dot>
              Supabase Auth configured
            </Badge>
          ) : (
            <Badge tone="warn">Single-tenant — no authentication configured</Badge>
          )
        }
        actions={<LinkButton href="/settings?tab=workspace">Workspace settings</LinkButton>}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Profile" />
          <div className="px-4 py-3">
            <div className="flex items-center gap-3 mb-4">
              <span
                aria-hidden
                className="size-11 rounded-full bg-surface-3 border border-line text-[16px] font-semibold text-ink-2 grid place-items-center"
              >
                {(user?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink truncate">
                  {user?.name ?? "No user record"}
                </p>
                <p className="text-[12px] text-ink-3 truncate">{user?.email ?? "—"}</p>
              </div>
            </div>

            <DetailList
              labelWidth="w-36"
              items={[
                ["Role", <Badge key="role" tone="neutral">{ctx.role}</Badge>],
                ["Workspace", workspace?.name ?? ctx.workspaceName],
                ["Member since", user ? formatDateTime(user.createdAt) : "—"],
                [
                  "Email verified",
                  user?.emailVerifiedAt ? formatDateTime(user.emailVerifiedAt) : "Not verified",
                ],
                ["Auth provider id", user?.authUserId ?? "Not linked to an auth provider"],
              ]}
            />
          </div>
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader title="Workspace" />
            <div className="px-4 py-3">
              <DetailList
                labelWidth="w-36"
                items={[
                  ["Name", workspace?.name ?? ctx.workspaceName],
                  ["Slug", workspace?.slug ?? appConfig.defaultWorkspaceSlug],
                  ["Currency", workspace?.currency ?? "INR"],
                  ["Timezone", workspace?.timezone ?? "Asia/Kolkata"],
                  ["Members", memberCount],
                  ["Created", workspace ? formatDateTime(workspace.createdAt) : "—"],
                ]}
              />
            </div>
          </Panel>

          {capabilities.hasAuth ? (
            <Panel>
              <PanelHeader title="Session" />
              <div className="px-4 py-3 flex flex-col gap-2">
                <p className="text-[12.5px] text-ink-3 leading-relaxed">
                  Sign-out is handled by the auth provider once the session integration is wired up.
                </p>
                <Link
                  href="/sign-in"
                  className="text-[12.5px] text-accent hover:underline underline-offset-2"
                >
                  Go to sign in →
                </Link>
              </div>
            </Panel>
          ) : (
            <InfoNote tone="warn">
              <strong className="font-semibold">No authentication is configured.</strong> Every
              resource already hangs off a workspace and every query goes through{" "}
              <code>getWorkspaceContext()</code>, so switching this on is a session lookup in one
              function rather than a rewrite. Until then, anyone who can reach this server has owner
              access — do not expose it publicly.
            </InfoNote>
          )}

          <InfoNote>
            <strong className="font-semibold">Inviting people.</strong> The data model supports
            several users per workspace with owner, member and viewer roles, and{" "}
            <code>assertCanWrite</code> already refuses writes from a viewer. Invitations need an
            auth provider to send them, so that screen arrives with Supabase.
          </InfoNote>
        </div>
      </div>
    </>
  );
}
