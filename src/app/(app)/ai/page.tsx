import Link from "next/link";
import {
  AI_CAPABILITIES,
  CAPABILITY_META,
  DEFAULT_ROUTING,
  MODEL_CATALOG,
  type AICapability,
  type AIProviderId,
} from "@/config/ai";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime, formatNumber, truncate } from "@/lib/utils";
import { aiProviderHealth, resolveRoute } from "@/providers/ai/router";
import { evaluateBudget, getSpendSummary } from "@/services/costs";
import { listJobs } from "@/services/jobs";
import { getSettings } from "@/services/settings";
import { QueryTabs } from "@/components/ui/Tabs";
import { JobList } from "@/components/features/JobList";
import { RoutingEditor, type RoutingRow } from "@/components/features/RoutingEditor";
import {
  Badge,
  EmptyState,
  InfoNote,
  Meter,
  MockBadge,
  Panel,
  PanelHeader,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI Control Center" };

function usd(v: number | null, fallback = "not priced"): string {
  return v == null ? fallback : `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

export default async function AIPage({ searchParams }: PageProps<"/ai">) {
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "routing";
  const { workspaceId } = await getWorkspaceContext();

  const [configs, jobs, spend, settings, jobRows] = await Promise.all([
    prisma.aIProviderConfig.findMany({ where: { workspaceId } }),
    prisma.aIJob.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 60 }),
    getSpendSummary(workspaceId),
    getSettings(workspaceId),
    listJobs(workspaceId, { kinds: ["ai"], limit: 30 }),
  ]);

  const byCapability = new Map(configs.map((c) => [c.capability, c]));
  const providers = aiProviderHealth();
  const budget = evaluateBudget(spend.month.costUsd, settings.monthlyBudgetUsd);

  const rows: RoutingRow[] = await Promise.all(
    AI_CAPABILITIES.map(async (capability: AICapability) => {
      const stored = byCapability.get(capability);
      const route = await resolveRoute(workspaceId, capability);
      const provider = (stored?.provider ?? DEFAULT_ROUTING[capability].provider) as AIProviderId;
      return {
        capability,
        provider,
        model: stored?.model ?? DEFAULT_ROUTING[capability].model,
        fallbackProvider: (stored?.fallbackProvider ??
          DEFAULT_ROUTING[capability].fallback?.provider ??
          null) as AIProviderId | null,
        fallbackModel: stored?.fallbackModel ?? DEFAULT_ROUTING[capability].fallback?.model ?? null,
        providerConfigured: providers.find((p) => p.id === provider)?.configured ?? false,
        effectiveProvider: `${route.provider.id} / ${route.model}`,
        degradedReason: route.degradedReason,
      } satisfies RoutingRow;
    }),
  );

  const anyReal = providers.some((p) => !p.isMock && p.configured);
  const unpriced = Object.values(MODEL_CATALOG)
    .flat()
    .filter((m) => m.usdPerMTokIn == null).length;

  const tabs = [
    { id: "routing", label: "Routing" },
    { id: "cost", label: "Cost" },
    { id: "providers", label: "Providers", count: providers.filter((p) => p.configured).length },
    { id: "jobs", label: "Job queue", count: jobs.length },
  ];

  return (
    <>
      <PageHeader
        title="AI Control Center"
        description="Capabilities are routed to providers, not the other way round. Nothing in the app calls a model directly — every call is a recorded job."
        meta={
          anyReal ? (
            <Badge tone="ok" dot>
              At least one provider is configured
            </Badge>
          ) : (
            <MockBadge what="No AI keys — output is composed from stored data" />
          )
        }
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-5">
        <StatTile label="Jobs (30d)" value={formatNumber(spend.month.jobs)} />
        <StatTile
          label="Failed"
          value={formatNumber(spend.month.failed)}
          tone={spend.month.failed ? "danger" : undefined}
        />
        <StatTile
          label="Composed locally"
          value={formatNumber(spend.month.mockJobs)}
          sub="No model was called"
          tone={spend.month.mockJobs ? "warn" : undefined}
        />
        <StatTile label="Today" value={usd(spend.today.costUsd, "$0.00")} sub={`${spend.today.jobs} jobs`} />
        <StatTile label="This week" value={usd(spend.week.costUsd, "$0.00")} sub={`${spend.week.jobs} jobs`} />
        <StatTile
          label="This month"
          value={usd(spend.month.costUsd, "$0.00")}
          sub={budget.budgetUsd ? `of $${budget.budgetUsd} budget` : "No budget set"}
          tone={budget.status === "blocked" ? "danger" : budget.status === "warn-80" ? "warn" : undefined}
        />
      </div>

      <QueryTabs basePath="/ai" current={tab} tabs={tabs} />

      <div className="mt-5">
        {/* ------------------------------------------------------- routing */}
        {tab === "routing" ? (
          <div className="flex flex-col gap-5">
            <Panel>
              <PanelHeader
                title="Capability routing"
                hint="Claude is the default for anything a client will see; cheaper providers handle bulk work. Change any of it."
              />
              <RoutingEditor rows={rows} />
            </Panel>
            <InfoNote>
              When a capability&apos;s provider has no API key, the router falls through to the
              configured fallback and then to the deterministic composer. The composer performs no
              inference — it rearranges facts already in the database — and everything it produces
              is labelled as such in the UI.
            </InfoNote>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- cost */}
        {tab === "cost" ? (
          <div className="flex flex-col gap-5">
            {budget.budgetUsd ? (
              <Panel>
                <PanelHeader
                  title="Monthly budget"
                  hint={
                    settings.enforceBudget
                      ? "New AI jobs are refused once this is spent."
                      : "Warn only — jobs continue past the limit."
                  }
                  actions={
                    <Badge
                      tone={
                        budget.status === "blocked"
                          ? "danger"
                          : budget.status === "warn-80"
                            ? "warn"
                            : "ok"
                      }
                    >
                      {budget.pct != null ? `${budget.pct}%` : "unknown"}
                    </Badge>
                  }
                />
                <div className="px-4 py-3">
                  <Meter
                    value={budget.pct ?? 0}
                    height="md"
                    tone={
                      budget.pct != null && budget.pct >= 100
                        ? "danger"
                        : budget.pct != null && budget.pct >= 80
                          ? "warn"
                          : "ok"
                    }
                  />
                  <p className="mt-2 text-[12px] text-ink-3">{budget.message}</p>
                </div>
              </Panel>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel>
                <PanelHeader
                  title="Spend by provider"
                  hint="Last 30 days. Token counts come from provider responses."
                />
                {spend.byProvider.length === 0 ? (
                  <EmptyState title="No jobs yet" body="Run an analysis or generate a concept." compact />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Provider</Th>
                        <Th className="text-right">Jobs</Th>
                        <Th className="text-right">Tokens in</Th>
                        <Th className="text-right">Tokens out</Th>
                        <Th className="text-right">Cost</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {spend.byProvider.map((p) => (
                        <tr key={p.provider}>
                          <Td className="text-ink">{p.provider}</Td>
                          <Td className="tabular text-right">{p.jobs}</Td>
                          <Td className="tabular text-right">{formatNumber(p.tokensIn)}</Td>
                          <Td className="tabular text-right">{formatNumber(p.tokensOut)}</Td>
                          <Td className="tabular text-right">{usd(p.costUsd)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Panel>

              <Panel>
                <PanelHeader title="Spend by task" hint="Which operations actually consume the budget." />
                {spend.byType.length === 0 ? (
                  <EmptyState title="No jobs yet" body="Task costs appear once work has run." compact />
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Task</Th>
                        <Th className="text-right">Jobs</Th>
                        <Th className="text-right">Total</Th>
                        <Th className="text-right">Average</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {spend.byType.map((t) => (
                        <tr key={t.type}>
                          <Td className="text-ink font-mono text-[11.5px]">{t.type}</Td>
                          <Td className="tabular text-right">{t.jobs}</Td>
                          <Td className="tabular text-right">{usd(t.costUsd)}</Td>
                          <Td className="tabular text-right">{usd(t.avgCostUsd)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Panel>
            </div>

            <Panel>
              <PanelHeader
                title="Unit economics"
                hint="All-time spend divided by units produced. Only meaningful once prices are configured."
              />
              <div className="grid gap-2.5 grid-cols-2 md:grid-cols-4 p-4">
                <StatTile label="Per prospect" value={usd(spend.unitCosts.perProspect)} />
                <StatTile label="Per audit" value={usd(spend.unitCosts.perAudit)} />
                <StatTile label="Per website" value={usd(spend.unitCosts.perWebsite)} />
                <StatTile label="Per outreach" value={usd(spend.unitCosts.perOutreach)} />
              </div>
            </Panel>

            {unpriced > 0 ? (
              <InfoNote tone="warn">
                <strong className="font-semibold">
                  {unpriced} model{unpriced === 1 ? "" : "s"} in the catalogue have no price set.
                </strong>{" "}
                Token usage for those jobs is still recorded, but they cannot be costed, so totals
                here understate real spend. Fill in the per-million-token prices in{" "}
                <code>src/config/ai.ts</code> from your provider&apos;s pricing page — the app does
                not ship guessed prices, because a wrong number here is worse than none.
              </InfoNote>
            ) : null}
          </div>
        ) : null}

        {/* ----------------------------------------------------- providers */}
        {tab === "providers" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Providers" hint="Configuration is read from the environment at startup." />
              <ul>
                {providers.map((p) => (
                  <li key={p.id} className="px-4 py-3 border-b border-line last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12.5px] font-medium text-ink">{p.label}</span>
                      {p.isMock ? <MockBadge what="no inference" /> : null}
                      <Badge tone={p.configured ? "ok" : "neutral"} className="ml-auto">
                        {p.configured ? "configured" : "no key"}
                      </Badge>
                    </div>
                    <p className="text-[11.5px] text-ink-3 leading-relaxed">{p.setupHint}</p>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel>
              <PanelHeader title="Model catalogue" hint="Capabilities and prices per model." />
              <Table>
                <thead>
                  <tr>
                    <Th>Model</Th>
                    <Th>Tier</Th>
                    <Th className="text-right">$/M in</Th>
                    <Th className="text-right">$/M out</Th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(MODEL_CATALOG).flatMap(([provider, models]) =>
                    models.map((m) => (
                      <tr key={`${provider}:${m.id}`}>
                        <Td>
                          <span className="text-ink">{m.label}</span>
                          <span className="block text-[10.5px] text-ink-4 font-mono">{m.id}</span>
                        </Td>
                        <Td>
                          <Badge tone="neutral">{m.tier}</Badge>
                        </Td>
                        <Td className="tabular text-right">
                          {m.usdPerMTokIn == null ? "—" : m.usdPerMTokIn}
                        </Td>
                        <Td className="tabular text-right">
                          {m.usdPerMTokOut == null ? "—" : m.usdPerMTokOut}
                        </Td>
                      </tr>
                    )),
                  )}
                </tbody>
              </Table>
            </Panel>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- jobs */}
        {tab === "jobs" ? (
          <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
            <Panel>
              <PanelHeader
                title="AI job queue"
                hint="Every call is persisted before it runs, with its provider, usage, duration and outcome."
              />
              {jobs.length === 0 ? (
                <EmptyState
                  title="No jobs yet"
                  body="Analyse a prospect or generate a concept and jobs appear here."
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Type</Th>
                      <Th className="hidden sm:table-cell">Provider</Th>
                      <Th>Status</Th>
                      <Th className="text-right hidden md:table-cell">In</Th>
                      <Th className="text-right hidden md:table-cell">Out</Th>
                      <Th className="text-right">Cost</Th>
                      <Th className="text-right hidden lg:table-cell">Time</Th>
                      <Th className="hidden xl:table-cell">Detail</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => {
                      const err = fromJson<{ message: string; remedy: string } | null>(j.error, null);
                      return (
                        <tr key={j.id} className="hover:bg-surface-2 transition-colors">
                          <Td className="text-ink font-mono text-[11.5px]">{j.type}</Td>
                          <Td className="text-ink-3 hidden sm:table-cell">
                            {j.provider}
                            {j.model ? <span className="text-ink-4"> / {j.model}</span> : null}
                          </Td>
                          <Td>
                            <Badge
                              tone={
                                j.status === "complete"
                                  ? "ok"
                                  : j.status === "failed"
                                    ? "danger"
                                    : "info"
                              }
                            >
                              {j.status}
                            </Badge>
                          </Td>
                          <Td className="tabular text-right hidden md:table-cell">
                            {j.tokensIn ?? "—"}
                          </Td>
                          <Td className="tabular text-right hidden md:table-cell">
                            {j.tokensOut ?? "—"}
                          </Td>
                          <Td className="tabular text-right">
                            {j.costUsd == null ? "—" : `$${j.costUsd.toFixed(4)}`}
                          </Td>
                          <Td className="tabular text-right hidden lg:table-cell">
                            {j.durationMs != null ? `${j.durationMs}ms` : "—"}
                          </Td>
                          <Td className="max-w-64 hidden xl:table-cell">
                            {err ? (
                              <span className="text-danger">{truncate(err.message, 60)}</span>
                            ) : j.entityType === "prospect" && j.entityId ? (
                              <Link
                                href={`/prospects/${j.entityId}`}
                                className="text-ink-3 hover:text-accent"
                              >
                                prospect ↗
                              </Link>
                            ) : (
                              <span className="text-ink-4">{formatDateTime(j.createdAt)}</span>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Recent activity" hint="The same jobs, as a feed." />
              <JobList jobs={jobRows} />
            </Panel>
          </div>
        ) : null}
      </div>
    </>
  );
}
