import { Suspense } from "react";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import {
  listProspects,
  parseFilters,
  type ProspectFilters,
  type ProspectSort,
} from "@/services/prospects";
import { PageHeader, Panel, SkeletonTable } from "@/components/ui/primitives";
import { ProspectTable, type ViewMode } from "@/components/features/ProspectTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Prospects" };

const SORTS: ProspectSort[] = [
  "opportunity",
  "website",
  "rating",
  "reviews",
  "name",
  "recent",
  "value",
];

export default async function ProspectsPage({ searchParams }: PageProps<"/prospects">) {
  const sp = await searchParams;
  const { workspaceId } = await getWorkspaceContext();

  const filters = parseFilters(sp);
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };

  const sortParam = one("sort");
  const sort: ProspectSort = SORTS.includes(sortParam as ProspectSort)
    ? (sortParam as ProspectSort)
    : "opportunity";
  const viewParam = one("view");
  const view: ViewMode =
    viewParam === "cards" || viewParam === "board" ? viewParam : "table";
  const page = Math.max(1, Number.parseInt(one("page") ?? "1", 10) || 1);

  const [result, tags, campaigns, views, mockCount] = await Promise.all([
    listProspects(workspaceId, { filters, sort, page, pageSize: 50 }),
    prisma.tag.findMany({ where: { workspaceId }, orderBy: { name: "asc" } }),
    prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true },
    }),
    prisma.savedView.findMany({ where: { workspaceId, scope: "prospects" } }),
    prisma.prospect.count({ where: { workspaceId, business: { isMock: true } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Prospects"
        description={`${result.total} business${result.total === 1 ? "" : "es"} on file${
          mockCount ? ` · ${mockCount} are demo records` : ""
        }. Filters and sorting run in the database, so only one page is ever loaded.`}
      />
      <Suspense
        fallback={
          <Panel>
            <SkeletonTable rows={10} cols={7} />
          </Panel>
        }
      >
        <ProspectTable
          rows={result.rows}
          total={result.total}
          page={result.page}
          pageCount={result.pageCount}
          filters={filters}
          sort={sort}
          view={view}
          tags={tags}
          campaigns={campaigns}
          savedViews={views.map((v) => ({
            id: v.id,
            name: v.name,
            config: fromJson<Partial<ProspectFilters>>(v.configJson, {}),
          }))}
        />
      </Suspense>
    </>
  );
}
