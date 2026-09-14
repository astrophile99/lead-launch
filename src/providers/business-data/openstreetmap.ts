import { appConfig } from "@/config/app";
import { normaliseUrl } from "@/lib/utils";
import type { BusinessRecord, DiscoveryQuery, DiscoveryResult } from "@/types";
import { runOverpassQuery, type OverpassElement } from "./overpass-client";
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
 *   - **sends one query per campaign** in the normal case, and at most three
 *     when the first finds nothing (see the ladder below).
 *   - **caps `[out:json][timeout:]`** so a bad query cannot hold a slot open.
 *   - **throttles and backs off** rather than retrying hard. Transport
 *     behaviour lives in `overpass-client.ts`.
 *   - **identifies itself** with a real user agent and a contact URL.
 *
 * ## Why the area filter looks the way it does
 *
 * The obvious spelling, `area["name"~"^Mumbai$",i]`, is a case-insensitive
 * regex over every area in the planet file, and it matches far more than a
 * city: parks, suburbs, buildings and relations that merely share the name.
 * The union of all of them is then searched. Adding
 * `["boundary"="administrative"]` and using an exact match instead turns that
 * into an indexed lookup of one administrative area — measured at ~1.9s for
 * Mumbai dentists against a healthy endpoint.
 *
 * Exactness costs something: "bengaluru" typed in lower case, or a suburb OSM
 * does not hold a boundary for, will match nothing. That is what the ladder in
 * `search` is for — the expensive, tolerant query runs only after the cheap,
 * strict one has come back empty.
 *
 * ## Attribution
 *
 * ODbL requires attribution wherever the data is shown. `attribution` below is
 * carried on every result and rendered by the UI; it is not optional and it is
 * not a footnote we can quietly drop.
 */

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

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
export function filtersFor(category: string): { filters: string[]; exact: boolean } {
  for (const entry of CATEGORY_TAGS) {
    if (entry.match.test(category)) return { filters: entry.filters, exact: true };
  }
  const escaped = escapeRegexLiteral(category);
  return { filters: [`["name"~"${escaped}",i]["shop"]`, `["name"~"${escaped}",i]["office"]`], exact: false };
}

/** Overpass string literals are double-quoted; neither may appear unescaped. */
function escapeStringLiteral(value: string): string {
  return value.replace(/\\/g, "").replace(/"/g, "");
}

/** As above, plus the regex metacharacters, so a place name cannot be a pattern. */
function escapeRegexLiteral(value: string): string {
  return escapeStringLiteral(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type AreaPlan = {
  name: string;
  /** exact: indexed, cheap, strict. loose: case-insensitive regex, tolerant. */
  mode: "exact" | "loose";
};

/**
 * The query ladder, cheapest and strictest first.
 *
 * Only the first rung runs unless it comes back empty, so the common case is
 * one request. A named area ("Bandra") is tried before the city that contains
 * it, because a suburb-level match is what the user actually asked for.
 */
export function areaPlans(query: Pick<DiscoveryQuery, "city" | "area">): AreaPlan[] {
  const names: string[] = [];
  for (const raw of [query.area, query.city]) {
    const name = raw?.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return [];

  const plans: AreaPlan[] = names.map((name) => ({ name, mode: "exact" as const }));
  // The tolerant rung runs against the broadest name only: if "Bandra" is not
  // an administrative boundary, spending a slow regex on it will not help,
  // whereas the city almost always is one.
  plans.push({ name: names[names.length - 1], mode: "loose" });
  return plans;
}

/**
 * How many features to ask the server for.
 *
 * `out` truncates a result the server has already computed, so a larger number
 * costs almost nothing — the expense is resolving the area. A floor well above
 * the target matters because unnamed features and the website filter both
 * discard candidates: asking for 2 and receiving 2 dentists who both have
 * sites would otherwise return nothing at all.
 */
export function resultBudget(limit: number): number {
  return Math.min(Math.max(limit * 3, 25), 200);
}

export function buildQuery(
  plan: AreaPlan,
  filters: string[],
  limit: number,
  timeoutSeconds = 25,
): string {
  const clause =
    plan.mode === "exact"
      ? `area["name"="${escapeStringLiteral(plan.name)}"]["boundary"="administrative"]->.searchArea;`
      : `area["name"~"^${escapeRegexLiteral(plan.name)}$",i]["boundary"="administrative"]->.searchArea;`;

  return [
    `[out:json][timeout:${timeoutSeconds}];`,
    clause,
    // Emit the resolved area itself, not just the businesses inside it.
    //
    // Without this, "no dentists in Mumbai" and "this server could not resolve
    // Mumbai" are the same response - zero elements - and the second is a
    // wrong answer dressed as a real one. Observed in the wild: one FOSSGIS
    // backend answered 200 with zero elements for a query its sibling served
    // with five results, because its area index was not built. Counting the
    // areas separates "the place is unknown here" from "the place has none".
    ".searchArea out ids;",
    "(",
    ...filters.map((f) => `  nwr${f}(area.searchArea);`),
    ");",
    `out center ${resultBudget(limit)};`,
  ].join("\n");
}

export class OpenStreetMapProvider implements BusinessDataProvider {
  readonly id = "openstreetmap";
  readonly label = "OpenStreetMap (free)";
  readonly isMock = false;
  /** ODbL is a condition of use, so this travels with the data. */
  readonly attribution = OSM_ATTRIBUTION;

  isConfigured(): boolean {
    // No key exists to configure. That is the point of this layer.
    return true;
  }

  health(): ProviderHealth {
    const endpoints = appConfig.research.overpassUrls;
    return {
      id: this.id,
      label: this.label,
      configured: true,
      isMock: false,
      setupHint:
        `No key required. Free, open data from OpenStreetMap contributors, queried across ${endpoints.length} Overpass endpoint${endpoints.length === 1 ? "" : "s"} with automatic failover. ` +
        "Coverage varies by city and it carries no ratings or review counts, so scoring falls back to what the audit can observe.",
    };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const startedAt = Date.now();
    const { filters, exact } = filtersFor(query.category);
    const plans = areaPlans(query);
    const where = [query.area, query.city, query.country].filter(Boolean).join(", ");

    if (plans.length === 0) {
      return {
        records: [],
        nextCursor: null,
        isMock: false,
        providerId: this.id,
        attribution: OSM_ATTRIBUTION,
        notes: ["No city or area was given, so there was nowhere to search."],
      };
    }

    // One budget for the whole ladder, so escalating cannot multiply the time
    // this call is allowed to take.
    const budgetMs = appConfig.research.overpassDeadlineMs;
    const deadlineAt = Date.now() + budgetMs;
    // Escalating costs a round trip, so it only happens with room left to
    // spare. The reserve is a fraction of the budget rather than a fixed
    // number of seconds: hardcoding 8s meant that configuring a deadline
    // shorter than that switched the ladder off without saying so.
    const escalationReserveMs = Math.min(8_000, Math.round(budgetMs / 3));

    let elements: OverpassElement[] = [];
    let host = "";
    let used: AreaPlan = plans[0];
    let placeResolved = false;
    const ladder: string[] = [];
    // Whichever endpoint answered the last rung is tried first on the next
    // one, so a ladder cannot pay an unreachable primary's timeout per rung.
    let preferEndpoint: string | undefined;
    // Shared across the rungs, so an endpoint that has already timed out is
    // tried last on the next rung instead of costing its full timeout again.
    const failedEndpoints = new Set<string>();

    for (const plan of plans) {
      const outcome = await runOverpassQuery(buildQuery(plan, filters, query.limit), {
        label: `${query.category}/${plan.name}/${plan.mode}`,
        deadlineAt,
        preferEndpoint,
        failedEndpoints,
      });

      host = outcome.host;
      used = plan;

      const areas = outcome.elements.filter((e) => e.type === "area").length;
      const features = outcome.elements.filter((e) => e.type !== "area");
      placeResolved = placeResolved || areas > 0;

      // Only stick to an endpoint that actually resolved the place, and push
      // one that could not to the back of the queue.
      //
      // Overpass builds its area index separately from the main database, and
      // a server whose index is missing or mid-rebuild answers 200 with no
      // area and no results - while its sibling serves the same query
      // normally. Verified against both FOSSGIS backends within a minute of
      // each other. So zero areas says more about this endpoint than about the
      // place name, and the next rung should ask somebody else.
      if (areas > 0) {
        preferEndpoint = outcome.endpoint;
      } else {
        failedEndpoints.add(outcome.endpoint);
        if (preferEndpoint === outcome.endpoint) preferEndpoint = undefined;
      }

      ladder.push(
        `${plan.mode} match on "${plan.name}" via ${outcome.host}: ${areas} area(s), ${features.length} feature(s) in ${outcome.durationMs}ms`,
      );

      if (features.length > 0) {
        elements = features;
        break;
      }
      // The place resolved and genuinely holds none of this category. Another
      // rung would only re-ask a question that has been answered.
      if (areas > 0) break;
      if (Date.now() > deadlineAt - escalationReserveMs) break;
    }

    const businesses: BusinessRecord[] = [];
    let unnamed = 0;
    let filtered = 0;

    for (const el of elements) {
      const tags = el.tags ?? {};
      const name = tags.name;
      if (!name) {
        unnamed++;
        continue; // An unnamed node is not a business we can approach.
      }

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

      if (query.websiteFilter === "none" && record.website) {
        filtered++;
        continue;
      }
      if (query.websiteFilter === "good" && !record.website) {
        filtered++;
        continue;
      }
      businesses.push(record);
      if (businesses.length >= query.limit) break;
    }

    const notes: string[] = [];

    if (elements.length === 0 && !placeResolved) {
      // Distinct from an empty result: nothing we reached could turn the place
      // name into an administrative boundary, so no area was ever searched.
      notes.push(
        `No OpenStreetMap administrative boundary matched "${used.name}", so there was no area to search in ${where}. ` +
          "This is not the same as finding nothing: try the city rather than the neighbourhood, or check the spelling OSM uses for it.",
      );
    } else if (elements.length === 0) {
      // Reached only when a server resolved the place and had nothing in it.
      // A failure to reach one throws, and never arrives here.
      notes.push(
        `OpenStreetMap knows ${where} but holds no "${query.category}" mapped inside it. ` +
          "This is an empty result, not a failed one — OSM coverage of a category varies a lot by city.",
      );
    } else {
      notes.push(
        `Matched ${elements.length} OSM feature(s) for "${query.category}" in ${where} via ${host} in ${Date.now() - startedAt}ms.`,
      );
    }

    if (!exact) {
      notes.push(
        `No OSM tag maps to "${query.category}", so this fell back to a name search — coverage will be patchy.`,
      );
    }
    if (used.mode === "loose" && elements.length > 0) {
      notes.push(
        `The exact name match found nothing, so "${used.name}" was matched case-insensitively instead.`,
      );
    }
    if (unnamed > 0) {
      notes.push(`${unnamed} feature(s) had no name tag and were skipped.`);
    }
    if (filtered > 0) {
      notes.push(`${filtered} matched the category but not the website filter.`);
    }
    notes.push(
      "OpenStreetMap carries no ratings or review counts. Those fields are recorded as unknown rather than zero.",
    );

    return {
      records: businesses,
      nextCursor: null,
      isMock: false,
      providerId: this.id,
      attribution: OSM_ATTRIBUTION,
      notes: [...ladder.slice(0, -1).map((l) => `Tried: ${l}`), ...notes],
    };
  }
}
