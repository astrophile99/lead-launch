import { getWorkspaceContext } from "@/db/workspace";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";
import {
  getAIUsage,
  getCategoryBreakdown,
  getFunnel,
  getOverview,
} from "@/services/analytics";
import {
  Badge,
  EmptyState,
  InfoNote,
  Meter,
  Panel,
  PanelHeader,
  PageHeader,
  ScoreBadge,
  StatTile,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const { workspaceId } = await getWorkspaceContext();
  const [overview, funnel, categories, usage] = await Promise.all([
    getOverview(workspaceId),
    getFunnel(workspaceId),
    getCategoryBreakdown(workspaceId),
    getAIUsage(workspaceId),
  ]);

  const auditRate =
    overview.totalProspects > 0 ? overview.websitesAudited / overview.totalProspects : null;
  const highRate =
    overview.totalProspects > 0 ? overview.highOpportunity / overview.totalProspects : null;
  const replyRate = overview.outreachSent > 0 ? overview.replies / overview.outreachSent : null;
  const meetingRate = overview.replies > 0 ? overview.meetings / overview.replies : null;
  const closeRate = overview.meetings > 0 ? overview.won / overview.meetings : null;
  const avgValue = overview.won > 0 ? overview.wonValue / overview.won : null;

  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  /** Rates computed from a handful of rows are noise; say so instead of showing them. */
  const thin = (denominator: number) => denominator < 5;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Counted from stored rows only. Where the sample is too small to mean anything, that is stated rather than shown as a percentage."
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Discovered" value={formatNumber(overview.totalProspects)} />
        <StatTile
          label="Audit coverage"
          value={auditRate == null ? "—" : formatPercent(auditRate)}
          sub={`${overview.websitesAudited} of ${overview.totalProspects}`}
        />
        <StatTile
          label="High opportunity"
          value={highRate == null ? "—" : formatPercent(highRate)}
          sub={`${overview.highOpportunity} scoring ≥70`}
          tone="ok"
        />
        <StatTile label="Sites generated" value={formatNumber(overview.websitesGenerated)} />
        <StatTile label="Sites deployed" value={formatNumber(overview.websitesDeployed)} />
        <StatTile label="Outreach sent" value={formatNumber(overview.outreachSent)} />
      </div>

      <div className="mt-2.5 grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Reply rate"
          value={thin(overview.outreachSent) ? "—" : formatPercent(replyRate)}
          sub={thin(overview.outreachSent) ? `Only ${overview.outreachSent} sent` : `${overview.replies} replies`}
        />
        <StatTile
          label="Meeting rate"
          value={thin(overview.replies) ? "—" : formatPercent(meetingRate)}
          sub={thin(overview.replies) ? "Too few replies to read" : undefined}
        />
        <StatTile
          label="Close rate"
          value={thin(overview.meetings) ? "—" : formatPercent(closeRate)}
          sub={thin(overview.meetings) ? "Too few meetings to read" : undefined}
        />
        <StatTile label="Won" value={formatNumber(overview.won)} tone={overview.won ? "ok" : undefined} />
        <StatTile label="Average project value" value={avgValue == null ? "—" : formatCurrency(avgValue)} />
        <StatTile label="Open pipeline" value={formatCurrency(overview.pipelineValue)} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHeader title="Funnel" hint="Each step counts prospects that reached it or beyond." />
          <div className="px-4 py-4 flex flex-col gap-3">
            {funnel.map((step) => (
              <div key={step.id}>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[12.5px] text-ink w-24 shrink-0">{step.label}</span>
                  <span className="tabular text-[13px] font-semibold text-ink">{step.count}</span>
                  {step.rate != null ? (
                    <span className="tabular text-[11.5px] text-ink-3">
                      {formatPercent(step.rate)} of previous
                    </span>
                  ) : null}
                </div>
                <Meter
                  value={(step.count / maxFunnel) * 100}
                  tone={step.count === 0 ? "neutral" : "accent"}
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="By category" hint="Where the strongest opportunities cluster." />
          {categories.length === 0 ? (
            <EmptyState title="No data" body="Run a campaign to populate this." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th className="text-right">Prospects</Th>
                  <Th className="text-right">Avg opportunity</Th>
                  <Th className="text-right">Avg site score</Th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.category}>
                    <Td className="text-ink">{c.category}</Td>
                    <Td className="tabular text-right">{c.prospects}</Td>
                    <Td className="text-right">
                      <ScoreBadge score={c.avgOpportunity} />
                    </Td>
                    <Td className="text-right">
                      <ScoreBadge score={c.avgWebsiteScore} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>

      <Panel className="mt-5">
        <PanelHeader
          title="AI usage"
          hint="Token counts come from provider responses. Cost is only shown when a price is configured for the model."
        />
        <div className="grid gap-2.5 grid-cols-2 md:grid-cols-5 p-4">
          <StatTile label="Jobs run" value={formatNumber(usage.totalJobs)} />
          <StatTile label="Failed" value={formatNumber(usage.failed)} tone={usage.failed ? "danger" : undefined} />
          <StatTile
            label="Composed locally"
            value={formatNumber(usage.mockJobs)}
            sub="No model was called"
            tone={usage.mockJobs ? "warn" : undefined}
          />
          <StatTile label="Output tokens" value={formatNumber(usage.tokensOut)} />
          <StatTile
            label="Estimated cost"
            value={usage.costUsd == null ? "not priced" : `$${usage.costUsd.toFixed(2)}`}
            sub={usage.costUsd == null ? "Set model prices in config/ai.ts" : undefined}
          />
        </div>
        {usage.byProvider.length ? (
          <div className="px-4 pb-4 flex flex-wrap gap-1.5">
            {usage.byProvider.map((p) => (
              <Badge key={p.provider} tone="neutral">
                {p.provider}: {p.jobs} jobs
              </Badge>
            ))}
          </div>
        ) : null}
      </Panel>

      {overview.mockProspects > 0 ? (
        <div className="mt-5">
          <InfoNote tone="warn">
            {overview.mockProspects} of {overview.totalProspects} prospects are demo records. Their
            audits describe synthetic pages, so conversion figures above should be read as a
            demonstration of the reporting, not as a result.
          </InfoNote>
        </div>
      ) : null}
    </>
  );
}
