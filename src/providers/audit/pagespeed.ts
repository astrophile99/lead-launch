import { appConfig } from "@/config/app";
import { AppError, notConfigured, toAppError } from "@/lib/errors";
import { assertSafePublicUrl } from "@/lib/safe-url";
import { round } from "@/lib/utils";
import type { AuditSignals } from "@/types";
import { FetchHeuristicAuditProvider } from "./fetch-heuristic";
import type { AuditProvider, AuditProviderResult } from "./types";

/**
 * Lighthouse-backed auditor via the PageSpeed Insights API.
 *
 * PSI runs the real Lighthouse suite on Google's infrastructure, which gives us
 * genuine Core Web Vitals without shipping a headless Chrome. We still run the
 * built-in extractor alongside it so the UX/conversion signals - which
 * Lighthouse does not model - remain available.
 */

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, { numericValue?: number }>;
  };
  error?: { message?: string };
};

function pct(score?: number | null): number | null {
  return score == null ? null : Math.round(score * 100);
}

export class PageSpeedAuditProvider implements AuditProvider {
  readonly id = "lighthouse-psi";
  readonly label = "Lighthouse (PageSpeed Insights)";
  readonly isMock = false;

  private readonly base = new FetchHeuristicAuditProvider();

  isConfigured(): boolean {
    return Boolean(appConfig.audit.pagespeed);
  }

  async inspect(rawUrl: string): Promise<AuditProviderResult> {
    const key = appConfig.audit.pagespeed;
    if (!key) {
      throw notConfigured(
        "PageSpeed Insights",
        "Add PAGESPEED_API_KEY to .env, or leave it unset to use the built-in fetch auditor.",
      );
    }
    const url = assertSafePublicUrl(rawUrl);

    // The document-level signals still come from our own extractor.
    const base = await this.base.inspect(url.toString());

    const params = new URLSearchParams({
      url: url.toString(),
      key,
      strategy: "mobile",
    });
    for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
      params.append("category", c);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(`${ENDPOINT}?${params}`, { signal: controller.signal });
      const payload = (await res.json()) as PsiResponse;
      if (!res.ok) {
        throw new AppError({
          kind: res.status === 429 ? "rate-limited" : "provider-error",
          message: payload.error?.message ?? `PageSpeed returned HTTP ${res.status}.`,
          remedy:
            res.status === 429
              ? "PageSpeed quota exhausted. Wait, or fall back to the built-in auditor."
              : "Verify PAGESPEED_API_KEY and that the target URL is publicly reachable.",
          retryable: true,
        });
      }

      const cats = payload.lighthouseResult?.categories ?? {};
      const audits = payload.lighthouseResult?.audits ?? {};
      const lighthouse: NonNullable<AuditSignals["lighthouse"]> = {
        performance: pct(cats.performance?.score),
        accessibility: pct(cats.accessibility?.score),
        bestPractices: pct(cats["best-practices"]?.score),
        seo: pct(cats.seo?.score),
        lcpMs: audits["largest-contentful-paint"]?.numericValue
          ? Math.round(audits["largest-contentful-paint"].numericValue)
          : null,
        cls: audits["cumulative-layout-shift"]?.numericValue != null
          ? round(audits["cumulative-layout-shift"].numericValue, 3)
          : null,
        tbtMs: audits["total-blocking-time"]?.numericValue
          ? Math.round(audits["total-blocking-time"].numericValue)
          : null,
        source: "PageSpeed Insights (mobile)",
      };

      return {
        engine: this.id,
        isMock: false,
        signals: { ...base.signals, lighthouse },
      };
    } catch (e) {
      throw toAppError(e, "Retry, or unset PAGESPEED_API_KEY to use the built-in auditor.");
    } finally {
      clearTimeout(timer);
    }
  }
}
