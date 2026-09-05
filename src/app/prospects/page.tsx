import { Suspense } from "react";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import type { PipelineStage } from "@/config/pipeline";
import { PageHeader, Panel } from "@/components/ui/primitives";
import {
  ProspectTable,
  type ProspectRow,
  type SavedViewRow,
} from "@/components/features/ProspectTable";

export const dynamic = "force-dynamic";

export default async function ProspectsPage() {
  const { workspaceId } = await getWorkspaceContext();

  const [prospects, tags, views] = await Promise.all([
    prisma.prospect.findMany({
      where: { workspaceId },
      include: {
        business: true,
        tags: { include: { tag: true } },
        audits: {
          where: { status: "complete" },
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { scoreUx: true, scoreSeo: true, scorePerformance: true },
        },
        tasks: {
          where: { status: "open" },
          orderBy: { dueAt: "asc" },
          take: 1,
          select: { title: true },
        },
      },
      orderBy: { opportunityScore: "desc" },
    }),
    prisma.tag.findMany({ where: { workspaceId }, orderBy: { name: "asc" } }),
    prisma.savedView.findMany({ where: { workspaceId, scope: "prospects" } }),
  ]);

  const rows: ProspectRow[] = prospects.map((p) => ({
    id: p.id,
    name: p.business.name,
    category: p.business.category,
    city: p.business.city,
    area: p.business.area,
    rating: p.business.rating,
    reviewCount: p.business.reviewCount,
    website: p.business.website,
    websiteScore: p.websiteScore,
    mobileScore: p.audits[0]?.scoreUx ?? null,
    seoScore: p.audits[0]?.scoreSeo ?? null,
    performanceScore: p.audits[0]?.scorePerformance ?? null,
    opportunityScore: p.opportunityScore,
    contactability: p.contactabilityScore,
    stage: p.stage as PipelineStage,
    estimatedValue: p.estimatedValue,
    lastContactAt: p.lastContactAt?.toISOString() ?? null,
    nextAction: p.tasks[0]?.title ?? null,
    tags: p.tags.map((t) => t.tag.name),
    hasEmail: Boolean(p.business.email),
    hasPhone: Boolean(p.business.phone),
    hasInstagram: Boolean(p.business.instagram),
    isMock: p.business.isMock,
    discoveredAt: p.business.discoveredAt.toISOString(),
  }));

  const savedViews: SavedViewRow[] = views.map((v) => ({
    id: v.id,
    name: v.name,
    config: fromJson(v.configJson, {}),
  }));

  const mockCount = rows.filter((r) => r.isMock).length;

  return (
    <>
      <PageHeader
        title="Prospects"
        description={`${rows.length} business${rows.length === 1 ? "" : "es"} on file${
          mockCount ? ` · ${mockCount} are demo records` : ""
        }. Sort, filter and act in bulk.`}
      />
      <Suspense fallback={<Panel className="h-64" />}>
        <ProspectTable rows={rows} tags={tags} savedViews={savedViews} />
      </Suspense>
    </>
  );
}
