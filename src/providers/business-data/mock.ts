import { resolveIndustry } from "@/config/industries";
import { dedupeKey, hash, pick, round, seededRandom, slugify } from "@/lib/utils";
import type { BusinessRecord, DiscoveryQuery, DiscoveryResult } from "@/types";
import type { BusinessDataProvider, ProviderHealth } from "./types";

/**
 * Deterministic mock discovery.
 *
 * Every field is synthesised from a seed derived from the query plus the record
 * index, so the same search always returns the same businesses. Records are
 * flagged isMock at every layer above this one and the UI labels them; nothing
 * here is ever presented as a real scrape.
 *
 * The generated website hostnames intentionally live under `.example` domains
 * (reserved by RFC 2606) so nothing accidentally hits a real site, and the mock
 * auditor derives its findings from the same seed - a business with a "poor"
 * site here will audit poorly, consistently.
 */

/**
 * Name patterns.
 *
 * Most patterns combine two independent tokens, because a single-token pool is
 * small enough that thirty records collide constantly and the demo list then
 * looks like a de-duplication failure rather than the varied street of
 * businesses it is meant to represent.
 */
const NAME_PATTERNS: Record<string, string[]> = {
  dental: [
    "{sur} {word} Dental Care",
    "Smile {word} Dental Clinic",
    "Dr. {sur}'s {word} Dental Studio",
    "{area} {word} Dental Centre",
    "{word} {sur} Orthodontics",
    "{sur} Family Dentistry",
    "{word} Dental Studio",
  ],
  medical: [
    "{sur} {word} Multispeciality Clinic",
    "{area} {word} Health Centre",
    "Dr. {sur} {word} Clinic",
    "{word} {sur} Polyclinic",
    "{sur} Family Practice",
  ],
  restaurant: [
    "{word} {sur} Kitchen",
    "The {word} House",
    "{sur} {word} Cafe",
    "{area} {word} Bistro",
    "Cafe {word} {sur}",
    "{word} Table",
  ],
  salon: [
    "{word} {sur} Salon & Spa",
    "{sur} {word} Hair Studio",
    "{area} {word} Beauty Lounge",
    "The {word} {sur} Room",
    "{word} Grooming Co.",
  ],
  gym: [
    "{word} {sur} Fitness",
    "{area} {word} Strength Club",
    "{sur} {word} Gym",
    "{word} {sur} Yoga Studio",
    "{word} Movement Lab",
  ],
  "real-estate": [
    "{sur} {word} Realty",
    "{area} {word} Properties",
    "{word} {sur} Estates",
    "{sur} & {word} Associates Realty",
  ],
  law: [
    "{sur} & {word} Associates",
    "{sur} {word} Legal",
    "{area} {word} Law Chambers",
    "{sur} {word} Advocates",
  ],
  accounting: [
    "{sur} & {word} Co.",
    "{sur} {word} Associates",
    "{area} {word} Tax Advisors",
    "{word} {sur} Consulting",
  ],
  interior: [
    "{word} {sur} Interiors",
    "Studio {word} {sur}",
    "{sur} {word} Design Co.",
    "{area} {word} Interiors",
    "{word} Atelier",
  ],
  construction: [
    "{sur} {word} Constructions",
    "{word} {sur} Builders",
    "{area} {word} Infra",
    "{sur} & Sons {word}",
  ],
  education: [
    "{word} {sur} Academy",
    "{area} {word} Learning Centre",
    "{sur} {word} Classes",
    "{word} {sur} International School",
  ],
  automotive: [
    "{sur} {word} Motors",
    "{word} {sur} Auto Care",
    "{area} {word} Car Studio",
    "{word} {sur} Detailing",
  ],
  hospitality: [
    "Hotel {word} {sur}",
    "{word} {sur} Residency",
    "The {word} {area}",
    "{word} {sur} Stays",
  ],
  retail: [
    "{sur} {word} Stores",
    "{word} {sur} Boutique",
    "{area} {word} Emporium",
    "{word} & {sur} Co.",
  ],
  general: ["{sur} {word}", "{area} {word} {sur}", "{word} {sur} Services"],
};

const SURNAMES = [
  "Mehta", "Kulkarni", "Iyer", "Shetty", "Deshpande", "Rao", "Bhatt", "Sharma",
  "Chandra", "Nair", "Kapoor", "Joshi", "Pillai", "Sethi", "Menon", "Gokhale",
  "Verma", "Reddy", "Chawla", "Trivedi", "Banerjee", "Fernandes",
];

const WORDS = [
  "Aura", "Verve", "Lumen", "Cedar", "Indigo", "Meridian", "Harbour", "Solace",
  "Nimbus", "Terra", "Aster", "Kestrel", "Vantage", "Willow", "Onyx", "Praise",
  "Marigold", "Copper", "Juniper", "Atlas", "Orchid", "Basalt",
];

const AREAS: Record<string, string[]> = {
  mumbai: ["Bandra", "Andheri West", "Powai", "Lower Parel", "Juhu", "Colaba", "Chembur", "Malad"],
  pune: ["Koregaon Park", "Baner", "Kothrud", "Viman Nagar", "Hinjewadi", "Aundh"],
  bengaluru: ["Indiranagar", "Koramangala", "Jayanagar", "Whitefield", "HSR Layout", "Malleshwaram"],
  delhi: ["Hauz Khas", "Saket", "Vasant Kunj", "Karol Bagh", "Dwarka", "Rajouri Garden"],
  hyderabad: ["Banjara Hills", "Jubilee Hills", "Gachibowli", "Madhapur", "Kondapur"],
  chennai: ["Adyar", "T. Nagar", "Anna Nagar", "Velachery", "Nungambakkam"],
};

const STREETS = [
  "Linking Road", "SV Road", "Hill Road", "Turner Road", "MG Road", "Church Street",
  "Station Road", "Market Lane", "Park Avenue", "Nehru Marg",
];

/** Website archetypes the mock auditor keys off. */
export type MockSiteQuality = "none" | "poor" | "dated" | "decent" | "good";

const QUALITY_DISTRIBUTION: MockSiteQuality[] = [
  "none", "none", "none",
  "poor", "poor", "poor", "poor",
  "dated", "dated", "dated",
  "decent", "decent",
  "good",
];

/** Derives the site archetype for a business from its stable dedupe key. */
export function mockSiteQualityFor(key: string): MockSiteQuality {
  const rand = seededRandom(`quality:${key}`);
  return pick(rand, QUALITY_DISTRIBUTION);
}

function areasFor(city: string): string[] {
  return AREAS[city.toLowerCase().trim()] ?? ["Central", "North", "South", "East", "West"];
}

function buildName(
  rand: () => number,
  industryId: string,
  area: string,
): string {
  const patterns = NAME_PATTERNS[industryId] ?? NAME_PATTERNS.general;
  return pick(rand, patterns)
    .replaceAll("{sur}", pick(rand, SURNAMES))
    .replaceAll("{word}", pick(rand, WORDS))
    .replaceAll("{area}", area);
}

function makePhone(rand: () => number): string {
  const prefix = pick(rand, ["98", "99", "97", "96", "88", "70"]);
  let rest = "";
  for (let i = 0; i < 8; i++) rest += Math.floor(rand() * 10);
  return `+91 ${prefix}${rest.slice(0, 3)} ${rest.slice(3)}`;
}

function makeRecord(
  query: DiscoveryQuery,
  index: number,
  seedBase: string,
): BusinessRecord {
  const rand = seededRandom(`${seedBase}:${index}`);
  const industry = resolveIndustry(query.category);
  const area = query.area?.trim()
    ? query.area.trim()
    : pick(rand, areasFor(query.city));
  const name = buildName(rand, industry.id, area);

  // Ratings cluster high for established local businesses, with a long tail.
  const ratingRoll = rand();
  const rating =
    ratingRoll > 0.9
      ? round(3.2 + rand() * 0.6, 1)
      : round(4.0 + rand() * 0.9, 1);

  // Review counts are log-distributed: many small, few very large.
  const reviewCount = Math.max(
    3,
    Math.round(Math.exp(rand() * 6.4) * (0.6 + rand() * 0.9)),
  );

  const phone = rand() > 0.06 ? makePhone(rand) : null;
  const key = dedupeKey({ name, city: query.city, phone });
  const quality = mockSiteQualityFor(key);

  const host = `${slugify(name).slice(0, 28)}.example`;
  const website = quality === "none" ? null : `https://www.${host}/`;

  const hasEmail = rand() > 0.55;
  const email = hasEmail
    ? `${pick(rand, ["hello", "contact", "info", "reception", "care"])}@${host}`
    : null;

  const instagram =
    rand() > 0.4 ? `https://instagram.com/${slugify(name).slice(0, 24)}` : null;
  const facebook =
    rand() > 0.65 ? `https://facebook.com/${slugify(name).slice(0, 24)}` : null;
  const linkedin =
    industry.id === "law" || industry.id === "accounting" || industry.id === "real-estate"
      ? rand() > 0.5
        ? `https://linkedin.com/company/${slugify(name).slice(0, 24)}`
        : null
      : null;

  const serviceCount = 3 + Math.floor(rand() * 3);
  const services = industry.typicalServices.length
    ? industry.typicalServices.slice(0, serviceCount)
    : ["Consultation", "Standard service", "Premium service"];

  const hours: Record<string, string> = {};
  const closedDay = pick(rand, ["Sunday", "Monday", "None"]);
  for (const day of [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ]) {
    hours[day] = day === closedDay ? "Closed" : `${9 + Math.floor(rand() * 2)}:30 – ${18 + Math.floor(rand() * 3)}:00`;
  }

  return {
    externalId: `mock_${hash(key).toString(36)}`,
    name,
    category: industry.label,
    subcategory: pick(rand, services),
    description: `${industry.label} business operating in ${area}, ${query.city}.`,
    address: `${1 + Math.floor(rand() * 120)}, ${pick(rand, STREETS)}, ${area}, ${query.city}`,
    city: query.city,
    area,
    country: query.country,
    lat: round(18.9 + rand() * 0.4, 6),
    lng: round(72.8 + rand() * 0.4, 6),
    phone,
    email,
    website,
    googleUrl: `https://maps.google.com/?q=${encodeURIComponent(`${name} ${area} ${query.city}`)}`,
    instagram,
    facebook,
    linkedin,
    rating,
    reviewCount,
    hours,
    services,
    images: [],
    logoUrl: null,
  };
}

export class MockBusinessDataProvider implements BusinessDataProvider {
  readonly id = "mock";
  readonly label = "Mock discovery (demo data)";
  readonly isMock = true;

  isConfigured(): boolean {
    return true;
  }

  health(): ProviderHealth {
    return {
      id: this.id,
      label: this.label,
      configured: true,
      isMock: true,
      setupHint:
        "Always available. Generates deterministic demo businesses so the whole workflow can be exercised without paid APIs.",
    };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const seedBase = [
      query.category,
      query.city,
      query.area ?? "",
      query.country,
      query.keywords ?? "",
    ]
      .map((s) => s.toLowerCase().trim())
      .join("|");

    const offset = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;

    // Over-generate then filter, so rating/review floors behave like a real API.
    const pool: BusinessRecord[] = [];
    let index = offset;
    const ceiling = offset + query.limit * 6 + 40;
    while (pool.length < query.limit && index < ceiling) {
      const record = makeRecord(query, index, seedBase);
      index++;
      if (query.minRating != null && (record.rating ?? 0) < query.minRating) continue;
      if (query.minReviews != null && (record.reviewCount ?? 0) < query.minReviews) continue;
      if (query.websiteFilter === "none" && record.website) continue;
      if (query.websiteFilter !== "none" && query.websiteFilter !== "any") {
        if (!record.website) continue;
        const key = dedupeKey({
          name: record.name,
          city: record.city,
          phone: record.phone,
        });
        const q = mockSiteQualityFor(key);
        if (query.websiteFilter === "poor" && !["poor", "dated"].includes(q)) continue;
        if (query.websiteFilter === "good" && !["decent", "good"].includes(q)) continue;
      }
      if (query.keywords) {
        const needle = query.keywords.toLowerCase();
        const hay = `${record.name} ${record.subcategory ?? ""} ${(record.services ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }
      pool.push(record);
    }

    return {
      records: pool,
      nextCursor: index < ceiling ? String(index) : null,
      isMock: true,
      providerId: this.id,
    };
  }
}
