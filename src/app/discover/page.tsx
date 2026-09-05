import Link from "next/link";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { listBusinessDataProviders } from "@/providers/business-data";
import { resolveRoute } from "@/providers/ai/router";
import { CampaignWizard, type ProviderChoice } from "@/components/features/CampaignWizard";
import {
  Badge,
  EmptyState,
  MockBadge,
  Panel,
  PanelHeader,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discover" };

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  completed: "ok",
  running: "info",
  failed: "danger",
  draft: "neutral",
  cancelled: "warn",
};

export default async function DiscoverPage() {
  const { workspaceId } = await getWorkspaceContext();

  const [campaigns, analysis] = await Promise.all([
    prisma.campaign.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    resolveRoute(workspaceId, "analysis"),
  ]);

  const providers: ProviderChoice[] = listBusinessDataProviders().map((p) => ({
    id: p.id,
    label: p.label,
    isMock: p.isMock,
    configured: p.isConfigured(),
  }));

  return (
    <>
      <PageHeader
        title="Find businesses worth building for"
        description="Search a category and area, de-duplicate against everything already on file, and optionally audit each result as it lands."
      />

      <CampaignWizard
        providers={providers}
        analysisRoute={{
          provider: analysis.provider.id,
          model: analysis.model,
          isMock: analysis.provider.isMock,
        }}
      />

      <Panel className="mt-5">
        <PanelHeader
          title="Campaigns"
          hint="Counters reflect work that actually completed, not work that was requested."
        />
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            body="Every run is saved so you can re-run the same query later and pick up only what is new."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th className="hidden md:table-cell">Query</Th>
                <Th className="text-right">Target</Th>
                <Th className="text-right">Found</Th>
                <Th className="text-right hidden sm:table-cell">Dupes</Th>
                <Th className="text-right hidden sm:table-cell">Audited</Th>
                <Th>Status</Th>
                <Th className="hidden lg:table-cell">Run</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2 transition-colors">
                  <Td>
                    <Link
                      href={`/discover/${c.id}`}
                      className="text-ink font-medium hover:text-accent"
                    >
                      {c.name}
                    </Link>
                    {c.isMock ? (
                      <span className="ml-2 align-middle">
                        <MockBadge what="demo" />
                      </span>
                    ) : null}
                    <span className="block md:hidden text-[11px] text-ink-4 mt-0.5">
                      {c.category} · {[c.area, c.city].filter(Boolean).join(", ")}
                    </span>
                  </Td>
                  <Td className="text-ink-3 hidden md:table-cell">
                    {c.category} · {[c.area, c.city].filter(Boolean).join(", ")}
                    {c.minRating ? ` · ≥${c.minRating}★` : ""}
                    {c.minReviews ? ` · ≥${c.minReviews} reviews` : ""}
                    {c.websiteFilter !== "any" ? ` · ${c.websiteFilter} site` : ""}
                  </Td>
                  <Td className="tabular text-right">{c.targetCount}</Td>
                  <Td className="tabular text-right text-ink font-medium">{c.discovered}</Td>
                  <Td className="tabular text-right hidden sm:table-cell">{c.duplicates}</Td>
                  <Td className="tabular text-right hidden sm:table-cell">{c.audited}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"} dot={c.status === "running"}>
                      {c.status}
                    </Badge>
                  </Td>
                  <Td className="text-ink-3 hidden lg:table-cell" title={formatDateTime(c.createdAt)}>
                    {relativeTime(c.completedAt ?? c.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
