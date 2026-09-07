/**
 * Artifact storage.
 *
 * Generated websites must outlive the machine that built them. The local
 * filesystem is a build scratch directory — correct for development, wrong the
 * moment this runs on a serverless host where the disk vanishes between
 * requests. So the persistent record is the WebsiteArtifact row plus whatever
 * this interface is pointed at, and nothing above this layer knows which.
 */

export type StoredObject = {
  key: string;
  bytes: number;
  contentType: string;
};

export type StorageHealth = {
  id: string;
  label: string;
  configured: boolean;
  /** True when objects survive a process restart. */
  durable: boolean;
  status: "connected" | "not-configured" | "error";
  detail: string;
  setupHint: string;
};

export interface StorageProvider {
  readonly id: string;
  readonly label: string;
  /** False for anything that lives only in this process or on this disk. */
  readonly durable: boolean;

  isConfigured(): boolean;
  health(): Promise<StorageHealth>;

  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  remove(prefix: string): Promise<number>;
}
