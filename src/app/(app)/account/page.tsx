import Link from "next/link";
import { redirect } from "next/navigation";

import { appConfig, capabilities } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

async function signOut() {
  "use server";

  const supabase = await createSupabaseServerClient();

  await supabase.auth.signOut();

  redirect("/sign-in");
}

export default async function AccountPage() {
  const ctx = await getWorkspaceContext();

  const [user, workspace, memberCount] = await Promise.all([
    ctx.userId
      ? prisma.user.findUnique({
          where: { id: ctx.userId },
        })
      : Promise.resolve(null),

    prisma.workspace.findUnique({
      where: { id: ctx.workspaceId },
    }),

    prisma.user.count({
      where: { workspaceId: ctx.workspaceId },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Account"
        description="Who you are signed in as, and which workspace you are working in."
        meta={
          capabilities.hasAuth ? (
            <Badge tone="ok" dot>
              Supabase Auth connected
            </Badge>
          ) : (
            <Badge tone="warn">
              Authentication not configured
            </Badge>
          )
        }
        actions={
          <LinkButton href="/settings?tab=workspace">
            Workspace settings
          </LinkButton>
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Profile" />

          <div className="px-4 py-3">
            <div className="mb-4 flex items-center gap-3">
              <span
                aria-hidden
                className="grid size-11 place-items-center rounded-full border border-line bg-surface-3 text-[16px] font-semibold text-ink-2"
              >
                {(user?.name ?? "?").slice(0, 1).toUpperCase()}
              </span>

              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">
                  {user?.name ?? "No user record"}
                </p>

                <p className="truncate text-[12px] text-ink-3">
                  {user?.email ?? "—"}
                </p>
              </div>
            </div>

            <DetailList
              labelWidth="w-36"
              items={[
                [
                  "Role",
                  <Badge key="role" tone="neutral">
                    {ctx.role}
                  </Badge>,
                ],
                [
                  "Workspace",
                  workspace?.name ?? ctx.workspaceName,
                ],
                [
                  "Member since",
                  user ? formatDateTime(user.createdAt) : "—",
                ],
                [
                  "Email verified",
                  user?.emailVerifiedAt
                    ? formatDateTime(user.emailVerifiedAt)
                    : "Not verified",
                ],
                [
                  "Auth provider id",
                  user?.authUserId ??
                    "Not linked to an auth provider",
                ],
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
                  [
                    "Name",
                    workspace?.name ?? ctx.workspaceName,
                  ],
                  [
                    "Slug",
                    workspace?.slug ??
                      appConfig.defaultWorkspaceSlug,
                  ],
                  [
                    "Currency",
                    workspace?.currency ?? "INR",
                  ],
                  [
                    "Timezone",
                    workspace?.timezone ?? "Asia/Kolkata",
                  ],
                  ["Members", memberCount],
                  [
                    "Created",
                    workspace
                      ? formatDateTime(workspace.createdAt)
                      : "—",
                  ],
                ]}
              />
            </div>
          </Panel>

          {capabilities.hasAuth ? (
            <Panel>
              <PanelHeader title="Session" />

              <div className="px-4 py-3 flex flex-col gap-3">
                <div>
                  <p className="text-[12.5px] font-medium text-ink">
                    You are signed in.
                  </p>

                  <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
                    Signing out will end the current Supabase
                    session on this device.
                  </p>
                </div>

                <form action={signOut}>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center justify-center rounded-md border border-line bg-surface-1 px-3 text-[12.5px] font-medium text-ink transition-colors hover:bg-surface-2 hover:text-danger focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </Panel>
          ) : (
            <InfoNote tone="warn">
              <strong className="font-semibold">
                No authentication is configured.
              </strong>{" "}
              Authentication must be configured before this
              workspace should be exposed publicly.
            </InfoNote>
          )}

          <InfoNote>
            <strong className="font-semibold">
              Workspace access.
            </strong>{" "}
            Your account is linked to this workspace through your
            authenticated identity. Workspace membership and role
            determine what you are allowed to do.
          </InfoNote>
        </div>
      </div>
    </>
  );
}