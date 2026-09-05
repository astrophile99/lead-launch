import { hostOf } from "@/lib/utils";
import { isReservedExampleHost } from "@/lib/safe-url";
import { FetchHeuristicAuditProvider } from "./fetch-heuristic";
import { MockAuditProvider } from "./mock";
import { PageSpeedAuditProvider } from "./pagespeed";
import type { AuditProvider } from "./types";

const psi = new PageSpeedAuditProvider();
const fetchAuditor = new FetchHeuristicAuditProvider();
const mock = new MockAuditProvider();

/**
 * Chooses the auditor for a URL.
 *
 * Demo hostnames live under RFC 2606 reserved TLDs and cannot be fetched, so
 * they route to the mock auditor. Everything else gets a real HTTP request -
 * Lighthouse when a PageSpeed key exists, the built-in extractor otherwise.
 */
export function getAuditProvider(url: string): AuditProvider {
  const host = hostOf(url);
  if (host && isReservedExampleHost(host)) return mock;
  if (psi.isConfigured()) return psi;
  return fetchAuditor;
}

export function auditProviderHealth() {
  return [
    {
      id: psi.id,
      label: psi.label,
      configured: psi.isConfigured(),
      isMock: false,
      setupHint:
        "Optional. Set PAGESPEED_API_KEY for real Lighthouse scores including Core Web Vitals.",
    },
    {
      id: fetchAuditor.id,
      label: fetchAuditor.label,
      configured: true,
      isMock: false,
      setupHint:
        "Always available. One real HTTP request per audit; derives technical, SEO, UX and accessibility signals from the document.",
    },
    {
      id: mock.id,
      label: mock.label,
      configured: true,
      isMock: true,
      setupHint:
        "Used automatically for demo businesses, whose hostnames are reserved and cannot be fetched.",
    },
  ];
}

export { FetchHeuristicAuditProvider, MockAuditProvider, PageSpeedAuditProvider };
export type { AuditProvider };
