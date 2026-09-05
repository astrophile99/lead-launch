import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names and resolves Tailwind conflicts, so a caller can override a
 * component default (`w-auto` over a built-in `w-full`) without the result
 * depending on stylesheet order.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Stable identity for de-duplication across discovery runs. */
export function dedupeKey(parts: {
  name: string;
  city: string;
  phone?: string | null;
  website?: string | null;
}): string {
  const phone = normalisePhone(parts.phone);
  if (phone) return `tel:${phone}`;
  const host = hostOf(parts.website);
  if (host) return `web:${host}`;
  return `nm:${slugify(parts.name)}|${slugify(parts.city)}`;
}

export function normalisePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 8) return null;
  return digits.slice(-10);
}

export function hostOf(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Accepts bare hostnames; rejects anything that is not http(s) or is local. */
export function normaliseUrl(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let u: URL;
  try {
    // See assertSafePublicUrl: only supply a scheme when one is absent, or
    // "ftp://host" becomes "https://ftp://host" and slips through.
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    u = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".")) return null;
  return u.toString();
}

export function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

export function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function formatCurrency(value?: number | null, currency = "INR"): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value?: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatPercent(value?: number | null, dp = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${round(value * 100, dp)}%`;
}

export function relativeTime(date?: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [1000, "second"],
    [60_000, "minute"],
    [3_600_000, "hour"],
    [86_400_000, "day"],
    [604_800_000, "week"],
    [2_592_000_000, "month"],
    [31_536_000_000, "year"],
  ];
  let chosen: [number, Intl.RelativeTimeFormatUnit] = units[0];
  for (const u of units) if (abs >= u[0]) chosen = u;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  return rtf.format(-Math.round(diff / chosen[0]), chosen[1]);
}

export function formatDateTime(date?: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatTime(date?: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-IN", { timeStyle: "short", hour12: false }).format(d);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Deterministic 32-bit hash - used for stable mock generation, never for security. */
export function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded PRNG so mock data is identical across restarts. */
export function seededRandom(seed: string): () => number {
  let s = hash(seed) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function groupBy<T, K extends string>(
  items: T[],
  key: (item: T) => K,
): Record<K, T[]> {
  return items.reduce(
    (acc, item) => {
      const k = key(item);
      (acc[k] ??= []).push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "1 finding" / "2 findings" - avoids the "1 findings" that reads as a bug. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
