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
  /**
   * Credit line the source licence requires wherever its data is shown.
   *
   * On the provider rather than only on `DiscoveryResult` because the campaign
   * page renders records fetched days ago: the obligation outlives the request
   * that produced them. Undefined means the source imposes no such condition.
   */
  readonly attribution?: string;
  /** False when the credential is missing; the registry will skip it. */
  isConfigured(): boolean;
  health(): ProviderHealth;
  search(query: DiscoveryQuery): Promise<DiscoveryResult>;
}
