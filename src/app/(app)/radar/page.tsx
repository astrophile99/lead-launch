import Link from "next/link";
import { TIERS, type OpportunityTier } from "@/config/scoring";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatCurrency } from "@/lib/utils";
import type { OpportunityReason } from "@/types";
import {
  Badge,
  EmptyState,
  InfoNote,
  Meter,
  Panel,
  PageHeader,
  ScoreBadge,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

type Row = {
  prospectId: string;
  name: string;
  category: string;
  area: string;
  rating: number | null;
  reviewCount: number | null;
  websiteScore: number | null;
  hasWebsite: boolean;
  score: number;
  tier: OpportunityTier;
  labels: string[];
  reasons: OpportunityReason[];
  estimatedValue: number | null;
};

export default async function RadarPage({ searchParams }: PageProps<"/radar">) {
  const sp = await searchParams;
  const focus = (Array.isArray(sp.tier) ? sp.tier[0] : sp.tier) ?? null;
  const { workspaceId } = await getWorkspaceContext();

  const prospects = await prisma.prospect.findMany({
    where: { workspaceId, opportunityScore: { not: null } },
    include: {
      business: true,
      opportunities: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { opportunityScore: "desc" },
  });

  const rows: Row[] = prospects
    .map((p) => {
      const o = p.opportunities[0];
      if (!o) return null;
      return {
        prospectId: p.id,
        name: p.business.name,
        category: p.business.category,
        area: p.business.area ?? p.business.city,
        rating: p.business.rating,
        reviewCount: p.business.reviewCount,
        websiteScore: p.websiteScore,
        hasWebsite: Boolean(p.business.website),
        score: o.score,
        tier: o.tier as OpportunityTier,
        labels: fromJson<string[]>(o.labelsJson, []),
        reasons: fromJson<OpportunityReason[]>(o.reasonsJson, []),
        estimatedValue: p.estimatedValue,
      } satisfies Row;
    })
    .filter((r): r is Row => r !== null);

  const shown = TIERS.filter((t) => !focus || t.id === focus);

  return (
    <>
      <PageHeader
        title="Opportunity Radar"
        description="Prospects grouped by what the score actually says about them. Open any card to see the reasoning behind its number."
        meta={
          <>
            <Badge tone="neutral">{rows.length} scored</Badge>
            {focus ? (
              <Link href="/radar" className="text-[12px] text-accent hover:underline underline-offset-2">
                Clear filter
              </Link>
            ) : null}
          </>
        }
      />

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nothing scored yet"
            body="Prospects are scored automatically once they have been audited. Run a campaign, then audit the queue."
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-6">
          {shown.map((tier) => {
            const items = rows.filter((r) => r.tier === tier.id);
            return (
              <section key={tier.id}>
                <header className="flex items-baseline gap-3 mb-2.5">
                  <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2">
                    <span aria-hidden>{tier.glyph}</span>
                    {tier.label}
                  </h2>
                  <span className="tabular text-[12px] text-ink-3">{items.length}</span>
                  <p className="text-[11.5px] text-ink-3 flex-1 min-w-0 truncate">{tier.description}</p>
                  {!focus && items.length ? (
                    <Link
                      href={`/radar?tier=${tier.id}`}
                      className="text-[11.5px] text-accent hover:underline underline-offset-2 shrink-0"
                    >
                      Focus
                    </Link>
                  ) : null}
                </header>

                {items.length === 0 ? (
                  <p className="text-[12px] text-ink-4 border border-dashed border-line rounded-[3px] px-3 py-4">
                    No prospects in this band.
                  </p>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((r) => {
                      const positives = r.reasons.filter((x) => x.direction === "positive").slice(0, 3);
                      const negatives = r.reasons.filter((x) => x.direction === "negative").slice(0, 2);
                      return (
                        <Link
                          key={r.prospectId}
                          href={`/prospects/${r.prospectId}?tab=opportunity`}
                          className="group bg-surface border border-line rounded-[3px] p-3.5 shadow-panel hover:border-line-strong transition-colors flex flex-col gap-2.5"
                        >
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-semibold text-ink truncate group-hover:text-accent transition-colors">
                                {r.name}
                              </p>
                              <p className="text-[11.5px] text-ink-3 truncate">
                                {r.category} · {r.area}
                                {r.rating != null ? ` · ${r.rating}★ (${r.reviewCount ?? 0})` : ""}
                              </p>
                            </div>
                            <ScoreBadge score={r.score} />
                          </div>

                          <Meter
                            value={r.score}
                            tone={r.score >= 75 ? "ok" : r.score >= 50 ? "warn" : "danger"}
                          />

                          {r.labels.length ? (
                            <div className="flex flex-wrap gap-1">
                              {r.labels.slice(0, 3).map((l) => (
                                <Badge key={l} tone="accent">
                                  {l}
                                </Badge>
                              ))}
                            </div>
                          ) : null}

                          <ul className="text-[11.5px] leading-snug flex flex-col gap-1">
                            {positives.map((p) => (
                              <li key={p.text} className="text-ink-2 flex gap-1.5">
                                <span className="text-ok shrink-0">+</span>
                                <span className="min-w-0">{p.text}</span>
                              </li>
                            ))}
                            {negatives.map((p) => (
                              <li key={p.text} className="text-ink-3 flex gap-1.5">
                                <span className="text-danger shrink-0">−</span>
                                <span className="min-w-0">{p.text}</span>
                              </li>
                            ))}
                          </ul>

                          <div className="flex items-center gap-2 pt-0.5 mt-auto">
                            {r.hasWebsite ? (
                              <ScoreBadge score={r.websiteScore} label="site" />
                            ) : (
                              <Badge tone="danger">No site</Badge>
                            )}
                            <span className="tabular ml-auto text-[11.5px] text-ink-3">
                              {formatCurrency(r.estimatedValue)}
                            </span>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6">
        <InfoNote>
          Tiers are assigned from the score together with reachability and evidence volume — a high
          score with no contact detail is not an immediate opportunity. The weights behind the score
          are editable in <Link href="/settings" className="text-accent underline underline-offset-2">Settings</Link>.
        </InfoNote>
      </div>
    </>
  );
}
