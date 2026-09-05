import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fail, ok, paging } from "@/lib/api";
import { fromJson } from "@/lib/json";

/**
 * GET /api/campaigns
 *
 * Campaign list with live counters. Progress here is what actually completed,
 * never an animation: `discovered` only moves when a row was written.
 */
export async function GET(request: Request) {
  try {
    const { workspaceId } = await getWorkspaceContext();
    const url = new URL(request.url);
    const { page, pageSize } = paging(url, 25);

    const [total, campaigns] = await Promise.all([
      prisma.campaign.count({ where: { workspaceId } }),
      prisma.campaign.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return ok({
      total,
      page,
      pageSize,
      campaigns: campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        provider: c.provider,
        isMock: c.isMock,
        query: {
          category: c.category,
          city: c.city,
          area: c.area,
          country: c.country,
          minRating: c.minRating,
          minReviews: c.minReviews,
          websiteFilter: c.websiteFilter,
          keywords: c.keywords,
        },
        progress: {
          target: c.targetCount,
          discovered: c.discovered,
          duplicates: c.duplicates,
          enriched: c.enriched,
          audited: c.audited,
        },
        error: fromJson<{ message: string; remedy: string } | null>(c.error, null),
        startedAt: c.startedAt?.toISOString() ?? null,
        completedAt: c.completedAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
