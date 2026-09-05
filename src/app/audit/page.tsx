import Link from "next/link";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime, hostOf, plural, relativeTime } from "@/lib/utils";
import { auditProviderHealth } from "@/providers/audit";
import { QueryTabs } from "@/components/ui/Tabs";
import { AuditQueueActions } from "@/components/features/AuditQueueActions";
import {
  Badge,
  EmptyState,
  InfoNote,
  MockBadge,
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

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const sp = await searchParams;
  const status = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? "all";
  const { workspaceId } = await getWorkspaceContext();

  const [pending, completed, failed, findingsBySeverity] = await Promise.all([
    prisma.prospect.findMany({
      where: { workspaceId, websiteScore: null },
      include: { business: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.websiteAudit.findMany({
      where: { prospect: { workspaceId }, status: "complete" },
      include: { prospect: { include: { business: true } }, _count: { select: { findings: true } } },
      orderBy: { completedAt: "desc" },
      take: 100,
    }),
    prisma.websiteAudit.findMany({
      where: { prospect: { workspaceId }, status: "failed" },
      include: { prospect: { include: { business: true } } },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    prisma.auditFinding.groupBy({
      by: ["severity"],
      where: { audit: { prospect: { workspaceId }, status: "complete" } },
      _count: { _all: true },
    }),
  ]);

  const severity = Object.fromEntries(
    findingsBySeverity.map((f) => [f.severity, f._count._all]),
  ) as Record<string, number>;

  const providers = auditProviderHealth();
  const usingLighthouse = providers.find((p) => p.id === "lighthouse-psi")?.configured;

  const tabs = [
    { id: "all", label: "Overview" },
    { id: "pending", label: "Queue", count: pending.length },
    { id: "complete", label: "Completed", count: completed.length },
    { id: "failed", label: "Failed", count: failed.length },
  ];

  return (
    <>
      <PageHeader
        title="Audit Center"
        description="One real HTTP request per site, parsed into technical, SEO, UX, performance and accessibility findings. Every deduction maps to a finding you can read."
        meta={
          usingLighthouse ? (
            <Badge tone="ok">Lighthouse enabled</Badge>
          ) : (
            <Badge tone="neutral">Built-in extractor · set PAGESPEED_API_KEY for Core Web Vitals</Badge>
          )
        }
        actions={<AuditQueueActions prospectIds={pending.map((p) => p.id)} />}
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-5">
        <StatTile label="Awaiting audit" value={pending.length} tone={pending.length ? "warn" : undefined} />
        <StatTile label="Completed" value={completed.length} tone="ok" />
        <StatTile label="Failed" value={failed.length} tone={failed.length ? "danger" : undefined} />
        <StatTile label="Critical findings" value={severity.critical ?? 0} tone="danger" />
        <StatTile label="High findings" value={severity.high ?? 0} tone="warn" />
        <StatTile label="Medium findings" value={severity.medium ?? 0} />
      </div>

      <QueryTabs basePath="/audit" param="status" current={status} tabs={tabs} />

      <div className="mt-5">
        {status === "all" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Audit engines" hint="Chosen per URL. Demo hostnames cannot be fetched." />
              <ul>
                {providers.map((p) => (
                  <li key={p.id} className="px-4 py-3 border-b border-line last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[12.5px] font-medium text-ink">{p.label}</span>
                      {p.isMock ? <MockBadge what="mock" /> : null}
                      <Badge tone={p.configured ? "ok" : "neutral"} className="ml-auto">
                        {p.configured ? "available" : "not configured"}
                      </Badge>
                    </div>
                    <p className="text-[11.5px] text-ink-3 leading-relaxed">{p.setupHint}</p>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel>
              <PanelHeader title="Recently audited" />
              {completed.length === 0 ? (
                <EmptyState title="Nothing audited yet" body="Select prospects in the queue and run an audit." />
              ) : (
                <ul>
                  {completed.slice(0, 10).map((a) => (
                    <li key={a.id} className="px-4 py-2.5 border-b border-line last:border-0 flex items-center gap-3">
                      <Link
                        href={`/prospects/${a.prospectId}?tab=audit`}
                        className="min-w-0 flex-1 text-[12.5px] text-ink hover:text-accent truncate"
                      >
                        {a.prospect.business.name}
                      </Link>
                      <span className="text-[11px] text-ink-4">{plural(a._count.findings, "finding")}</span>
                      <ScoreBadge score={a.scoreOverall} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        ) : null}

        {status === "pending" ? (
          <Panel>
            <PanelHeader title="Audit queue" hint="Prospects with no completed audit." />
            {pending.length === 0 ? (
              <EmptyState title="Queue is empty" body="Everything on file has been audited." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Business</Th>
                    <Th>Website</Th>
                    <Th>Category</Th>
                    <Th>Discovered</Th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-2 transition-colors">
                      <Td>
                        <Link href={`/prospects/${p.id}`} className="text-ink font-medium hover:text-accent">
                          {p.business.name}
                        </Link>
                      </Td>
                      <Td className="text-ink-3">
                        {p.business.website ? hostOf(p.business.website) : <Badge tone="danger">None</Badge>}
                      </Td>
                      <Td className="text-ink-3">{p.business.category}</Td>
                      <Td className="text-ink-3">{relativeTime(p.business.discoveredAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        ) : null}

        {status === "complete" ? (
          <Panel>
            <PanelHeader title="Completed audits" />
            <Table>
              <thead>
                <tr>
                  <Th>Business</Th>
                  <Th>Engine</Th>
                  <Th className="text-right">Overall</Th>
                  <Th className="text-right">UX</Th>
                  <Th className="text-right">SEO</Th>
                  <Th className="text-right">Perf</Th>
                  <Th className="text-right">A11y</Th>
                  <Th className="text-right">Findings</Th>
                  <Th>Completed</Th>
                </tr>
              </thead>
              <tbody>
                {completed.map((a) => (
                  <tr key={a.id} className="hover:bg-surface-2 transition-colors">
                    <Td>
                      <Link href={`/prospects/${a.prospectId}?tab=audit`} className="text-ink font-medium hover:text-accent">
                        {a.prospect.business.name}
                      </Link>
                    </Td>
                    <Td className="text-ink-3">
                      {a.isMock ? <MockBadge what={a.engine} /> : a.engine}
                    </Td>
                    <Td className="text-right"><ScoreBadge score={a.scoreOverall} /></Td>
                    <Td className="tabular text-right">{a.scoreUx ?? "—"}</Td>
                    <Td className="tabular text-right">{a.scoreSeo ?? "—"}</Td>
                    <Td className="tabular text-right">{a.scorePerformance ?? "—"}</Td>
                    <Td className="tabular text-right">{a.scoreAccessibility ?? "—"}</Td>
                    <Td className="tabular text-right">{a._count.findings}</Td>
                    <Td className="text-ink-3">{a.completedAt ? relativeTime(a.completedAt) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        ) : null}

        {status === "failed" ? (
          <Panel>
            <PanelHeader title="Failed audits" hint="Each records why it failed and what to do about it." />
            {failed.length === 0 ? (
              <EmptyState title="No failures" body="Every audit attempted so far completed." />
            ) : (
              <ul>
                {failed.map((a) => {
                  const err = fromJson<{ message: string; remedy: string; kind: string } | null>(a.error, null);
                  return (
                    <li key={a.id} className="px-4 py-3 border-b border-line last:border-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Link href={`/prospects/${a.prospectId}?tab=audit`} className="text-[12.5px] font-medium text-ink hover:text-accent">
                          {a.prospect.business.name}
                        </Link>
                        <Badge tone="danger">{err?.kind ?? "failed"}</Badge>
                        <span className="ml-auto text-[11px] text-ink-4">{formatDateTime(a.startedAt)}</span>
                      </div>
                      <p className="text-[12px] text-ink-2">{err?.message ?? "Unknown failure."}</p>
                      {err?.remedy ? <p className="text-[11.5px] text-ink-3 mt-0.5">{err.remedy}</p> : null}
                      <p className="text-[11px] text-ink-4 mt-1">{a.url}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        ) : null}
      </div>

      {status === "all" ? (
        <div className="mt-5">
          <InfoNote>
            Scores measure what a machine can observe in the document: structure, metadata,
            conversion paths and accessibility. They are not a judgement of visual design — that
            requires the visual review, which needs a headless browser and a vision-capable model.
          </InfoNote>
        </div>
      ) : null}
    </>
  );
}
