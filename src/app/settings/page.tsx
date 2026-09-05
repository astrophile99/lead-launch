import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { getSpendSummary } from "@/services/costs";
import { getIntegrationGroups } from "@/services/integrations";
import { listOptOuts } from "@/services/optouts";
import { getSettings } from "@/services/settings";
import { QueryTabs } from "@/components/ui/Tabs";
import { IntegrationGroupCard } from "@/components/features/IntegrationCard";
import { InstagramForm, WhatsAppForm } from "@/components/features/MetaChannelForms";
import {
  BudgetForm,
  OptOutManager,
  ScoringWeightsForm,
  TagManager,
  WorkspaceForm,
} from "@/components/features/SettingsForm";
import {
  Badge,
  DetailList,
  InfoNote,
  Panel,
  PanelHeader,
  PageHeader,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "integrations";
  const ctx = await getWorkspaceContext();

  const [workspace, settings, groups, tags, optOuts, spend, wa, ig] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    getSettings(ctx.workspaceId),
    getIntegrationGroups(ctx.workspaceId),
    prisma.tag.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { name: "asc" } }),
    listOptOuts(ctx.workspaceId),
    getSpendSummary(ctx.workspaceId),
    prisma.whatsAppAccount.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    prisma.instagramAccount.findUnique({ where: { workspaceId: ctx.workspaceId } }),
  ]);

  const connected = groups.filter((g) => g.ready).length;
  const webhookBase = appConfig.appUrl.replace(/\/$/, "");

  const tabs = [
    { id: "integrations", label: "Integrations", count: connected },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "instagram", label: "Instagram" },
    { id: "scoring", label: "Scoring" },
    { id: "budget", label: "Budget" },
    { id: "workspace", label: "Workspace" },
    { id: "outreach", label: "Opt-outs", count: optOuts.length },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Provider status is read from environment variables. Nothing here stores a credential — secrets never leave the server."
        meta={
          <>
            <Badge tone="neutral">{ctx.workspaceName}</Badge>
            <Badge tone={appConfig.mode === "demo" ? "warn" : "ok"}>
              APP_MODE={appConfig.mode}
            </Badge>
            <Badge tone="neutral">Role: {ctx.role}</Badge>
            <Badge tone={connected === groups.length ? "ok" : "neutral"}>
              {connected} of {groups.length} areas set up
            </Badge>
          </>
        }
      />

      <QueryTabs basePath="/settings" current={tab} tabs={tabs} />

      <div className="mt-5">
        {tab === "integrations" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {groups.map((g) => (
              <IntegrationGroupCard key={g.id} group={g} />
            ))}
            <div className="xl:col-span-2">
              <InfoNote>
                <strong className="font-semibold">Where credentials live.</strong> Every secret is
                read from the server environment in <code>src/config/app.ts</code> and is never sent
                to the browser, written to the database, or rendered here. Only non-secret
                identifiers — App IDs, phone number IDs — are stored, because they are configuration
                rather than credentials. A green badge means a value is present; only a passing test
                proves it works.
              </InfoNote>
            </div>
          </div>
        ) : null}

        {tab === "whatsapp" ? (
          <WhatsAppForm
            config={{
              metaAppId: wa?.metaAppId ?? "",
              businessAccountId: wa?.businessAccountId ?? "",
              phoneNumberId: wa?.phoneNumberId ?? "",
              displayPhoneNumber: wa?.displayPhoneNumber ?? "",
              apiVersion: wa?.apiVersion ?? appConfig.whatsapp.apiVersion,
              webhookVerifyToken: wa?.webhookVerifyToken ?? "",
              status: wa?.status ?? "not-configured",
              lastError: wa?.lastError ?? null,
              tokenConfigured: Boolean(appConfig.whatsapp.accessToken),
              webhookUrl: `${webhookBase}/api/webhooks/whatsapp`,
            }}
          />
        ) : null}

        {tab === "instagram" ? (
          <InstagramForm
            config={{
              metaAppId: ig?.metaAppId ?? "",
              igBusinessId: ig?.igBusinessId ?? "",
              pageId: ig?.pageId ?? "",
              username: ig?.username ?? "",
              status: ig?.status ?? "not-configured",
              lastError: ig?.lastError ?? null,
              tokenConfigured: Boolean(appConfig.instagram.accessToken),
              permissions: fromJson<string[]>(ig?.permissionsJson, []),
              webhookUrl: `${webhookBase}/api/webhooks/instagram`,
            }}
          />
        ) : null}

        {tab === "scoring" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <ScoringWeightsForm weights={settings.scoringWeights} />
            <div className="flex flex-col gap-5">
              <TagManager tags={tags} />
              <InfoNote>
                Weights change how prospects are ranked, not what was observed. Every score is
                stored with the breakdown that produced it, so an old score stays explainable even
                after the weights change.
              </InfoNote>
            </div>
          </div>
        ) : null}

        {tab === "budget" ? (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <BudgetForm
              monthlyBudgetUsd={settings.monthlyBudgetUsd}
              campaignBudgetUsd={settings.campaignBudgetUsd}
              buildBudgetUsd={settings.buildBudgetUsd}
              enforceBudget={settings.enforceBudget}
              costMode={settings.costMode}
              buildQuality={settings.buildQuality}
              spentUsd={spend.month.costUsd}
            />
            <Panel>
              <PanelHeader title="Spend this month" hint="Counted from recorded AI jobs." />
              <div className="px-4 py-3">
                <DetailList
                  labelWidth="w-40"
                  items={[
                    ["Jobs run", spend.month.jobs],
                    ["Failed", spend.month.failed],
                    ["Composed locally", `${spend.month.mockJobs} (no model called)`],
                    ["Input tokens", spend.month.tokensIn.toLocaleString()],
                    ["Output tokens", spend.month.tokensOut.toLocaleString()],
                    [
                      "Cost",
                      spend.month.costUsd == null
                        ? "not priced"
                        : `$${spend.month.costUsd.toFixed(4)}`,
                    ],
                    [
                      "Unpriced jobs",
                      spend.month.unpricedJobs > 0
                        ? `${spend.month.unpricedJobs} ran on a model with no configured price`
                        : "none",
                    ],
                  ]}
                />
              </div>
            </Panel>
          </div>
        ) : null}

        {tab === "workspace" ? (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <WorkspaceForm
              name={workspace?.name ?? ctx.workspaceName}
              currency={workspace?.currency ?? "INR"}
              timezone={workspace?.timezone ?? "Asia/Kolkata"}
              senderName={settings.senderName}
              senderRole={settings.senderRole}
              maxQaIterations={settings.maxQaIterations}
              notifyOnBuild={settings.notifyOnBuild}
              notifyOnAuditFailure={settings.notifyOnAuditFailure}
              notifyOnReply={settings.notifyOnReply}
              notifyOnFollowUpDue={settings.notifyOnFollowUpDue}
            />

            <div className="flex flex-col gap-5">
              <Panel>
                <PanelHeader title="Data" hint="Where things live." />
                <div className="px-4 py-3">
                  <DetailList
                    labelWidth="w-40"
                    items={[
                      [
                        "Database",
                        process.env.DATABASE_URL?.startsWith("postgres")
                          ? "PostgreSQL"
                          : "SQLite (dev.db)",
                      ],
                      ["Projects root", appConfig.studio.projectsRoot],
                      ["Object storage", appConfig.storage.provider],
                      ["Git remote", appConfig.repo.githubOwner ?? "not configured"],
                      ["Audit timeout", `${appConfig.audit.fetchTimeoutMs} ms`],
                      ["Outreach rate limit", `${appConfig.outreach.rateLimitPerHour} per hour`],
                    ]}
                  />
                </div>
              </Panel>

              <InfoNote>
                <strong className="font-semibold">Moving to PostgreSQL.</strong> Change{" "}
                <code>provider</code> to <code>&quot;postgresql&quot;</code> in{" "}
                <code>prisma/schema.prisma</code>, point <code>DATABASE_URL</code> at the cluster,
                install <code>@prisma/adapter-pg</code> and register it in{" "}
                <code>src/db/client.ts</code>, then run <code>npm run db:migrate</code>. The schema
                avoids Postgres-only types precisely so nothing else has to change.
              </InfoNote>

              <InfoNote tone="warn">
                <strong className="font-semibold">Generated sites are on local disk.</strong> That
                is fine for development and wrong for a serverless deployment, where the filesystem
                is ephemeral. Configure <code>GITHUB_TOKEN</code> and <code>STORAGE_PROVIDER</code>{" "}
                before relying on a build surviving a restart.
              </InfoNote>
            </div>
          </div>
        ) : null}

        {tab === "outreach" ? (
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <OptOutManager
              optOuts={optOuts.map((o) => ({
                id: o.id,
                channel: o.channel,
                identifier: o.identifier,
                reason: o.reason,
                at: o.at.toISOString(),
              }))}
            />
            <InfoNote>
              <strong className="font-semibold">Why opt-outs are workspace-wide.</strong> A person
              who asked not to be contacted should stay uncontacted even if the same business is
              rediscovered by a later campaign under a slightly different name. Matching is on the
              normalised identifier — email, phone or handle — not on the prospect record, so
              re-discovery cannot undo it.
            </InfoNote>
          </div>
        ) : null}
      </div>
    </>
  );
}
