import Link from "next/link";
import { notFound } from "next/navigation";
import { FACTOR_LABELS, type ScoringFactor } from "@/config/scoring";
import { STAGE_META, type PipelineStage } from "@/config/pipeline";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatCurrency, formatDateTime, hostOf, plural, relativeTime } from "@/lib/utils";
import { latestAudit } from "@/services/audit";
import { latestOpportunity } from "@/services/opportunity";
import type { AuditSignals, SalesAngle, WebsiteBrief } from "@/types";
import { QueryTabs } from "@/components/ui/Tabs";
import {
  Badge,
  EmptyState,
  ErrorState,
  InfoNote,
  Meter,
  MockBadge,
  Panel,
  PanelHeader,
  PageHeader,
  ScoreBadge,
} from "@/components/ui/primitives";
import {
  AuditHeader,
  FindingsList,
  ScoreGrid,
  SignalsPanel,
  type FindingRow,
} from "@/components/features/AuditReport";
import {
  buildPresence,
  CompetitorCompare,
  DigitalPresenceGrid,
} from "@/components/features/DigitalPresence";
import { SequenceButton } from "@/components/features/OutreachActions";
import {
  DraftOutreachControls,
  NoteComposer,
  OptOutButton,
  ProspectPrimaryActions,
  StageSelect,
  TagPicker,
} from "@/components/features/ProspectActions";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "presence", label: "Digital Presence" },
  { id: "audit", label: "Website Audit" },
  { id: "opportunity", label: "Opportunity" },
  { id: "competitors", label: "Competitors" },
  { id: "concept", label: "Website Concept" },
  { id: "outreach", label: "Outreach" },
  { id: "activity", label: "Activity" },
  { id: "notes", label: "Notes" },
];

export default async function ProspectPage({
  params,
  searchParams,
}: PageProps<"/prospects/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "overview";
  const { workspaceId } = await getWorkspaceContext();

  const prospect = await prisma.prospect.findFirst({
    where: { id, workspaceId },
    include: {
      business: true,
      campaign: true,
      tags: { include: { tag: true } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: true } },
      activities: { orderBy: { at: "desc" }, take: 60 },
      tasks: { where: { status: "open" }, orderBy: { dueAt: "asc" } },
      messages: { orderBy: { createdAt: "desc" }, include: { events: { orderBy: { at: "desc" } } } },
      projects: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
      competitors: true,
    },
  });
  if (!prospect) notFound();

  const [audit, opportunity, allTags] = await Promise.all([
    latestAudit(prospect.id),
    latestOpportunity(prospect.id),
    prisma.tag.findMany({ where: { workspaceId }, orderBy: { name: "asc" } }),
  ]);

  const b = prospect.business;
  const project = prospect.projects[0] ?? null;
  const brief = project ? fromJson<WebsiteBrief | null>(project.briefJson, null) : null;
  const salesAngle = opportunity?.salesAngle as SalesAngle | null;
  const signals = audit?.signals as AuditSignals | null;
  const services = fromJson<string[]>(b.servicesJson, []);
  const hours = fromJson<Record<string, string> | null>(b.hoursJson, null);

  const tabsWithCounts = TABS.map((t) => ({
    ...t,
    count:
      t.id === "audit" ? audit?.findings.length ?? 0
      : t.id === "outreach" ? prospect.messages.length
      : t.id === "notes" ? prospect.notes.length
      : t.id === "activity" ? prospect.activities.length
      : t.id === "competitors" ? prospect.competitors.length
      : undefined,
  }));

  const base = `/prospects/${prospect.id}`;

  return (
    <>
      <PageHeader
        title={b.name}
        description={[b.category, b.subcategory].filter(Boolean).join(" · ")}
        meta={
          <>
            <Badge tone="neutral">{STAGE_META[prospect.stage as PipelineStage]?.label ?? prospect.stage}</Badge>
            <span className="text-[12px] text-ink-3">
              {[b.area, b.city].filter(Boolean).join(", ")}
            </span>
            {b.rating != null ? (
              <span className="text-[12px] text-ink-3 tabular">
                {b.rating}★ · {b.reviewCount ?? 0} reviews
              </span>
            ) : null}
            {b.website ? (
              <a
                href={b.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-accent hover:underline underline-offset-2"
              >
                {hostOf(b.website)} ↗
              </a>
            ) : (
              <Badge tone="danger">No website</Badge>
            )}
            {b.isMock ? <MockBadge /> : null}
          </>
        }
        actions={
          <ProspectPrimaryActions
            prospectId={prospect.id}
            hasAudit={Boolean(audit && audit.status === "complete")}
            hasOpportunityAnalysis={Boolean(salesAngle)}
            projectId={project?.id ?? null}
            hasWebsite={Boolean(b.website)}
          />
        }
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-5 mb-5">
        <Panel className="px-3.5 py-3">
          <p className="label">Opportunity</p>
          <ScoreBadge score={prospect.opportunityScore} size="lg" />
          {opportunity ? (
            <p className="mt-1 text-[11.5px] text-ink-3 capitalize">{opportunity.tier.replace("-", " ")}</p>
          ) : null}
        </Panel>
        <Panel className="px-3.5 py-3">
          <p className="label">Website</p>
          <ScoreBadge score={prospect.websiteScore} size="lg" />
          <p className="mt-1 text-[11.5px] text-ink-3">
            {audit ? audit.engine : "Not audited"}
          </p>
        </Panel>
        <Panel className="px-3.5 py-3">
          <p className="label">Reach</p>
          <ScoreBadge score={prospect.contactabilityScore} size="lg" />
          <p className="mt-1 text-[11.5px] text-ink-3">
            {[b.phone && "phone", b.email && "email", b.instagram && "IG"].filter(Boolean).join(", ") || "none"}
          </p>
        </Panel>
        <Panel className="px-3.5 py-3">
          <p className="label">Estimated value</p>
          <p className="tabular mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.025em]">
            {formatCurrency(prospect.estimatedValue)}
          </p>
          <p className="mt-1.5 text-[11.5px] text-ink-3">From industry band and review volume</p>
        </Panel>
        <Panel className="px-3.5 py-3">
          <p className="label">Stage</p>
          <div className="mt-1.5">
            <StageSelect prospectId={prospect.id} stage={prospect.stage} />
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            {prospect.lastContactAt ? `Contacted ${relativeTime(prospect.lastContactAt)}` : "Not contacted"}
          </p>
        </Panel>
      </div>

      <QueryTabs basePath={base} current={tab} tabs={tabsWithCounts} />

      <div className="mt-5">
        {/* ------------------------------------------------------------- overview */}
        {tab === "overview" ? (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col gap-5">
              <Panel>
                <PanelHeader title="Business" />
                <dl className="px-4 py-3 text-[12.5px]">
                  {[
                    ["Category", b.category],
                    ["Subcategory", b.subcategory],
                    ["Address", b.address],
                    ["Area", b.area],
                    ["City", b.city],
                    ["Country", b.country],
                    ["Phone", b.phone],
                    ["Email", b.email],
                    ["Website", b.website],
                    ["Coordinates", b.lat && b.lng ? `${b.lat}, ${b.lng}` : null],
                    ["Discovered", `${formatDateTime(b.discoveredAt)} via ${b.source}`],
                    ["Campaign", prospect.campaign?.name ?? null],
                  ].map(([k, v]) => (
                    <div key={k as string} className="flex gap-4 py-1.5 border-b border-line last:border-0">
                      <dt className="text-ink-3 w-32 shrink-0">{k}</dt>
                      <dd className="text-ink-2 min-w-0 break-words">{(v as string) ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
              </Panel>

              {services.length ? (
                <Panel>
                  <PanelHeader title="Services on record" />
                  <ul className="px-4 py-3 flex flex-wrap gap-1.5">
                    {services.map((s) => (
                      <li key={s}>
                        <Badge tone="neutral">{s}</Badge>
                      </li>
                    ))}
                  </ul>
                </Panel>
              ) : null}

              {hours ? (
                <Panel>
                  <PanelHeader title="Opening hours" />
                  <dl className="px-4 py-3 text-[12.5px]">
                    {Object.entries(hours).map(([day, h]) => (
                      <div key={day} className="flex justify-between gap-4 py-1 border-b border-line last:border-0">
                        <dt className="text-ink-3">{day}</dt>
                        <dd className="tabular text-ink-2">{h}</dd>
                      </div>
                    ))}
                  </dl>
                </Panel>
              ) : null}
            </div>

            <div className="flex flex-col gap-5">
              <Panel>
                <PanelHeader title="Next actions" hint="Derived from this prospect's actual state." />
                {prospect.tasks.length === 0 ? (
                  <EmptyState title="Nothing outstanding" body="Actions appear as the workflow advances." />
                ) : (
                  <ul className="px-4 py-2">
                    {prospect.tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 py-1.5 text-[12.5px]">
                        <span className="size-1.5 rounded-full bg-ink-4 shrink-0" />
                        <span className="text-ink-2 flex-1">{t.title}</span>
                        <span className="text-[11px] text-ink-4">{t.dueAt ? relativeTime(t.dueAt) : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel>
                <PanelHeader title="Tags" />
                <div className="px-4 py-3">
                  <TagPicker
                    prospectId={prospect.id}
                    tags={allTags}
                    active={prospect.tags.map((t) => t.tagId)}
                  />
                </div>
              </Panel>

              <Panel>
                <PanelHeader title="Outreach guard rails" />
                <div className="px-4 py-3 flex flex-col gap-2.5">
                  <p className="text-[12px] text-ink-3 leading-relaxed">
                    Messages are never sent without an explicit approval step, and are only written
                    from observations recorded in the audit.
                  </p>
                  <OptOutButton prospectId={prospect.id} />
                </div>
              </Panel>
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------------------- presence */}
        {tab === "presence" ? (
          <div className="flex flex-col gap-5">
            <DigitalPresenceGrid
              channels={buildPresence({
                website: b.website,
                googleUrl: b.googleUrl,
                instagram: b.instagram,
                facebook: b.facebook,
                linkedin: b.linkedin,
                email: b.email,
                phone: b.phone,
                source: b.source,
              })}
            />

            {signals ? (
              <Panel>
                <PanelHeader
                  title="What the site actually contains"
                  hint="Observed during the audit, not inferred."
                />
                <SignalsPanel signals={signals} />
              </Panel>
            ) : (
              <Panel>
                <EmptyState
                  title="No page signals yet"
                  body="Run an audit to extract the document, conversion and accessibility signals from the live site."
                />
              </Panel>
            )}
          </div>
        ) : null}

        {/* ---------------------------------------------------------------- audit */}
        {tab === "audit" ? (
          <div className="flex flex-col gap-5">
            {!audit ? (
              <Panel>
                <EmptyState
                  title="Not audited yet"
                  body="The audit fetches the site once and derives technical, SEO, UX, performance and accessibility findings from the document."
                />
              </Panel>
            ) : audit.status === "failed" ? (
              <ErrorState
                title="The audit failed"
                message={audit.errorInfo?.message ?? "Unknown failure."}
                remedy={audit.errorInfo?.remedy ?? "Retry the audit."}
              />
            ) : (
              <>
                <AuditHeader
                  engine={audit.engine}
                  isMock={audit.isMock}
                  url={audit.url}
                  completedAt={audit.completedAt}
                  overall={audit.scoreOverall}
                />
                <Panel>
                  <PanelHeader title="Scores" hint="Every deduction below corresponds to a finding." />
                  <ScoreGrid
                    scores={[
                      { label: "Overall", value: audit.scoreOverall },
                      { label: "UX", value: audit.scoreUx },
                      { label: "SEO", value: audit.scoreSeo },
                      { label: "Performance", value: audit.scorePerformance },
                      { label: "Accessibility", value: audit.scoreAccessibility },
                      { label: "Best practices", value: audit.scoreBestPractices },
                    ]}
                  />
                </Panel>
                <Panel>
                  <PanelHeader
                    title="Findings"
                    hint={`${plural(audit.findings.length, "finding")} recorded, ordered by severity.`}
                  />
                  <FindingsList findings={audit.findings as unknown as FindingRow[]} />
                </Panel>
              </>
            )}
          </div>
        ) : null}

        {/* ---------------------------------------------------------- opportunity */}
        {tab === "opportunity" ? (
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <Panel>
              <PanelHeader
                title="Score breakdown"
                hint="Weighted factors. Weights are editable in Settings."
                actions={<ScoreBadge score={opportunity?.score ?? null} size="lg" />}
              />
              {!opportunity ? (
                <EmptyState title="Not scored yet" body="Scoring runs automatically after an audit." />
              ) : (
                <div className="px-4 py-3">
                  {Object.entries(opportunity.breakdown).map(([factor, v]) => (
                    <div key={factor} className="py-2 border-b border-line last:border-0">
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-[12.5px] text-ink font-medium flex-1">
                          {FACTOR_LABELS[factor as ScoringFactor] ?? factor}
                        </span>
                        <span className="tabular text-[11.5px] text-ink-3">
                          {v.raw} × {(v.weight * 100).toFixed(0)}%
                        </span>
                        <span className="tabular text-[12.5px] text-ink font-semibold w-10 text-right">
                          {v.weighted.toFixed(1)}
                        </span>
                      </div>
                      <Meter value={v.raw} tone={v.raw >= 60 ? "ok" : v.raw >= 35 ? "warn" : "danger"} />
                      <p className="mt-1.5 text-[11.5px] text-ink-3 leading-snug">{v.note}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <div className="flex flex-col gap-5">
              {opportunity?.labels.length ? (
                <Panel>
                  <PanelHeader title="Signals" />
                  <div className="px-4 py-3 flex flex-wrap gap-1.5">
                    {opportunity.labels.map((l) => (
                      <Badge key={l} tone="accent">
                        {l}
                      </Badge>
                    ))}
                  </div>
                </Panel>
              ) : null}

              <Panel>
                <PanelHeader
                  title="Sales angle"
                  hint={
                    opportunity?.generatedBy?.startsWith("mock")
                      ? "Composed from stored data — no model reasoned about this."
                      : opportunity?.generatedBy
                        ? `Generated by ${opportunity.generatedBy.replace("ai:", "")}`
                        : undefined
                  }
                />
                {!salesAngle ? (
                  <EmptyState
                    title="No sales angle yet"
                    body="Generate one from the header. It is grounded strictly in the audit findings and business data."
                  />
                ) : (
                  <div className="px-4 py-3 flex flex-col gap-3 text-[12.5px] leading-relaxed">
                    {[
                      ["Why this lead", salesAngle.whyThisLead],
                      ["What to pitch", salesAngle.whatToPitch],
                      ["Biggest problem", salesAngle.biggestProblem],
                      ["Suggested solution", salesAngle.suggestedSolution],
                      ["Estimated scope", salesAngle.estimatedScope],
                      ["Best opening line", salesAngle.openingLine],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <p className="label mb-0.5">{k}</p>
                        <p className="text-ink-2">{v}</p>
                      </div>
                    ))}

                    <div>
                      <p className="label mb-1">What not to say</p>
                      <ul className="flex flex-col gap-1">
                        {salesAngle.whatNotToSay.map((s) => (
                          <li key={s} className="text-ink-2 flex gap-2">
                            <span className="text-danger">×</span>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex flex-wrap gap-4 pt-1">
                      <div>
                        <p className="label mb-0.5">Suggested pricing</p>
                        <p className="tabular text-ink font-semibold">
                          {formatCurrency(salesAngle.suggestedPricing.low, salesAngle.suggestedPricing.currency)} –{" "}
                          {formatCurrency(salesAngle.suggestedPricing.high, salesAngle.suggestedPricing.currency)}
                        </p>
                        <p className="text-[11.5px] text-ink-3">{salesAngle.suggestedPricing.rationale}</p>
                      </div>
                      <div>
                        <p className="label mb-0.5">Channel</p>
                        <Badge tone="accent">{salesAngle.recommendedChannel}</Badge>
                      </div>
                    </div>

                    {salesAngle.groundedIn.length ? (
                      <div className="pt-1">
                        <p className="label mb-1">Grounded in</p>
                        <ul className="text-[11.5px] text-ink-3 flex flex-col gap-0.5">
                          {salesAngle.groundedIn.map((g) => (
                            <li key={g}>· {g}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        ) : null}

        {/* ---------------------------------------------------------- competitors */}
        {tab === "competitors" ? (
          <CompetitorCompare
            prospect={{
              name: b.name,
              rating: b.rating,
              reviewCount: b.reviewCount,
              websiteScore: prospect.websiteScore,
              hasWebsite: Boolean(b.website),
            }}
            competitors={prospect.competitors.map((c) => ({
              id: c.id,
              name: c.name,
              website: c.website,
              rating: c.rating,
              reviewCount: c.reviewCount,
              websiteScore: c.websiteScore,
              verified: c.verified,
            }))}
          />
        ) : null}

        {/* ------------------------------------------------------------- concept */}
        {tab === "concept" ? (
          <Panel>
            <PanelHeader
              title="Website concept"
              hint={brief ? `Generated by ${brief.generatedBy}` : undefined}
              actions={
                project ? (
                  <Link
                    href={`/studio/${project.id}`}
                    className="text-[12px] text-accent hover:underline underline-offset-2"
                  >
                    Open in Website Studio →
                  </Link>
                ) : null
              }
            />
            {!brief ? (
              <EmptyState
                title="No concept yet"
                body="Create a website concept from the header. The brief is editable before anything is built."
              />
            ) : (
              <div className="px-4 py-4 grid gap-4 lg:grid-cols-2 text-[12.5px] leading-relaxed">
                {[
                  ["Positioning", brief.positioning],
                  ["Target audience", brief.targetAudience],
                  ["Primary goal", brief.primaryGoal],
                  ["Design style", brief.designStyle],
                  ["Colour direction", brief.colorDirection],
                  ["Typography", brief.typographyDirection],
                  ["CTA strategy", brief.ctaStrategy],
                  ["Content strategy", brief.contentStrategy],
                  ["SEO strategy", brief.seoStrategy],
                  ["Mobile strategy", brief.mobileStrategy],
                  ["Animation", brief.animationDirection],
                  ["Social proof", brief.socialProof],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="label mb-0.5">{k}</p>
                    <p className="text-ink-2">{v || "—"}</p>
                  </div>
                ))}

                <div className="lg:col-span-2">
                  <p className="label mb-1.5">Pages</p>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {brief.pages.map((p) => (
                      <li key={p.name} className="border border-line rounded-[3px] p-2.5">
                        <p className="text-[12.5px] font-medium text-ink">{p.name}</p>
                        <p className="text-[11.5px] text-ink-3 mt-0.5">{p.purpose}</p>
                        {p.sections.length ? (
                          <p className="text-[11px] text-ink-4 mt-1">{p.sections.join(" · ")}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>

                {brief.requiresClientInput.length ? (
                  <div className="lg:col-span-2">
                    <InfoNote tone="warn">
                      <strong className="font-semibold">Needs the client before launch.</strong> These
                      facts are unknown and will render as visible placeholders rather than invented
                      copy: {brief.requiresClientInput.join("; ")}.
                    </InfoNote>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        ) : null}

        {/* ------------------------------------------------------------ outreach */}
        {tab === "outreach" ? (
          <div className="flex flex-col gap-5">
            <Panel>
              <PanelHeader
                title="Draft a message"
                hint="Every draft is written only from observations recorded in the audit."
              />
              <div className="px-4 py-3 flex flex-wrap items-center gap-3">
                <DraftOutreachControls
                  prospectId={prospect.id}
                  canDraft={Boolean(audit && audit.status === "complete")}
                />
                <SequenceButton
                  prospectId={prospect.id}
                  channel={b.email ? "email" : "whatsapp"}
                  disabled={!audit || audit.status !== "complete"}
                  disabledReason="Run the audit first — drafts are grounded in recorded observations."
                />
              </div>
            </Panel>

            {prospect.messages.length === 0 ? (
              <Panel>
                <EmptyState title="No messages yet" body="Drafts appear here for review before anything is sent." />
              </Panel>
            ) : (
              prospect.messages.map((m) => (
                <Panel key={m.id}>
                  <PanelHeader
                    title={
                      <span className="flex items-center gap-2">
                        {m.subject ?? `${m.variant} ${m.channel}`}
                        <Badge tone={m.status === "sent" ? "ok" : m.status === "draft" ? "warn" : "neutral"}>
                          {m.status}
                        </Badge>
                        {m.provider === "mock" ? <MockBadge what="composed" /> : null}
                      </span>
                    }
                    hint={`${m.channel} · ${m.variant} · ${formatDateTime(m.createdAt)}`}
                  />
                  <pre className="px-4 py-3 whitespace-pre-wrap font-sans text-[12.5px] text-ink-2 leading-relaxed">
                    {m.body}
                  </pre>
                  <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                    {fromJson<string[]>(m.observationsJson, []).map((o) => (
                      <Badge key={o} tone="neutral" title="Observation this message was grounded in">
                        {o.length > 60 ? `${o.slice(0, 57)}…` : o}
                      </Badge>
                    ))}
                  </div>
                  {m.events.length ? (
                    <ul className="px-4 pb-3 text-[11.5px] text-ink-3">
                      {m.events.map((e) => (
                        <li key={e.id}>
                          {formatDateTime(e.at)} — {e.type}
                          {e.detail ? `: ${e.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Panel>
              ))
            )}
          </div>
        ) : null}

        {/* ------------------------------------------------------------ activity */}
        {tab === "activity" ? (
          <Panel>
            <PanelHeader title="Activity" hint="The chronological record of everything that happened." />
            {prospect.activities.length === 0 ? (
              <EmptyState title="Nothing recorded" body="Activity accrues as the prospect moves through the workflow." />
            ) : (
              <ol className="px-4 py-3">
                {prospect.activities.map((a) => (
                  <li key={a.id} className="flex gap-3 py-1.5 text-[12.5px] border-b border-line last:border-0">
                    <time className="tabular text-ink-4 shrink-0 w-32" dateTime={a.at.toISOString()}>
                      {formatDateTime(a.at)}
                    </time>
                    <span className="text-ink-2">{a.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        ) : null}

        {/* --------------------------------------------------------------- notes */}
        {tab === "notes" ? (
          <Panel>
            <PanelHeader title="Notes" />
            {prospect.notes.length === 0 ? (
              <EmptyState title="No notes yet" body="Anything you record here is searchable from the command palette." />
            ) : (
              <ul>
                {prospect.notes.map((n) => (
                  <li key={n.id} className="px-4 py-3 border-b border-line last:border-0">
                    <p className="text-[12.5px] text-ink-2 whitespace-pre-wrap leading-relaxed">{n.body}</p>
                    <p className="mt-1 text-[11px] text-ink-4">
                      {n.author?.name ?? "Unknown"} · {formatDateTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <NoteComposer prospectId={prospect.id} />
          </Panel>
        ) : null}
      </div>
    </>
  );
}
