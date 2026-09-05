import Link from "next/link";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { getBusinessDataProvider } from "@/providers/business-data";
import { getSettings } from "@/services/settings";
import { CampaignForm } from "@/components/features/CampaignForm";
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

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  completed: "ok",
  running: "info",
  failed: "danger",
  draft: "neutral",
  cancelled: "warn",
};

export default async function DiscoverPage() {
  const { workspaceId } = await getWorkspaceContext();
  const settings = await getSettings(workspaceId);
  const provider = getBusinessDataProvider(settings.discoveryProvider);

  const campaigns = await prisma.campaign.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return (
    <>
      <PageHeader
        title="Discover"
        description="Search a category and area, de-duplicate against everything already on file, and optionally audit each result as it lands."
        meta={
          provider.isMock ? (
            <MockBadge what={`Provider: ${provider.label}`} />
          ) : (
            <Badge tone="ok">Provider: {provider.label}</Badge>
          )
        }
      />

      <CampaignForm providerLabel={provider.label} isMock={provider.isMock} />

      <Panel className="mt-5">
        <PanelHeader title="Campaigns" hint="Counters reflect work that actually completed." />
        {campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns yet"
            body="Every run is saved so you can rerun the same query later and pick up only what is new."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Query</Th>
                <Th className="text-right">Target</Th>
                <Th className="text-right">Found</Th>
                <Th className="text-right">Dupes</Th>
                <Th className="text-right">Audited</Th>
                <Th>Status</Th>
                <Th>Run</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2 transition-colors">
                  <Td>
                    <Link href={`/discover/${c.id}`} className="text-ink font-medium hover:text-accent">
                      {c.name}
                    </Link>
                    {c.isMock ? <span className="ml-2"><MockBadge what="demo" /></span> : null}
                  </Td>
                  <Td className="text-ink-3">
                    {c.category} · {[c.area, c.city].filter(Boolean).join(", ")}
                    {c.minRating ? ` · ≥${c.minRating}★` : ""}
                    {c.minReviews ? ` · ≥${c.minReviews} reviews` : ""}
                    {c.websiteFilter !== "any" ? ` · ${c.websiteFilter} site` : ""}
                  </Td>
                  <Td className="tabular text-right">{c.targetCount}</Td>
                  <Td className="tabular text-right text-ink font-medium">{c.discovered}</Td>
                  <Td className="tabular text-right">{c.duplicates}</Td>
                  <Td className="tabular text-right">{c.audited}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                  </Td>
                  <Td className="text-ink-3" title={formatDateTime(c.createdAt)}>
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
