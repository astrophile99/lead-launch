import { appConfig } from "@/config/app";
import { AppError, notConfigured, toAppError } from "@/lib/errors";
import { normaliseUrl } from "@/lib/utils";
import type { BusinessRecord, DiscoveryQuery, DiscoveryResult } from "@/types";
import type { BusinessDataProvider, ProviderHealth } from "./types";

/**
 * Google Places API (New) adapter - Text Search.
 *
 * Only fields that Places exposes are populated; anything Places does not
 * return (email, Instagram, services) is left null rather than guessed. The
 * enrichment step may fill those in later from the business's own website.
 *
 * This adapter respects the Places terms: it queries the official API with a
 * key, does not scrape google.com, and does not cache beyond what the product
 * needs to operate on the user's own prospect list.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.googleMapsUri",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.regularOpeningHours.weekdayDescriptions",
  "places.editorialSummary",
  "nextPageToken",
].join(",");

type PlacesResponse = {
  places?: {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    rating?: number;
    userRatingCount?: number;
    websiteUri?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    googleMapsUri?: string;
    primaryTypeDisplayName?: { text?: string };
    types?: string[];
    regularOpeningHours?: { weekdayDescriptions?: string[] };
    editorialSummary?: { text?: string };
  }[];
  nextPageToken?: string;
  error?: { message?: string; status?: string };
};

function parseHours(descriptions?: string[]): Record<string, string> | null {
  if (!descriptions?.length) return null;
  const out: Record<string, string> = {};
  for (const line of descriptions) {
    const [day, ...rest] = line.split(":");
    if (day && rest.length) out[day.trim()] = rest.join(":").trim();
  }
  return Object.keys(out).length ? out : null;
}

export class GooglePlacesProvider implements BusinessDataProvider {
  readonly id = "google-places";
  readonly label = "Google Places API";
  readonly isMock = false;

  isConfigured(): boolean {
    return Boolean(appConfig.businessData.googlePlaces);
  }

  health(): ProviderHealth {
    return {
      id: this.id,
      label: this.label,
      configured: this.isConfigured(),
      isMock: false,
      setupHint:
        "Set GOOGLE_PLACES_API_KEY to a key with the Places API (New) enabled, then re-run discovery.",
    };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const key = appConfig.businessData.googlePlaces;
    if (!key) {
      throw notConfigured(
        "Google Places",
        "Add GOOGLE_PLACES_API_KEY to .env, or switch the discovery provider to Mock in Settings.",
      );
    }

    const locationText = [query.area, query.city, query.country]
      .filter(Boolean)
      .join(", ");
    const textQuery = [query.category, query.keywords, "in", locationText]
      .filter(Boolean)
      .join(" ");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    let payload: PlacesResponse;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery,
          // Places caps a page at 20; the campaign runner pages until it has enough.
          pageSize: Math.min(20, Math.max(1, query.limit)),
          ...(query.cursor ? { pageToken: query.cursor } : {}),
          ...(query.minRating ? { minRating: query.minRating } : {}),
        }),
      });

      if (res.status === 429) {
        throw new AppError({
          kind: "rate-limited",
          message: "Google Places rejected the request: quota exceeded.",
          remedy: "Wait for the quota window to reset, or raise the quota in Google Cloud.",
          retryable: true,
        });
      }

      payload = (await res.json()) as PlacesResponse;

      if (!res.ok) {
        throw new AppError({
          kind: "provider-error",
          message: payload.error?.message ?? `Places returned HTTP ${res.status}.`,
          remedy:
            "Check that the API key is valid, unrestricted for this server, and that Places API (New) is enabled.",
          retryable: res.status >= 500,
          detail: payload.error?.status,
        });
      }
    } catch (e) {
      throw toAppError(e, "Check network access to places.googleapis.com and retry.");
    } finally {
      clearTimeout(timer);
    }

    const records: BusinessRecord[] = (payload.places ?? []).map((p) => ({
      externalId: p.id,
      name: p.displayName?.text ?? "Unnamed business",
      category: p.primaryTypeDisplayName?.text ?? query.category,
      subcategory: p.types?.[0] ?? null,
      description: p.editorialSummary?.text ?? null,
      address: p.formattedAddress ?? null,
      city: query.city,
      area: query.area ?? null,
      country: query.country,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
      // Places does not expose email or social handles.
      email: null,
      website: normaliseUrl(p.websiteUri),
      googleUrl: p.googleMapsUri ?? null,
      instagram: null,
      facebook: null,
      linkedin: null,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      hours: parseHours(p.regularOpeningHours?.weekdayDescriptions),
      services: null,
      images: null,
      logoUrl: null,
    }));

    const filtered = records.filter((r) => {
      if (query.minReviews != null && (r.reviewCount ?? 0) < query.minReviews) return false;
      if (query.websiteFilter === "none" && r.website) return false;
      if (query.websiteFilter === "good" && !r.website) return false;
      return true;
    });

    return {
      records: filtered,
      nextCursor: payload.nextPageToken ?? null,
      isMock: false,
      providerId: this.id,
    };
  }
}
