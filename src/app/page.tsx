import Link from "next/link";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { formatCurrency, formatNumber, relativeTime } from "@/lib/utils";
import { getOpportunityFeed, getOverview } from "@/services/analytics";
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
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { workspaceId } = await getWorkspaceContext();

  const [overview, feed, recentActivity, openTasks, topProspects] = await Promise.all([
    getOverview(workspaceId),
    getOpportunityFeed(workspaceId),
    prisma.activity.findMany({
      where: { workspaceId },
      orderBy: { at: "desc" },
      take: 12,
      include: { prospect: { include: { business: { select: { name: true } } } } },
    }),
    prisma.task
      .findMany({
        where: { workspaceId, status: "open" },
        orderBy: [{ dueAt: "asc" }],
        take: 8,
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
      take: 6,
      include: { business: true },
    }),
  ]);

  const replyRate =
    overview.outreachSent > 0 ? overview.replies / overview.outreachSent : null;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything below is counted from stored rows. Nothing here is estimated."
        meta={
          <>
            {appConfig.mode === "demo" ? <MockBadge what="Demo mode" /> : <Badge tone="ok">Live mode</Badge>}
            {overview.mockProspects > 0 ? (
              <Badge tone="neutral">
                {overview.mockProspects} of {overview.totalProspects} prospects are demo data
              </Badge>
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

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Prospects" value={formatNumber(overview.totalProspects)} sub={`${overview.newThisWeek} added this week`} href="/prospects" />
        <StatTile label="High opportunity" value={formatNumber(overview.highOpportunity)} sub="Scoring 70 or above" tone="ok" href="/radar" />
        <StatTile label="Audited" value={formatNumber(overview.websitesAudited)} sub={overview.auditsFailed ? `${overview.auditsFailed} failed` : "No failures"} tone={overview.auditsFailed ? "warn" : undefined} href="/audit" />
        <StatTile label="Sites generated" value={formatNumber(overview.websitesGenerated)} sub={`${overview.websitesDeployed} deployed`} href="/studio" />
        <StatTile label="Outreach sent" value={formatNumber(overview.outreachSent)} sub={`${overview.outreachDrafted} drafted in total`} href="/outreach" />
        <StatTile
          label="Pipeline value"
          value={formatCurrency(overview.pipelineValue)}
          sub={overview.won ? `${formatCurrency(overview.wonValue)} won` : "Nothing won yet"}
          href="/analytics"
        />
      </div>

      <div className="mt-2.5 grid gap-2.5 grid-cols-2 md:grid-cols-4">
        <StatTile label="Replies" value={formatNumber(overview.replies)} sub={replyRate == null ? "No messages sent yet" : `${Math.round(replyRate * 100)}% of sent`} />
        <StatTile label="Meetings" value={formatNumber(overview.meetings)} />
        <StatTile label="Won" value={formatNumber(overview.won)} tone={overview.won ? "ok" : undefined} />
        <StatTile label="Open tasks" value={formatNumber(openTasks.length)} sub="Next actions awaiting you" href="/pipeline" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-5">
          <Panel>
            <PanelHeader
              title="Opportunity feed"
              hint="Each line is a live count. Click through to the filtered list."
            />
            {feed.length === 0 ? (
              <EmptyState
                title="Nothing to act on yet"
                body="Run a discovery campaign and the feed will fill with real counts from your own data."
                action={<LinkButton href="/discover" variant="primary" size="sm">Start a campaign</LinkButton>}
              />
            ) : (
              <ul>
                {feed.map((item) => (
                  <li key={item.id} className="border-b border-line last:border-0">
                    <Link
                      href={item.href}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors"
                    >
                      <span className="tabular text-[15px] font-semibold text-ink w-9 shrink-0">
                        {item.count}
                      </span>
                      <span className="text-[12.5px] text-ink-2 flex-1 min-w-0 truncate">
                        {item.text.replace(/^\d+\s/, "")}
                      </span>
                      <span className="text-ink-4 text-[12px]">&rarr;</span>
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
              actions={<LinkButton href="/radar" size="sm">Open radar</LinkButton>}
            />
            {topProspects.length === 0 ? (
              <EmptyState title="No scored prospects" body="Prospects are scored automatically once they have been audited." />
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
            <PanelHeader title="Next actions" hint="Derived from each prospect's actual state." />
            {openTasks.length === 0 ? (
              <EmptyState title="Nothing outstanding" body="Suggested actions appear as prospects move through the workflow." />
            ) : (
              <ul>
                {openTasks.map((t) => {
                  const { overdue } = t;
                  return (
                    <li key={t.id} className="border-b border-line last:border-0 px-4 py-2.5">
                      <div className="flex items-start gap-2">
                        <span
                          aria-hidden
                          className={`mt-1.5 size-1.5 rounded-full shrink-0 ${overdue ? "bg-danger" : "bg-ink-4"}`}
                        />
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
                        <span className={`text-[11px] shrink-0 ${overdue ? "text-danger" : "text-ink-4"}`}>
                          {t.dueAt ? relativeTime(t.dueAt) : "—"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Recent activity" hint="The system's own audit trail." />
            {recentActivity.length === 0 ? (
              <EmptyState title="No activity yet" body="Every audit, build and message is recorded here." />
            ) : (
              <ol className="px-4 py-2">
                {recentActivity.map((a) => (
                  <li key={a.id} className="flex gap-3 py-1.5 text-[12px]">
                    <span className="tabular text-ink-4 shrink-0 w-11">
                      {a.at.toISOString().slice(11, 16)}
                    </span>
                    <span className="text-ink-2 min-w-0">
                      {a.message}
                      {a.prospect ? (
                        <Link
                          href={`/prospects/${a.prospectId}`}
                          className="text-ink-3 hover:text-accent ml-1"
                        >
                          — {a.prospect.business.name}
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          {appConfig.mode === "demo" ? (
            <InfoNote tone="warn">
              <strong className="font-semibold">Demo mode.</strong> Discovery and AI output come
              from local mock providers and are labelled wherever they appear. Website audits of
              real URLs still make real HTTP requests. Add API keys to <code>.env</code> and set{" "}
              <code>APP_MODE=live</code> to switch providers over.{" "}
              <Link href="/settings" className="text-accent underline underline-offset-2">
                Provider status
              </Link>
            </InfoNote>
          ) : null}
        </div>
      </div>
    </>
  );
}
