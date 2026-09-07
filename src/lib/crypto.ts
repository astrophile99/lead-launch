import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";

/**
 * Encryption for provider credentials at rest.
 *
 * OAuth refresh tokens are long-lived keys to somebody's mailbox. Storing them
 * as plaintext in a row that a database backup, a log drain or a misconfigured
 * read replica could expose is not acceptable, so they are sealed here with
 * AES-256-GCM and only ever opened inside the provider that needs them.
 *
 * The key comes from TOKEN_ENCRYPTION_KEY. Without it the app refuses to store
 * a token at all — it does not fall back to plaintext, because a silent
 * downgrade is worse than a visible refusal.
 */

const VERSION = "v1";

function key(): Buffer {
  const raw = appConfig.security.tokenEncryptionKey;
  if (!raw) {
    throw new AppError({
      kind: "not-configured",
      message: "No TOKEN_ENCRYPTION_KEY is set, so provider tokens cannot be stored safely.",
      remedy:
        "Generate one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` and set TOKEN_ENCRYPTION_KEY on the server.",
    });
  }
  // Accept a base64 32-byte key, or derive one from a longer passphrase. Both
  // end up as exactly 32 bytes; neither is ever logged.
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(raw, "utf8").digest();
}

export function canEncrypt(): boolean {
  return Boolean(appConfig.security.tokenEncryptionKey);
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(
    ".",
  );
}

export function decryptSecret(sealed: string): string {
  const [version, ivB64, tagB64, dataB64] = sealed.split(".");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new AppError({
      kind: "internal",
      message: "A stored credential could not be read.",
      remedy: "Reconnect the integration. The stored token is unreadable and must be replaced.",
    });
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key, or tampering. Either way the token is unusable and the user
    // must re-authorise; we do not say which, because that is a probing oracle.
    throw new AppError({
      kind: "not-configured",
      message: "The stored credential could not be decrypted.",
      remedy:
        "TOKEN_ENCRYPTION_KEY has changed since this integration was connected. Reconnect it.",
    });
  }
}

/** Constant-time string compare, for tokens echoed back to us. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Never render a secret. This is what the UI shows instead. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "not set";
  if (value.length <= 8) return "••••••••";
  return `••••••••${value.slice(-4)}`;
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}
