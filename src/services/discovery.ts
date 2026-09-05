import { prisma } from "@/db/client";
import { AppError, toAppError } from "@/lib/errors";
import { toJson } from "@/lib/json";
import { startJob } from "@/lib/logger";
import { dedupeKey, normaliseUrl } from "@/lib/utils";
import { getBusinessDataProvider } from "@/providers/business-data";
import type { BusinessRecord, DiscoveryQuery } from "@/types";
import { logActivity, notify } from "./activity";
import { auditMany } from "./audit";
import { getSettings } from "./settings";

/**
 * Campaign runner: DISCOVER -> DEDUPE -> PERSIST -> (optionally) AUDIT.
 *
 * Counters on the Campaign row are incremented from real work only. If the
 * provider returns nothing, the campaign completes with zero and says so; it
 * never reports progress it did not make.
 */

export type CampaignInput = {
  name: string;
  category: string;
  country: string;
  city: string;
  area?: string | null;
  targetCount: number;
  minRating?: number | null;
  minReviews?: number | null;
  websiteFilter: "any" | "none" | "poor" | "good";
  keywords?: string | null;
  autoAudit: boolean;
};

export async function createCampaign(workspaceId: string, input: CampaignInput) {
  const settings = await getSettings(workspaceId);
  const provider = getBusinessDataProvider(settings.discoveryProvider);

  if (input.targetCount < 1 || input.targetCount > 200) {
    throw new AppError({
      kind: "invalid-input",
      message: "Prospect count must be between 1 and 200.",
      remedy: "Lower the target and run the campaign again.",
    });
  }

  return prisma.campaign.create({
    data: {
      workspaceId,
      name: input.name.trim() || `${input.category} — ${input.city}`,
      category: input.category,
      country: input.country,
      city: input.city,
      area: input.area ?? null,
      targetCount: input.targetCount,
      minRating: input.minRating ?? null,
      minReviews: input.minReviews ?? null,
      websiteFilter: input.websiteFilter,
      keywords: input.keywords ?? null,
      provider: provider.id,
      isMock: provider.isMock,
      status: "draft",
    },
  });
}

export type CampaignProgress = {
  campaignId: string;
  status: string;
  discovered: number;
  duplicates: number;
  enriched: number;
  audited: number;
  target: number;
  isMock: boolean;
  providerId: string;
  error: string | null;
};

export async function runCampaign(
  workspaceId: string,
  campaignId: string,
  opts: { autoAudit?: boolean } = {},
): Promise<CampaignProgress> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, workspaceId },
  });
  if (!campaign) {
    throw new AppError({
      kind: "not-found",
      message: "Campaign not found.",
      remedy: "Refresh the campaign list.",
    });
  }
  if (campaign.status === "running") {
    throw new AppError({
      kind: "conflict",
      message: "This campaign is already running.",
      remedy: "Wait for it to finish, or reload to see current progress.",
    });
  }

  const provider = getBusinessDataProvider(campaign.provider);
  const log = startJob("discovery.run", {
    campaignId,
    provider: provider.id,
    target: campaign.targetCount,
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "running", startedAt: new Date(), error: null },
  });

  const query: DiscoveryQuery = {
    category: campaign.category,
    country: campaign.country,
    city: campaign.city,
    area: campaign.area,
    limit: campaign.targetCount,
    minRating: campaign.minRating,
    minReviews: campaign.minReviews,
    websiteFilter: campaign.websiteFilter as DiscoveryQuery["websiteFilter"],
    keywords: campaign.keywords,
  };

  let discovered = 0;
  let duplicates = 0;
  const createdProspectIds: string[] = [];

  try {
    let cursor: string | null = null;
    let pages = 0;

    while (discovered < campaign.targetCount && pages < 12) {
      const remaining = campaign.targetCount - discovered;
      const result = await provider.search({ ...query, limit: remaining, cursor });
      pages++;

      if (result.records.length === 0) break;

      for (const record of result.records) {
        if (discovered >= campaign.targetCount) break;
        const outcome = await persistRecord(workspaceId, campaignId, record, provider.id, provider.isMock);
        if (outcome === "duplicate") duplicates++;
        else {
          discovered++;
          createdProspectIds.push(outcome);
        }
      }

      await prisma.campaign.update({
        where: { id: campaignId },
        data: { discovered, duplicates, enriched: discovered },
      });

      cursor = result.nextCursor;
      if (!cursor) break;
    }

    let audited = 0;
    if (opts.autoAudit && createdProspectIds.length) {
      const res = await auditMany(workspaceId, createdProspectIds, async (done) => {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: { audited: done },
        });
      });
      audited = res.completed;
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "completed",
        discovered,
        duplicates,
        enriched: discovered,
        audited,
        completedAt: new Date(),
      },
    });

    await logActivity({
      workspaceId,
      type: "prospect.discovered",
      message: `Campaign "${campaign.name}" found ${discovered} new prospect${discovered === 1 ? "" : "s"}${
        duplicates ? ` (${duplicates} already on file)` : ""
      }.`,
      meta: { campaignId, provider: provider.id, isMock: provider.isMock },
    });

    await notify({
      workspaceId,
      type: "campaign.completed",
      title: `${campaign.name}: ${discovered} prospects`,
      body: provider.isMock
        ? "Demo data — no external service was called."
        : `Discovered via ${provider.label}.`,
      level: discovered > 0 ? "success" : "warning",
      link: `/discover/${campaignId}`,
    });

    log.done({ discovered, duplicates, audited });

    return {
      campaignId,
      status: "completed",
      discovered,
      duplicates,
      enriched: discovered,
      audited,
      target: campaign.targetCount,
      isMock: provider.isMock,
      providerId: provider.id,
      error: null,
    };
  } catch (e) {
    const err = toAppError(e, "Retry the campaign.");
    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: "failed",
        error: toJson(err.toJSON()),
        discovered,
        duplicates,
        completedAt: new Date(),
      },
    });
    await notify({
      workspaceId,
      type: "campaign.failed",
      title: `Campaign failed: ${campaign.name}`,
      body: `${err.message} ${err.remedy}`,
      level: "error",
      link: `/discover/${campaignId}`,
    });
    log.fail(err);
    throw err;
  }
}

/** Returns the new prospect id, or "duplicate". */
async function persistRecord(
  workspaceId: string,
  campaignId: string,
  record: BusinessRecord,
  source: string,
  isMock: boolean,
): Promise<string | "duplicate"> {
  const key = dedupeKey({
    name: record.name,
    city: record.city,
    phone: record.phone,
    website: record.website,
  });

  const existing = await prisma.business.findUnique({
    where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: key } },
    select: { id: true },
  });
  if (existing) return "duplicate";

  const business = await prisma.business.create({
    data: {
      workspaceId,
      campaignId,
      name: record.name,
      category: record.category,
      subcategory: record.subcategory ?? null,
      description: record.description ?? null,
      address: record.address ?? null,
      city: record.city,
      area: record.area ?? null,
      country: record.country,
      lat: record.lat ?? null,
      lng: record.lng ?? null,
      phone: record.phone ?? null,
      email: record.email ?? null,
      website: normaliseUrl(record.website),
      googleUrl: record.googleUrl ?? null,
      instagram: record.instagram ?? null,
      facebook: record.facebook ?? null,
      linkedin: record.linkedin ?? null,
      rating: record.rating ?? null,
      reviewCount: record.reviewCount ?? null,
      hoursJson: record.hours ? toJson(record.hours) : null,
      servicesJson: record.services ? toJson(record.services) : null,
      imagesJson: record.images ? toJson(record.images) : null,
      logoUrl: record.logoUrl ?? null,
      source,
      isMock,
      externalId: record.externalId ?? null,
      dedupeKey: key,
    },
  });

  const prospect = await prisma.prospect.create({
    data: {
      workspaceId,
      businessId: business.id,
      campaignId,
      stage: "discovered",
      leadSource: source,
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId,
      prospectId: prospect.id,
      type: "prospect.discovered",
      message: `${record.name} discovered via ${source}${isMock ? " (demo data)" : ""}.`,
      metaJson: toJson({ campaignId, source, isMock }),
    },
  });

  return prospect.id;
}

export async function campaignProgress(
  workspaceId: string,
  campaignId: string,
): Promise<CampaignProgress | null> {
  const c = await prisma.campaign.findFirst({ where: { id: campaignId, workspaceId } });
  if (!c) return null;
  return {
    campaignId: c.id,
    status: c.status,
    discovered: c.discovered,
    duplicates: c.duplicates,
    enriched: c.enriched,
    audited: c.audited,
    target: c.targetCount,
    isMock: c.isMock,
    providerId: c.provider,
    error: c.error,
  };
}
