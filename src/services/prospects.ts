import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/db/client";
import type { PipelineStage } from "@/config/pipeline";

/**
 * Prospect querying.
 *
 * Filtering, sorting and paging all happen in the database. Loading every
 * prospect into the browser works fine at thirty and falls over at three
 * thousand, and the failure mode is a frozen tab rather than an error, so it
 * is worth doing properly from the start.
 */

export type ProspectFilters = {
  q: string;
  website: "all" | "has" | "none" | "poor" | "good";
  score: "all" | "high" | "medium" | "weak";
  stage: "all" | PipelineStage;
  contact: "all" | "email" | "phone" | "instagram";
  recency: "all" | "7d" | "30d";
  tag: string;
  campaign: string;
};

export const EMPTY_FILTERS: ProspectFilters = {
  q: "",
  website: "all",
  score: "all",
  stage: "all",
  contact: "all",
  recency: "all",
  tag: "all",
  campaign: "all",
};

export type ProspectSort =
  | "opportunity"
  | "website"
  | "rating"
  | "reviews"
  | "name"
  | "recent"
  | "value";

export type ProspectRow = {
  id: string;
  name: string;
  category: string;
  city: string;
  area: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  websiteScore: number | null;
  mobileScore: number | null;
  seoScore: number | null;
  performanceScore: number | null;
  opportunityScore: number | null;
  contactability: number | null;
  stage: PipelineStage;
  estimatedValue: number | null;
  lastContactAt: string | null;
  nextAction: string | null;
  tags: string[];
  hasEmail: boolean;
  hasPhone: boolean;
  hasInstagram: boolean;
  isMock: boolean;
  discoveredAt: string;
};

export type ProspectPage = {
  rows: ProspectRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export function parseFilters(sp: Record<string, string | string[] | undefined>): ProspectFilters {
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? undefined;
  };
  return {
    q: get("q") ?? "",
    website: (get("website") as ProspectFilters["website"]) ?? "all",
    score: (get("score") as ProspectFilters["score"]) ?? "all",
    stage: (get("stage") as ProspectFilters["stage"]) ?? "all",
    contact: (get("contact") as ProspectFilters["contact"]) ?? "all",
    recency: (get("recency") as ProspectFilters["recency"]) ?? "all",
    tag: get("tag") ?? "all",
    campaign: get("campaign") ?? "all",
  };
}

function buildWhere(
  workspaceId: string,
  f: ProspectFilters,
  now: Date,
): Prisma.ProspectWhereInput {
  const where: Prisma.ProspectWhereInput = { workspaceId };
  const business: Prisma.BusinessWhereInput = {};
  const and: Prisma.ProspectWhereInput[] = [];

  if (f.q.trim()) {
    const q = f.q.trim();
    and.push({
      OR: [
        { business: { name: { contains: q } } },
        { business: { category: { contains: q } } },
        { business: { area: { contains: q } } },
        { business: { city: { contains: q } } },
        { tags: { some: { tag: { name: { contains: q } } } } },
      ],
    });
  }

  if (f.website === "has") business.website = { not: null };
  if (f.website === "none") business.website = null;
  if (f.website === "poor") where.websiteScore = { lt: 55 };
  if (f.website === "good") where.websiteScore = { gte: 70 };

  if (f.score === "high") where.opportunityScore = { gte: 70 };
  if (f.score === "medium") where.opportunityScore = { gte: 45, lt: 70 };
  if (f.score === "weak") where.opportunityScore = { lt: 45 };

  if (f.stage !== "all") where.stage = f.stage;
  if (f.campaign !== "all") where.campaignId = f.campaign;

  if (f.contact === "email") business.email = { not: null };
  if (f.contact === "phone") business.phone = { not: null };
  if (f.contact === "instagram") business.instagram = { not: null };

  if (f.recency !== "all") {
    const days = f.recency === "7d" ? 7 : 30;
    business.discoveredAt = { gte: new Date(now.getTime() - days * 86_400_000) };
  }

  if (f.tag !== "all") and.push({ tags: { some: { tag: { name: f.tag } } } });

  if (Object.keys(business).length) where.business = business;
  if (and.length) where.AND = and;

  return where;
}

function buildOrder(sort: ProspectSort): Prisma.ProspectOrderByWithRelationInput[] {
  switch (sort) {
    case "website":
      return [{ websiteScore: "asc" }, { opportunityScore: "desc" }];
    case "rating":
      return [{ business: { rating: "desc" } }];
    case "reviews":
      return [{ business: { reviewCount: "desc" } }];
    case "name":
      return [{ business: { name: "asc" } }];
    case "recent":
      return [{ createdAt: "desc" }];
    case "value":
      return [{ estimatedValue: "desc" }];
    default:
      return [{ opportunityScore: "desc" }, { createdAt: "desc" }];
  }
}

export async function listProspects(
  workspaceId: string,
  opts: {
    filters: ProspectFilters;
    sort?: ProspectSort;
    page?: number;
    pageSize?: number;
  },
): Promise<ProspectPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, opts.pageSize ?? 50));
  const where = buildWhere(workspaceId, opts.filters, new Date());

  const [total, prospects] = await Promise.all([
    prisma.prospect.count({ where }),
    prisma.prospect.findMany({
      where,
      orderBy: buildOrder(opts.sort ?? "opportunity"),
      skip: (page - 1) * pageSize,
      take: pageSize,
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
    }),
  ]);

  return {
    rows: prospects.map((p) => ({
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
    })),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Ids matching the current filter, for "select all across pages". */
export async function prospectIdsMatching(
  workspaceId: string,
  filters: ProspectFilters,
  limit = 500,
): Promise<string[]> {
  const rows = await prisma.prospect.findMany({
    where: buildWhere(workspaceId, filters, new Date()),
    select: { id: true },
    take: limit,
  });
  return rows.map((r) => r.id);
}
