import type { AuditSignals } from "@/types";

export type AuditProviderResult = {
  engine: string;
  isMock: boolean;
  signals: AuditSignals;
};

export interface AuditProvider {
  readonly id: string;
  readonly label: string;
  readonly isMock: boolean;
  isConfigured(): boolean;
  /** Throws AppError on failure; never returns a partially-invented result. */
  inspect(url: string, opts?: { seed?: string }): Promise<AuditProviderResult>;
}
