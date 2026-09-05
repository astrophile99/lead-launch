import { appConfig } from "@/config/app";
import { GooglePlacesProvider } from "./google-places";
import { MockBusinessDataProvider } from "./mock";
import type { BusinessDataProvider, ProviderHealth } from "./types";

const registry: BusinessDataProvider[] = [
  new GooglePlacesProvider(),
  new MockBusinessDataProvider(),
];

export function listBusinessDataProviders(): BusinessDataProvider[] {
  return registry;
}

export function businessDataHealth(): ProviderHealth[] {
  return registry.map((p) => p.health());
}

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
