import Link from "next/link";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { formatCurrency, formatNumber, relativeTime } from "@/lib/utils";
import { getOpportunityFeed, getOverview } from "@/services/analytics";
import { evaluateBudget, getSpendSummary } from "@/services/costs";
import { getSetupSteps } from "@/services/integrations";
import { listJobs } from "@/services/jobs";
import { getSettings } from "@/services/settings";
import { JobList } from "@/components/features/JobList";
import { SetupChecklist } from "@/components/features/SetupChecklist";
import {
  Badge,
  EmptyState,
  InfoNote,
  LinkButton,
  MockBadge,
  Panel,
  PanelHeader,
  PageHeader,
  ScoreBadge,
  StatTile,
  StatusDot,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const FEED_GLYPH: Record<string, string> = {
  "no-website": "🔥",
  "weak-sites": "⚡",
  "poor-mobile": "📱",
  "strong-reviews": "💎",
  "awaiting-approval": "📨",
  overdue: "⏰",
  "failed-audits": "⚠️",
  unaudited: "🔍",
};

export default async function OverviewPage() {
  const { workspaceId } = await getWorkspaceContext();

  const [overview, feed, jobs, openTasks, topProspects, setupSteps, spend, settings] =
    await Promise.all([
      getOverview(workspaceId),
      getOpportunityFeed(workspaceId),
      listJobs(workspaceId, { limit: 8 }),
      prisma.task
        .findMany({
          where: { workspaceId, status: "open" },
          orderBy: [{ dueAt: "asc" }],
          take: 7,
          include: { prospect: { include: { business: { select: { name: true } } } } },
        })
        // Overdue is decided here, against the clock at fetch time, rather than
        // during render - render stays a pure function of its inputs.
        .then((tasks) =>
          tasks.map((t) => ({ ...t, overdue: t.dueAt != null && t.dueAt.getTime() < Date.now() })),
        ),
      prisma.prospect.findMany({
        where: { workspaceId, opportunityScore: { not: null } },
        orderBy: { opportunityScore: "desc" },
        take: 5,
        include: { business: true },
      }),
      getSetupSteps(workspaceId),
      getSpendSummary(workspaceId),
      getSettings(workspaceId),
    ]);

  const visibleSteps = setupSteps.filter((s) => !settings.dismissedSetupSteps.includes(s.id));
  const showChecklist = visibleSteps.some((s) => !s.done);
  const budget = evaluateBudget(spend.month.costUsd, settings.monthlyBudgetUsd);
  const replyRate = overview.outreachSent > 0 ? overview.replies / overview.outreachSent : null;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Every figure below is counted from stored rows. Nothing here is estimated."
        meta={
          <>
            {appConfig.mode === "demo" ? (
              <MockBadge what="Demo mode" />
            ) : (
              <Badge tone="ok" dot>
                Live
              </Badge>
            )}
            {overview.mockProspects > 0 ? (
              <Badge tone="neutral">
                {overview.mockProspects} of {overview.totalProspects} prospects are demo data
              </Badge>
            ) : null}
            {budget.status === "warn-80" || budget.status === "blocked" ? (
              <Badge tone={budget.status === "blocked" ? "danger" : "warn"}>{budget.message}</Badge>
            ) : null}
          </>
        }
        actions={
          <>
            <LinkButton href="/discover" variant="primary">
              New campaign
            </LinkButton>
            <LinkButton href="/radar">Opportunity radar</LinkButton>
          </>
        }
      />

      {showChecklist ? <SetupChecklist steps={visibleSteps} /> : null}

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
        <StatTile
          label="Prospects"
          value={formatNumber(overview.totalProspects)}
          sub={`${overview.newThisWeek} this week`}
          href="/prospects"
        />
        <StatTile
          label="High opportunity"
          value={formatNumber(overview.highOpportunity)}
          sub="Scoring 70+"
          tone="ok"
          href="/radar"
        />
        <StatTile
          label="Audited"
          value={formatNumber(overview.websitesAudited)}
          sub={overview.auditsFailed ? `${overview.auditsFailed} failed` : "No failures"}
          tone={overview.auditsFailed ? "warn" : undefined}
          href="/audit"
        />
        <StatTile
          label="Sites built"
          value={formatNumber(overview.websitesGenerated)}
          sub={`${overview.websitesDeployed} deployed`}
          href="/studio"
        />
        <StatTile
          label="Outreach"
          value={formatNumber(overview.outreachSent)}
          sub={`${overview.outreachDrafted} drafted`}
          href="/outreach"
        />
        <StatTile
          label="Replies"
          value={formatNumber(overview.replies)}
          sub={replyRate == null ? "Nothing sent yet" : `${Math.round(replyRate * 100)}% of sent`}
        />
        <StatTile
          label="Meetings"
          value={formatNumber(overview.meetings)}
          sub={`${overview.won} won`}
          href="/pipeline"
        />
        <StatTile
          label="Pipeline"
          value={formatCurrency(overview.pipelineValue)}
          sub={overview.won ? `${formatCurrency(overview.wonValue)} won` : "Open value"}
          href="/analytics"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader
              title="Opportunity feed"
              hint="Each line is a live count of rows that match. Click through to the filtered list."
            />
            {feed.length === 0 ? (
              <EmptyState
                title="Nothing to act on yet"
                body="Run a discovery campaign and this fills with real counts from your own data."
                action={
                  <LinkButton href="/discover" variant="primary" size="sm">
                    Start discovery
                  </LinkButton>
                }
              />
            ) : (
              <ul>
                {feed.map((item) => (
                  <li key={item.id} className="border-b border-line last:border-0">
                    <Link
                      href={item.href}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors group"
                    >
                      <span aria-hidden className="text-[13px] w-5 shrink-0">
                        {FEED_GLYPH[item.id] ?? "•"}
                      </span>
                      <span className="tabular text-[15px] font-semibold text-ink w-9 shrink-0">
                        {item.count}
                      </span>
                      <span className="text-[12.5px] text-ink-2 flex-1 min-w-0 truncate">
                        {item.text.replace(/^\d+\s/, "")}
                      </span>
                      <span className="text-ink-4 text-[12px] group-hover:text-accent transition-colors">
                        &rarr;
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Strongest prospects"
              hint="Ranked by the explainable opportunity score."
              actions={
                <LinkButton href="/radar" size="sm">
                  Open radar
                </LinkButton>
              }
            />
            {topProspects.length === 0 ? (
              <EmptyState
                title="No scored prospects"
                body="Prospects are scored automatically once they have been audited."
                compact
              />
            ) : (
              <ul>
                {topProspects.map((p) => (
                  <li key={p.id} className="border-b border-line last:border-0">
                    <Link
                      href={`/prospects/${p.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium text-ink truncate">
                          {p.business.name}
                        </p>
                        <p className="text-[11.5px] text-ink-3 truncate">
                          {p.business.category} · {p.business.area ?? p.business.city}
                          {p.business.rating != null ? ` · ${p.business.rating}★` : ""}
                          {p.business.reviewCount != null ? ` (${p.business.reviewCount})` : ""}
                        </p>
                      </div>
                      {p.business.website ? (
                        <ScoreBadge score={p.websiteScore} label="site" />
                      ) : (
                        <Badge tone="danger">No site</Badge>
                      )}
                      <ScoreBadge score={p.opportunityScore} label="opp" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader
              title="Next actions"
              hint="Derived from each prospect's actual state."
              actions={
                <LinkButton href="/pipeline" size="sm">
                  All tasks
                </LinkButton>
              }
            />
            {openTasks.length === 0 ? (
              <EmptyState
                title="Nothing outstanding"
                body="Suggested actions appear as prospects move through the workflow."
                compact
              />
            ) : (
              <ul>
                {openTasks.map((t) => (
                  <li key={t.id} className="border-b border-line last:border-0 px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5">
                        <StatusDot tone={t.overdue ? "danger" : "neutral"} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-ink leading-snug">{t.title}</p>
                        {t.prospect ? (
                          <Link
                            href={`/prospects/${t.prospectId}`}
                            className="text-[11.5px] text-ink-3 hover:text-accent truncate block"
                          >
                            {t.prospect.business.name}
                          </Link>
                        ) : null}
                      </div>
                      <span
                        className={`text-[11px] shrink-0 ${t.overdue ? "text-danger" : "text-ink-4"}`}
                      >
                        {t.dueAt ? relativeTime(t.dueAt) : "—"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="Recent jobs"
              hint="Discovery, audits, AI calls, builds and deployments."
              actions={
                <LinkButton href="/ai?tab=jobs" size="sm">
                  All jobs
                </LinkButton>
              }
            />
            <JobList jobs={jobs} />
          </Panel>

          {appConfig.mode === "demo" ? (
            <InfoNote tone="warn">
              <strong className="font-semibold">Demo mode.</strong> Discovery and AI output come
              from local mock providers and are labelled wherever they appear. Audits of real URLs
              still make real HTTP requests. Add credentials in{" "}
              <Link href="/settings?tab=integrations" className="text-accent underline underline-offset-2">
                Settings → Integrations
              </Link>{" "}
              and set <code>APP_MODE=live</code> to switch providers over.
            </InfoNote>
          ) : null}
        </div>
      </div>
    </>
  );
}
