import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import type { StorageHealth, StorageProvider, StoredObject } from "./types";

/**
 * Storage registry.
 *
 * Two implementations, and the difference between them is stated rather than
 * hidden: the local one is not durable, and every surface that reports storage
 * health says so.
 */

/** Rejects anything that could escape the root: `..`, absolute paths, drives. */
function safeKey(key: string): string {
  const normalised = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalised ||
    normalised.includes("\0") ||
    /^[a-zA-Z]:/.test(normalised) ||
    normalised.split("/").some((seg) => seg === ".." || seg === ".")
  ) {
    throw new AppError({
      kind: "invalid-input",
      message: "Refusing to store an object under an unsafe key.",
      remedy: "This is a bug — report the key that was rejected.",
    });
  }
  return normalised;
}

class LocalStorageProvider implements StorageProvider {
  readonly id = "local";
  readonly label = "Local filesystem";
  readonly durable = false;

  private root(): string {
    return path.resolve(process.cwd(), appConfig.studio.projectsRoot, ".artifacts");
  }

  private resolve(key: string): string {
    const root = this.root();
    const target = path.resolve(root, safeKey(key));
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new AppError({
        kind: "blocked",
        message: "Path traversal blocked while resolving a storage key.",
        remedy: "This is a bug — report the key that was rejected.",
      });
    }
    return target;
  }

  isConfigured(): boolean {
    return true;
  }

  async health(): Promise<StorageHealth> {
    return {
      id: this.id,
      label: this.label,
      configured: true,
      durable: false,
      status: "connected",
      detail: `Writing to ${path.relative(process.cwd(), this.root())}. Not durable: a serverless restart loses every build.`,
      setupHint:
        "Set STORAGE_PROVIDER=supabase with STORAGE_BUCKET and the Supabase service key before relying on a build surviving a deploy.",
    };
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    return { key, bytes: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch {
      return null;
    }
  }

  async remove(prefix: string): Promise<number> {
    const target = this.resolve(prefix);
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(target, { recursive: true });
        await fs.rm(target, { recursive: true, force: true });
        return entries.length;
      }
      await fs.rm(target, { force: true });
      return 1;
    } catch {
      return 0;
    }
  }
}

/**
 * Supabase Storage.
 *
 * Written against the real REST API so it works the moment the project exists,
 * and refuses honestly until then. It is not marked connected because the
 * environment variables are present — `health()` asks the bucket.
 */
class SupabaseStorageProvider implements StorageProvider {
  readonly id = "supabase";
  readonly label = "Supabase Storage";
  readonly durable = true;

  isConfigured(): boolean {
    return Boolean(
      appConfig.auth.supabaseUrl && appConfig.auth.supabaseServiceKey && appConfig.storage.bucket,
    );
  }

  private endpoint(key: string): string {
    return `${appConfig.auth.supabaseUrl}/storage/v1/object/${appConfig.storage.bucket}/${safeKey(key)}`;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${appConfig.auth.supabaseServiceKey}`,
      apikey: appConfig.auth.supabaseServiceKey ?? "",
    };
  }

  async health(): Promise<StorageHealth> {
    if (!this.isConfigured()) {
      const missing = [
        !appConfig.auth.supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
        !appConfig.auth.supabaseServiceKey && "SUPABASE_SERVICE_ROLE_KEY",
        !appConfig.storage.bucket && "STORAGE_BUCKET",
      ].filter(Boolean);
      return {
        id: this.id,
        label: this.label,
        configured: false,
        durable: true,
        status: "not-configured",
        detail: `Missing: ${missing.join(", ")}.`,
        setupHint:
          "Create a Supabase project, add a private bucket, then set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STORAGE_BUCKET.",
      };
    }
    try {
      const res = await fetch(
        `${appConfig.auth.supabaseUrl}/storage/v1/bucket/${appConfig.storage.bucket}`,
        { headers: this.headers() },
      );
      if (!res.ok) {
        return {
          id: this.id,
          label: this.label,
          configured: true,
          durable: true,
          status: "error",
          detail: `Supabase returned HTTP ${res.status} for bucket "${appConfig.storage.bucket}".`,
          setupHint: "Check the bucket exists and the service-role key belongs to this project.",
        };
      }
      return {
        id: this.id,
        label: this.label,
        configured: true,
        durable: true,
        status: "connected",
        detail: `Bucket "${appConfig.storage.bucket}" is reachable.`,
        setupHint: "",
      };
    } catch (e) {
      return {
        id: this.id,
        label: this.label,
        configured: true,
        durable: true,
        status: "error",
        detail: e instanceof Error ? e.message : "Could not reach Supabase.",
        setupHint: "Check the project URL and that this server can reach it.",
      };
    }
  }

  private assertReady(): void {
    if (!this.isConfigured()) {
      throw new AppError({
        kind: "not-configured",
        message: "Supabase Storage is selected but not configured.",
        remedy:
          "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STORAGE_BUCKET, or set STORAGE_PROVIDER=local.",
      });
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    this.assertReady();
    const res = await fetch(this.endpoint(key), {
      method: "POST",
      headers: { ...this.headers(), "content-type": contentType, "x-upsert": "true" },
      body: new Uint8Array(body),
    });
    if (!res.ok) {
      throw new AppError({
        kind: "provider-error",
        message: `Supabase Storage rejected the upload (HTTP ${res.status}).`,
        remedy: "Check the bucket policy and that the service-role key is current.",
        retryable: res.status >= 500,
        detail: (await res.text()).slice(0, 300),
      });
    }
    return { key, bytes: body.byteLength, contentType };
  }

  async get(key: string): Promise<Buffer | null> {
    this.assertReady();
    const res = await fetch(this.endpoint(key), { headers: this.headers() });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(prefix: string): Promise<number> {
    this.assertReady();
    const res = await fetch(
      `${appConfig.auth.supabaseUrl}/storage/v1/object/${appConfig.storage.bucket}`,
      {
        method: "DELETE",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ prefixes: [safeKey(prefix)] }),
      },
    );
    return res.ok ? 1 : 0;
  }
}

const local = new LocalStorageProvider();
const supabase = new SupabaseStorageProvider();

export function getStorageProvider(): StorageProvider {
  return appConfig.storage.provider === "supabase" ? supabase : local;
}

export async function storageHealth(): Promise<StorageHealth> {
  return getStorageProvider().health();
}

export { safeKey };
export type { StorageHealth, StorageProvider, StoredObject };
