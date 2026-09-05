import Link from "next/link";
import {
  AI_CAPABILITIES,
  DEFAULT_ROUTING,
  type AICapability,
  type AIProviderId,
} from "@/config/ai";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime, formatNumber, truncate } from "@/lib/utils";
import { aiProviderHealth, resolveRoute } from "@/providers/ai/router";
import { getAIUsage } from "@/services/analytics";
import { QueryTabs } from "@/components/ui/Tabs";
import { RoutingEditor, type RoutingRow } from "@/components/features/RoutingEditor";
import {
  Badge,
  EmptyState,
  InfoNote,
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

export default async function AIPage({ searchParams }: PageProps<"/ai">) {
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "routing";
  const { workspaceId } = await getWorkspaceContext();

  const [configs, jobs, usage] = await Promise.all([
    prisma.aIProviderConfig.findMany({ where: { workspaceId } }),
    prisma.aIJob.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    getAIUsage(workspaceId),
  ]);

  const byCapability = new Map(configs.map((c) => [c.capability, c]));
  const providers = aiProviderHealth();

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

  const tabs = [
    { id: "routing", label: "Routing" },
    { id: "providers", label: "Providers", count: providers.length },
    { id: "jobs", label: "Job queue", count: jobs.length },
  ];

  const anyReal = providers.some((p) => !p.isMock && p.configured);

  return (
    <>
      <PageHeader
        title="AI Control Center"
        description="Capabilities are routed to providers, not the other way round. Nothing in the app calls a model directly — every call is a recorded job."
        meta={
          anyReal ? (
            <Badge tone="ok">At least one provider is configured</Badge>
          ) : (
            <MockBadge what="No AI keys — output is composed from stored data" />
          )
        }
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-5 mb-5">
        <StatTile label="Jobs run" value={formatNumber(usage.totalJobs)} />
        <StatTile label="Failed" value={formatNumber(usage.failed)} tone={usage.failed ? "danger" : undefined} />
        <StatTile
          label="Composed locally"
          value={formatNumber(usage.mockJobs)}
          tone={usage.mockJobs ? "warn" : undefined}
          sub="No model was called"
        />
        <StatTile label="Output tokens" value={formatNumber(usage.tokensOut)} />
        <StatTile
          label="Cost"
          value={usage.costUsd == null ? "not priced" : `$${usage.costUsd.toFixed(2)}`}
          sub={usage.costUsd == null ? "No model prices configured" : undefined}
        />
      </div>

      <QueryTabs basePath="/ai" current={tab} tabs={tabs} />

      <div className="mt-5">
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
              inference — it rearranges facts already in the database — and everything it produces is
              labelled as such in the UI.
            </InfoNote>
          </div>
        ) : null}

        {tab === "providers" ? (
          <Panel>
            <PanelHeader title="Providers" hint="Configuration is read from environment variables at startup." />
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
        ) : null}

        {tab === "jobs" ? (
          <Panel>
            <PanelHeader
              title="Job queue"
              hint="Every AI call is persisted before it runs, with its provider, usage, duration and outcome."
            />
            {jobs.length === 0 ? (
              <EmptyState title="No jobs yet" body="Analyse a prospect or generate a concept and jobs appear here." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Capability</Th>
                    <Th>Provider</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Tokens in</Th>
                    <Th className="text-right">Tokens out</Th>
                    <Th className="text-right">Duration</Th>
                    <Th>Started</Th>
                    <Th>Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => {
                    const err = fromJson<{ message: string; remedy: string } | null>(j.error, null);
                    return (
                      <tr key={j.id} className="hover:bg-surface-2 transition-colors">
                        <Td className="text-ink font-mono text-[11.5px]">{j.type}</Td>
                        <Td className="text-ink-3">{j.capability}</Td>
                        <Td className="text-ink-3">
                          {j.provider}
                          {j.model ? <span className="text-ink-4"> / {j.model}</span> : null}
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              j.status === "complete" ? "ok" : j.status === "failed" ? "danger" : "info"
                            }
                          >
                            {j.status}
                          </Badge>
                        </Td>
                        <Td className="tabular text-right">{j.tokensIn ?? "—"}</Td>
                        <Td className="tabular text-right">{j.tokensOut ?? "—"}</Td>
                        <Td className="tabular text-right">{j.durationMs != null ? `${j.durationMs}ms` : "—"}</Td>
                        <Td className="text-ink-3 whitespace-nowrap">{formatDateTime(j.createdAt)}</Td>
                        <Td className="max-w-64">
                          {err ? (
                            <span className="text-danger">{truncate(err.message, 70)}</span>
                          ) : j.entityId ? (
                            <Link
                              href={`/prospects/${j.entityId}`}
                              className="text-ink-3 hover:text-accent"
                            >
                              {j.entityType} ↗
                            </Link>
                          ) : (
                            "—"
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>
        ) : null}
      </div>
    </>
  );
}
