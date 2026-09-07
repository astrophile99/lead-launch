import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { getSpendSummary } from "@/services/costs";
import { getIntegrationGroups } from "@/services/integrations";
import { listOptOuts } from "@/services/optouts";
import { getSettings } from "@/services/settings";
import { capabilities } from "@/config/app";
import { gmail, GOOGLE_SCOPES } from "@/providers/messaging";
import { storageHealth } from "@/providers/storage";
import { cacheEffectiveness, getUsage } from "@/services/provider-usage";
import { GmailSettings } from "@/components/features/GmailSettings";
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

  const [
    workspace,
    settings,
    groups,
    tags,
    optOuts,
    spend,
    wa,
    ig,
    gmailRow,
    gmailHealth,
    usage,
    cache,
    storage,
  ] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: ctx.workspaceId } }),
    getSettings(ctx.workspaceId),
    getIntegrationGroups(ctx.workspaceId),
    prisma.tag.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { name: "asc" } }),
    listOptOuts(ctx.workspaceId),
    getSpendSummary(ctx.workspaceId),
    prisma.whatsAppAccount.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    prisma.instagramAccount.findUnique({ where: { workspaceId: ctx.workspaceId } }),
    gmail.connection(ctx.workspaceId),
    gmail.health(ctx.workspaceId),
    getUsage(ctx.workspaceId),
    cacheEffectiveness(ctx.workspaceId),
    storageHealth(),
  ]);

  const gmailView = { connection: gmailRow, health: gmailHealth, scopes: GOOGLE_SCOPES };

  const connected = groups.filter((g) => g.ready).length;
  const webhookBase = appConfig.appUrl.replace(/\/$/, "");

  // Grouped rather than one long page: integrations first, then one tab per
  // integration that has real setup of its own, then the knobs.
  const tabs = [
    { id: "integrations", label: "Integrations", count: connected },
    { id: "gmail", label: "Gmail" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "instagram", label: "Instagram" },
    { id: "research", label: "Research" },
    { id: "storage", label: "Storage" },
    { id: "security", label: "Security" },
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

        {tab === "gmail" ? (
          <GmailSettings
            view={{
              connection: gmailView.connection
                ? {
                    ...gmailView.connection,
                    connectedAt: gmailView.connection.connectedAt?.toISOString() ?? null,
                    lastCheckedAt: gmailView.connection.lastCheckedAt?.toISOString() ?? null,
                  }
                : null,
              health: gmailView.health,
              scopes: [...gmailView.scopes],
            }}
          />
        ) : null}

        {tab === "research" ? (
          <div className="flex flex-col gap-5">
            <Panel>
              <PanelHeader
                title="Research budget"
                hint="Every limit here is enforced by the crawler, not merely suggested. Research is the recurring cost in this product, so the ceilings are real."
              />
              <div className="px-4 py-3.5">
                <DetailList
                  labelWidth="w-44"
                  items={[
                    ["Pages per site", `${appConfig.research.maxPagesPerSite} maximum`],
                    [
                      "Bytes per page",
                      `${(appConfig.research.maxBytesPerPage / 1024).toFixed(0)}KB, read in chunks and abandoned past the cap`,
                    ],
                    ["Request timeout", `${appConfig.research.fetchTimeoutMs}ms`],
                    [
                      "Redirects",
                      `${appConfig.research.maxRedirects}, each hop re-checked against the SSRF guard`,
                    ],
                    ["Per-host throttle", `${appConfig.research.hostThrottleMs}ms between requests`],
                    ["Cache lifetime", `${appConfig.research.cacheTtlDays} days`],
                    [
                      "robots.txt",
                      appConfig.research.respectRobots ? "honoured" : "ignored (development only)",
                    ],
                    ["User agent", appConfig.research.userAgent],
                  ]}
                />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="External calls this month"
                hint="Counted per provider, so the Google free allowance is a number rather than a surprise at the end of the month."
              />
              {usage.length === 0 ? (
                <p className="px-4 py-3 text-[12.5px] text-ink-3">
                  No external calls have been made this month.
                </p>
              ) : (
                <div className="px-4 py-3 flex flex-col gap-3">
                  {usage.map((u) => (
                    <div
                      key={u.provider}
                      className="border-b border-line pb-2.5 last:border-0 last:pb-0"
                    >
                      <div className="flex items-center gap-2">
                        <p className="text-[12.5px] font-medium text-ink">{u.label}</p>
                        <span className="tabular ml-auto text-[12.5px] text-ink-2">
                          {u.requests} request{u.requests === 1 ? "" : "s"}
                        </span>
                      </div>
                      {u.freeRemaining != null ? (
                        <p className="text-[11.5px] text-ink-3 mt-0.5">
                          {u.freeRemaining} of {u.freeAllowance} free calls remaining this month.
                        </p>
                      ) : null}
                      <p className="text-[11.5px] text-ink-4 mt-0.5 leading-snug">{u.note}</p>
                      <p className="text-[11.5px] text-ink-4">
                        {u.priced
                          ? `Estimated cost: $${(u.estimatedUsd ?? 0).toFixed(2)}.`
                          : "No per-request price is configured, so no money figure is shown."}
                      </p>
                    </div>
                  ))}
                  {cache.hitRate != null ? (
                    <InfoNote tone="ok">
                      The research cache served {cache.hitRate}% of lookups without a request.
                    </InfoNote>
                  ) : null}
                </div>
              )}
            </Panel>
          </div>
        ) : null}

        {tab === "storage" ? (
          <Panel>
            <PanelHeader
              title="Artifact storage"
              hint="Where generated websites persist. The local filesystem is a build cache, never the source of truth in production."
              actions={
                <Badge tone={storage.durable ? "ok" : "warn"} dot>
                  {storage.durable ? "durable" : "not durable"}
                </Badge>
              }
            />
            <div className="px-4 py-3.5 flex flex-col gap-3">
              <DetailList
                items={[
                  ["Provider", storage.label],
                  ["Status", storage.status],
                  ["Detail", storage.detail],
                  ["Bucket", appConfig.storage.bucket],
                ]}
              />
              {!storage.durable ? (
                <InfoNote tone="warn">
                  Generated sites are on this machine&apos;s disk. That is fine while developing and
                  wrong on a serverless host, where the filesystem is discarded between deploys — a
                  build would survive until the next restart and then be gone. Set{" "}
                  <code>STORAGE_PROVIDER=supabase</code> with a bucket before relying on it.
                </InfoNote>
              ) : null}
              {storage.setupHint ? (
                <p className="text-[12px] text-ink-3">{storage.setupHint}</p>
              ) : null}
            </div>
          </Panel>
        ) : null}

        {tab === "security" ? (
          <Panel>
            <PanelHeader
              title="Security"
              hint="What is enforced today, and what is not. Stated rather than implied."
            />
            <div className="px-4 py-3.5 flex flex-col gap-3">
              {!capabilities.hasAuth ? (
                <InfoNote tone="danger">
                  <strong className="font-semibold">Authentication is not wired up.</strong> Every
                  screen exists and validates, and the data model is ready, but sign-in cannot work
                  until Supabase is configured. Until then anyone who can reach this server has
                  owner access — do not expose it publicly.
                </InfoNote>
              ) : (
                <InfoNote tone="ok">
                  Supabase credentials are present. Session enforcement is the next phase.
                </InfoNote>
              )}
              <DetailList
                labelWidth="w-44"
                items={[
                  [
                    "Authorization",
                    "Centralised in src/lib/authz.ts. Workspace ids are always derived from the session, never accepted from a client.",
                  ],
                  [
                    "Credential encryption",
                    capabilities.canStoreSecrets ? (
                      <span key="enc" className="text-ok">
                        TOKEN_ENCRYPTION_KEY is set. OAuth tokens are sealed with AES-256-GCM.
                      </span>
                    ) : (
                      <span key="enc" className="text-warn">
                        Not set. The app refuses to store an OAuth token at all rather than keeping
                        one in plaintext.
                      </span>
                    ),
                  ],
                  [
                    "Webhook verification",
                    appConfig.whatsapp.appSecret ? (
                      <span key="wh" className="text-ok">
                        META_APP_SECRET is set; signatures are verified against the raw body.
                      </span>
                    ) : (
                      <span key="wh" className="text-warn">
                        META_APP_SECRET is missing, so webhook payloads are rejected rather than
                        trusted.
                      </span>
                    ),
                  ],
                  [
                    "SSRF protection",
                    "Every fetched URL, including every redirect hop, is checked against the private-address guard before a socket opens.",
                  ],
                  [
                    "Archive safety",
                    "Downloaded ZIPs refuse any entry name that would be dangerous to extract: traversal, absolute paths, drive letters, control characters, Windows device names.",
                  ],
                  [
                    "Prompt injection",
                    "Crawled pages and inbound messages reach models as data. No model output can send a message, start a build or deploy anything — each of those needs a human action.",
                  ],
                ]}
              />
            </div>
          </Panel>
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
                        appConfig.database.isPostgres
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
