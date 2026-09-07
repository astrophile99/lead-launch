import { appConfig } from "@/config/app";
import { GooglePlacesProvider } from "./google-places";
import { MockBusinessDataProvider } from "./mock";
import { OpenStreetMapProvider } from "./openstreetmap";
import type { BusinessDataProvider, ProviderHealth } from "./types";

/**
 * Discovery provider registry, ordered cheapest-first.
 *
 * The default is OpenStreetMap, not Google Places, and that ordering is the
 * whole point: OSM is free and open, Google is billed per request past a
 * monthly allowance, and for "find me the dentists in this suburb" the free
 * one is usually good enough. Google stays available and stays one setting
 * away, but nothing reaches for it silently.
 *
 * Trade-offs are stated rather than hidden: OSM carries no ratings and no
 * review counts, so a workspace that scores heavily on reputation will want
 * Google. The provider health row says so.
 */

const registry: BusinessDataProvider[] = [
  new OpenStreetMapProvider(),
  new GooglePlacesProvider(),
  new MockBusinessDataProvider(),
];

export function listBusinessDataProviders(): BusinessDataProvider[] {
  return registry;
}

export function businessDataHealth(): ProviderHealth[] {
  return registry.map((p) => p.health());
}

/**
 * Resolves the provider to use.
 *
 * An explicit choice always wins. Otherwise, in live mode, the first
 * configured real provider in registry order - which is the free one.
 */
export function getBusinessDataProvider(id?: string | null): BusinessDataProvider {
  if (id) {
    const explicit = registry.find((p) => p.id === id);
    if (explicit) return explicit;
  }
  if (appConfig.mode === "live") {
    const real = registry.find((p) => !p.isMock && p.isConfigured());
    if (real) return real;
  }
  return registry.find((p) => p.isMock)!;
}

export type { BusinessDataProvider, ProviderHealth };
