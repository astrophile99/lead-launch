import type { DiscoveryQuery, DiscoveryResult } from "@/types";

export type ProviderHealth = {
  id: string;
  label: string;
  configured: boolean;
  isMock: boolean;
  /** Shown in Settings when `configured` is false. */
  setupHint: string;
};

export interface BusinessDataProvider {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  /** False when the credential is missing; the registry will skip it. */
  isConfigured(): boolean;
  health(): ProviderHealth;
  search(query: DiscoveryQuery): Promise<DiscoveryResult>;
}
