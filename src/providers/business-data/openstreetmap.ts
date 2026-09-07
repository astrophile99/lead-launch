import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import { throttleHost } from "@/lib/rate-limit";
import { dedupeKey, normaliseUrl } from "@/lib/utils";
import type { BusinessRecord, DiscoveryQuery, DiscoveryResult } from "@/types";
import type { BusinessDataProvider, ProviderHealth } from "./types";

/**
 * OpenStreetMap, via the Overpass API.
 *
 * The free discovery layer. No key, no billing, and for local businesses in
 * most cities the coverage is genuinely good — OSM knows about the dentist on
 * the corner, and it knows their website and opening hours, because a human
 * put them there.
 *
 * ## Using it without being a problem
 *
 * Overpass is volunteer-run infrastructure. The way to get banned is to treat
 * it as a free Google Places, so this adapter:
 *
 *   - **does not use Nominatim for bulk lookup.** Nominatim's usage policy
 *     forbids systematic queries, and business discovery is exactly that. Area
 *     resolution goes through Overpass's own `area` filter instead, which is
 *     one query rather than one per business.
 *   - **sends one query per campaign**, not one per result.
 *   - **caps `[out:json][timeout:]`** so a bad query cannot hold a slot open.
 *   - **throttles** to one request at a time per host.
 *   - **identifies itself** with a real user agent and a contact URL.
 *
 * ## Attribution
 *
 * ODbL requires attribution wherever the data is shown. `attribution` below is
 * carried on every record and rendered by the UI; it is not optional and it is
 * not a footnote we can quietly drop.
 */

const ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

/** OSM tags that correspond to the categories this product cares about. */
const CATEGORY_TAGS: { match: RegExp; filters: string[] }[] = [
  { match: /dent/i, filters: ['["healthcare"="dentist"]', '["amenity"="dentist"]'] },
  { match: /doctor|clinic|medical|physician/i, filters: ['["amenity"="doctors"]', '["healthcare"="doctor"]'] },
  { match: /salon|hair|barber/i, filters: ['["shop"="hairdresser"]', '["shop"="beauty"]'] },
  { match: /spa|massage/i, filters: ['["leisure"="spa"]', '["shop"="massage"]'] },
  { match: /gym|fitness/i, filters: ['["leisure"="fitness_centre"]'] },
  { match: /restaurant|dining/i, filters: ['["amenity"="restaurant"]'] },
  { match: /cafe|coffee/i, filters: ['["amenity"="cafe"]'] },
  { match: /bakery/i, filters: ['["shop"="bakery"]'] },
  { match: /hotel|lodge|stay/i, filters: ['["tourism"="hotel"]', '["tourism"="guest_house"]'] },
  { match: /law|advocate|solicitor/i, filters: ['["office"="lawyer"]'] },
  { match: /account|tax|ca\b/i, filters: ['["office"="accountant"]'] },
  { match: /estate|property|realt/i, filters: ['["office"="estate_agent"]'] },
  { match: /vet/i, filters: ['["amenity"="veterinary"]'] },
  { match: /school|tuition|coaching|academy/i, filters: ['["amenity"="school"]', '["office"="educational_institution"]'] },
  { match: /garage|mechanic|car repair/i, filters: ['["shop"="car_repair"]'] },
  { match: /pharmacy|chemist/i, filters: ['["amenity"="pharmacy"]'] },
  { match: /optic|eye/i, filters: ['["shop"="optician"]'] },
  { match: /photograph/i, filters: ['["shop"="photo"]', '["craft"="photographer"]'] },
];

/** Falls back to a name search when the category is not one we know a tag for. */
function filtersFor(category: string): { filters: string[]; exact: boolean } {
  for (const entry of CATEGORY_TAGS) {
    if (entry.match.test(category)) return { filters: entry.filters, exact: true };
  }
  const escaped = category.replace(/["\\]/g, "");
  return { filters: [`["name"~"${escaped}",i]["shop"]`, `["name"~"${escaped}",i]["office"]`], exact: false };
}

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export class OpenStreetMapProvider implements BusinessDataProvider {
  readonly id = "openstreetmap";
  readonly label = "OpenStreetMap (free)";
  readonly isMock = false;

  isConfigured(): boolean {
    // No key exists to configure. That is the point of this layer.
    return true;
  }

  health(): ProviderHealth {
    return {
      id: this.id,
      label: this.label,
      configured: true,
      isMock: false,
      setupHint:
        "No key required. Free, open data from OpenStreetMap contributors. Coverage varies by city and it carries no ratings or review counts, so scoring falls back to what the audit can observe.",
    };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const startedAt = Date.now();
    const { filters, exact } = filtersFor(query.category);
    const area = [query.area, query.city, query.country].filter(Boolean).join(", ");

    // One query, resolved server-side by Overpass. `area` is matched by name,
    // which is why the city name is quoted and escaped rather than
    // concatenated blindly.
    const safeArea = (query.area || query.city).replace(/["\\]/g, "");
    const limit = Math.min(query.limit * 3, 150);
    const body = `[out:json][timeout:25];
area["name"~"^${safeArea}$",i]->.searchArea;
(
${filters.map((f) => `  nwr${f}(area.searchArea);`).join("\n")}
);
out center ${limit};`;

    const url = new URL(appConfig.research.overpassUrl);
    await throttleHost(url.hostname, 2_000);

    let payload: { elements?: OverpassElement[] };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": appConfig.research.userAgent,
        },
        body: new URLSearchParams({ data: body }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 429 || res.status === 504) {
        throw new AppError({
          kind: "rate-limited",
          message: "Overpass is busy and asked us to slow down.",
          remedy:
            "Wait a minute and try again. Overpass is volunteer-run infrastructure; the app deliberately does not retry hard.",
          retryable: true,
        });
      }
      if (!res.ok) {
        throw new AppError({
          kind: "provider-error",
          message: `Overpass returned HTTP ${res.status}.`,
          remedy: "Try again shortly, or switch discovery to Google Places in Settings.",
          retryable: res.status >= 500,
        });
      }
      payload = (await res.json()) as { elements?: OverpassElement[] };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError({
        kind: "unreachable",
        message: "Could not reach the Overpass API.",
        remedy: "Check this server's outbound network access, or use a different Overpass endpoint.",
        retryable: true,
      });
    }

    const elements = payload.elements ?? [];
    const businesses: BusinessRecord[] = [];

    for (const el of elements) {
      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name) continue; // An unnamed node is not a business we can approach.

      const website = tags.website ?? tags["contact:website"] ?? null;
      const phone = tags.phone ?? tags["contact:phone"] ?? null;
      const email = tags.email ?? tags["contact:email"] ?? null;

      const addressParts = [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:suburb"],
        tags["addr:city"],
        tags["addr:postcode"],
      ].filter(Boolean);

      const record: BusinessRecord = {
        name,
        category: query.category,
        subcategory:
          tags.healthcare ?? tags.amenity ?? tags.shop ?? tags.office ?? tags.leisure ?? null,
        description: tags.description ?? null,
        address: addressParts.length ? addressParts.join(", ") : null,
        city: tags["addr:city"] ?? query.city,
        area: tags["addr:suburb"] ?? query.area ?? null,
        country: query.country,
        lat: el.lat ?? el.center?.lat ?? null,
        lng: el.lon ?? el.center?.lon ?? null,
        phone,
        email,
        website: website ? normaliseUrl(website) : null,
        googleUrl: null,
        // OSM has no notion of a business's own social accounts beyond these
        // tags, and they are rare. Absent means not recorded, not absent.
        instagram: tags["contact:instagram"] ?? null,
        facebook: tags["contact:facebook"] ?? null,
        linkedin: tags["contact:linkedin"] ?? null,
        // OSM carries no ratings or review counts at all. Null here is what
        // makes the presence grid report "not checked" rather than "missing".
        rating: null,
        reviewCount: null,
        hours: tags.opening_hours ? { raw: tags.opening_hours } : null,
        services: [],
        images: [],
        logoUrl: null,
        externalId: `${el.type}/${el.id}`,
      };
      // Recorded for the caller's benefit; the persistence layer derives the
      // dedupe key itself, so it is not carried on the record.
      void dedupeKey({
        name,
        city: tags["addr:city"] ?? query.city,
        phone,
        website,
      });

      if (query.websiteFilter === "none" && record.website) continue;
      if (query.websiteFilter === "good" && !record.website) continue;
      businesses.push(record);
      if (businesses.length >= query.limit) break;
    }

    return {
      records: businesses,
      nextCursor: null,
      isMock: false,
      providerId: this.id,
      attribution: ATTRIBUTION,
      notes: [
        exact
          ? `Matched ${elements.length} OSM feature(s) for "${query.category}" in ${area} in ${Date.now() - startedAt}ms.`
          : `No OSM tag maps to "${query.category}", so this fell back to a name search — coverage will be patchy.`,
        "OpenStreetMap carries no ratings or review counts. Those fields are recorded as unknown rather than zero.",
      ],
    };
  }
}
