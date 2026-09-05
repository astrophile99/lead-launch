import { Badge, InfoNote, Meter, Panel, PanelHeader, ScoreBadge } from "@/components/ui/primitives";
import type { AuditSignals } from "@/types";
import { formatDateTime } from "@/lib/utils";

const SEVERITY_TONE = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "neutral",
  info: "info",
} as const;

const EFFORT_LABEL = { low: "Low effort", medium: "Medium effort", high: "High effort" };

export type FindingRow = {
  id: string;
  category: string;
  severity: keyof typeof SEVERITY_TONE;
  title: string;
  whatIsWrong: string;
  whyItMatters: string;
  recommendation: string;
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  evidence: string | null;
  source: string;
};

export function ScoreGrid({
  scores,
}: {
  scores: { label: string; value: number | null }[];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-3 px-4 py-3.5">
      {scores.map((s) => (
        <div key={s.label}>
          <p className="label mb-1">{s.label}</p>
          <div className="flex items-baseline gap-1 mb-1.5">
            <span className="tabular text-[18px] font-semibold leading-none">
              {s.value ?? "—"}
            </span>
            <span className="text-[11px] text-ink-4">/100</span>
          </div>
          <Meter
            value={s.value ?? 0}
            tone={s.value == null ? "neutral" : s.value >= 75 ? "ok" : s.value >= 50 ? "warn" : "danger"}
          />
        </div>
      ))}
    </div>
  );
}

export function FindingsList({ findings }: { findings: FindingRow[] }) {
  if (findings.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12.5px] text-ink-3">
        No findings recorded for this audit.
      </p>
    );
  }
  return (
    <ul>
      {findings.map((f) => (
        <li key={f.id} className="px-4 py-3.5 border-b border-line last:border-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
            <Badge tone="neutral">{f.category}</Badge>
            <h3 className="text-[13px] font-semibold text-ink flex-1 min-w-0">{f.title}</h3>
            <Badge tone={f.impact === "high" ? "warn" : "neutral"}>{f.impact} impact</Badge>
            <Badge tone="neutral">{EFFORT_LABEL[f.effort]}</Badge>
            {f.source !== "heuristic" ? <Badge tone="info">{f.source}</Badge> : null}
          </div>
          <dl className="grid gap-2 sm:grid-cols-3 text-[12.5px] leading-relaxed">
            <div>
              <dt className="label mb-0.5">What is wrong</dt>
              <dd className="text-ink-2">{f.whatIsWrong}</dd>
            </div>
            <div>
              <dt className="label mb-0.5">Why it matters</dt>
              <dd className="text-ink-2">{f.whyItMatters}</dd>
            </div>
            <div>
              <dt className="label mb-0.5">Recommended fix</dt>
              <dd className="text-ink-2">{f.recommendation}</dd>
            </div>
          </dl>
          {f.evidence ? (
            <p className="mt-2 font-mono text-[11.5px] text-ink-3 bg-surface-2 border border-line rounded-[2px] px-2 py-1 overflow-x-auto">
              {f.evidence}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function SignalsPanel({ signals }: { signals: AuditSignals }) {
  const rows: { group: string; items: [string, string][] }[] = [
    {
      group: "Response",
      items: [
        ["HTTP status", String(signals.fetch.httpStatus)],
        ["HTTPS", signals.fetch.https ? "yes" : "no"],
        ["Redirected", signals.fetch.redirected ? `yes → ${signals.fetch.finalUrl}` : "no"],
        ["Response time", `${signals.fetch.loadMs} ms`],
        ["Document size", `${Math.round(signals.fetch.bytes / 1024)} KB`],
        ["Server", signals.fetch.serverHeader ?? "not disclosed"],
      ],
    },
    {
      group: "Document",
      items: [
        ["Title", signals.html.title ?? "missing"],
        ["Title length", `${signals.html.titleLength} chars`],
        ["Meta description", signals.html.metaDescription ? `${signals.html.metaDescriptionLength} chars` : "missing"],
        ["Viewport", signals.html.viewport ?? "missing"],
        ["Language", signals.html.lang ?? "missing"],
        ["H1", signals.html.h1.length ? signals.html.h1.join(" | ") : "none"],
        ["Word count", String(signals.html.wordCount)],
        ["Structured data", signals.html.structuredDataTypes.join(", ") || "none"],
        ["Open Graph", signals.html.hasOpenGraph ? "present" : "missing"],
        ["Canonical", signals.html.canonical ?? "missing"],
        ["Landmarks", signals.html.semanticLandmarks.join(", ") || "none"],
      ],
    },
    {
      group: "Conversion",
      items: [
        ["Tap-to-call links", String(signals.conversion.phoneLinks)],
        ["Email links", String(signals.conversion.mailtoLinks)],
        ["WhatsApp links", String(signals.conversion.whatsappLinks)],
        ["Map links", String(signals.conversion.mapLinks)],
        ["Forms", String(signals.conversion.formCount)],
        ["Action above fold", signals.conversion.ctaAboveFold ? "yes" : "no"],
        ["Action labels", signals.conversion.ctaCandidates.slice(0, 5).join(", ") || "none found"],
        ["Booking language", signals.conversion.bookingKeywords.join(", ") || "none"],
        ["Social links", signals.conversion.socialLinks.join(", ") || "none"],
      ],
    },
    {
      group: "Assets & code",
      items: [
        ["Images", `${signals.media.imageCount} (${signals.media.imagesMissingAlt} without alt)`],
        ["Legacy image formats", String(signals.media.legacyFormatImages)],
        ["Images without size", String(signals.media.imagesWithoutDimensions)],
        ["Scripts", `${signals.scripts.scriptCount} (${signals.scripts.renderBlockingCount} render-blocking)`],
        ["Stylesheets", String(signals.scripts.stylesheetCount)],
        ["jQuery detected", signals.scripts.jqueryDetected ? "yes" : "no"],
        ["Platform", signals.platform.detected.join(", ") || "not identified"],
        ["Generator", signals.platform.generator ?? "none"],
      ],
    },
    {
      group: "Accessibility",
      items: [
        ["Unlabelled inputs", String(signals.accessibility.inputsWithoutLabels)],
        ["Links without text", String(signals.accessibility.linksWithoutText)],
        ["Buttons without text", String(signals.accessibility.buttonsWithoutText)],
        ["Skip link", signals.accessibility.hasSkipLink ? "present" : "missing"],
        ["Positive tabindex", String(signals.accessibility.tabindexPositive)],
      ],
    },
  ];

  if (signals.lighthouse) {
    rows.unshift({
      group: `Lighthouse — ${signals.lighthouse.source}`,
      items: [
        ["Performance", String(signals.lighthouse.performance ?? "—")],
        ["Accessibility", String(signals.lighthouse.accessibility ?? "—")],
        ["Best practices", String(signals.lighthouse.bestPractices ?? "—")],
        ["SEO", String(signals.lighthouse.seo ?? "—")],
        ["LCP", signals.lighthouse.lcpMs ? `${signals.lighthouse.lcpMs} ms` : "—"],
        ["CLS", signals.lighthouse.cls != null ? String(signals.lighthouse.cls) : "—"],
        ["TBT", signals.lighthouse.tbtMs ? `${signals.lighthouse.tbtMs} ms` : "—"],
      ],
    });
  }

  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3 px-4 py-4">
      {rows.map((section) => (
        <div key={section.group}>
          <p className="label mb-1.5">{section.group}</p>
          <dl className="text-[12px]">
            {section.items.map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1 border-b border-line last:border-0">
                <dt className="text-ink-3 w-40 shrink-0">{k}</dt>
                <dd className="text-ink-2 min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

export function AuditHeader({
  engine,
  isMock,
  url,
  completedAt,
  overall,
}: {
  engine: string;
  isMock: boolean;
  url: string | null;
  completedAt: Date | null;
  overall: number | null;
}) {
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            Website audit
            {isMock ? (
              <Badge tone="warn" title="Demo site. The document was synthesised locally and parsed by the real extractor.">
                Demo site
              </Badge>
            ) : (
              <Badge tone="ok">Live fetch</Badge>
            )}
          </span>
        }
        hint={
          url
            ? `${engine} · ${url} · ${completedAt ? formatDateTime(completedAt) : "in progress"}`
            : "No website on record."
        }
        actions={<ScoreBadge score={overall} size="lg" />}
      />
      {isMock ? (
        <div className="px-4 pt-3">
          <InfoNote tone="warn">
            This business is demo data, so its site cannot be fetched. A representative document was
            generated locally and then parsed by the same extractor used for real sites — the scoring
            path is identical, but the findings describe a synthetic page.
          </InfoNote>
        </div>
      ) : null}
    </Panel>
  );
}
