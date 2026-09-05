import { AppError } from "@/lib/errors";

/**
 * SSRF guard for the audit engine.
 *
 * The auditor fetches URLs that came from a third-party data provider, so it
 * must never be pointed at internal infrastructure. We reject non-http(s)
 * schemes, credentials in the URL, and hostnames that resolve to loopback,
 * link-local or RFC1918 space by literal address.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "instance-data",
]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "::1" ||
    h === "::" ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("fe80")
  );
}

export function assertSafePublicUrl(raw: string): URL {
  let url: URL;
  try {
    // Only add a scheme when the input has none at all. Prefixing anything that
    // merely fails to start with "http" would turn "ftp://host" into
    // "https://ftp://host", which parses cleanly and smuggles the scheme past
    // the check below.
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    url = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    throw new AppError({
      kind: "invalid-input",
      message: `"${raw}" is not a valid URL.`,
      remedy: "Correct the website address on the business record and re-run the audit.",
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError({
      kind: "invalid-input",
      message: `Unsupported scheme "${url.protocol}".`,
      remedy: "Only http and https URLs can be audited.",
    });
  }

  if (url.username || url.password) {
    throw new AppError({
      kind: "invalid-input",
      message: "URLs containing credentials are not audited.",
      remedy: "Remove the embedded credentials from the stored website address.",
    });
  }

  const host = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateIPv4(host) ||
    isPrivateIPv6(host)
  ) {
    throw new AppError({
      kind: "blocked",
      message: `Refusing to audit "${host}" - it points at a private or internal address.`,
      remedy: "Audits only run against public websites.",
    });
  }

  return url;
}

/** Reserved-for-documentation TLDs used by the mock data set. */
export function isReservedExampleHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.endsWith(".example") ||
    h.endsWith(".invalid") ||
    h.endsWith(".test") ||
    h === "example.com" ||
    h.endsWith(".example.com")
  );
}
