import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime, formatNumber } from "@/lib/utils";
import {
  Badge,
  EmptyState,
  ErrorState,
  MockBadge,
  Panel,
  PanelHeader,
  PageHeader,
  ScoreBadge,
  StatTile,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { RerunCampaign } from "@/components/features/RerunCampaign";

export const dynamic = "force-dynamic";

export default async function CampaignPage({ params }: PageProps<"/discover/[id]">) {
  const { id } = await params;
  const { workspaceId } = await getWorkspaceContext();

  const campaign = await prisma.campaign.findFirst({
    where: { id, workspaceId },
    include: {
      prospects: {
        include: { business: true },
        orderBy: { opportunityScore: "desc" },
      },
    },
  });
  if (!campaign) notFound();

  const error = fromJson<{ message: string; remedy: string } | null>(campaign.error, null);

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`${campaign.category} in ${[campaign.area, campaign.city, campaign.country].filter(Boolean).join(", ")}`}
        meta={
          <>
            <Badge tone={campaign.status === "completed" ? "ok" : campaign.status === "failed" ? "danger" : "info"}>
              {campaign.status}
            </Badge>
            {campaign.isMock ? <MockBadge /> : <Badge tone="neutral">{campaign.provider}</Badge>}
            <span className="text-[11.5px] text-ink-3">
              Started {formatDateTime(campaign.startedAt ?? campaign.createdAt)}
            </span>
          </>
        }
        actions={<RerunCampaign campaignId={campaign.id} />}
      />

      {error ? (
        <div className="mb-5">
          <ErrorState title="This campaign failed" message={error.message} remedy={error.remedy} />
        </div>
      ) : null}

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-4">
        <StatTile label="Target" value={formatNumber(campaign.targetCount)} />
        <StatTile label="Discovered" value={formatNumber(campaign.discovered)} tone="ok" />
        <StatTile
          label="Duplicates skipped"
          value={formatNumber(campaign.duplicates)}
          sub="Already on file"
        />
        <StatTile label="Audited" value={formatNumber(campaign.audited)} />
      </div>

      <Panel className="mt-5">
        <PanelHeader
          title="Prospects from this campaign"
          hint={`${campaign.prospects.length} record${campaign.prospects.length === 1 ? "" : "s"}`}
        />
        {campaign.prospects.length === 0 ? (
          <EmptyState
            title="This campaign produced nothing"
            body="Either the provider returned no matches, or everything it returned was already on file. Widen the filters and rerun."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Business</Th>
                <Th>Area</Th>
                <Th className="text-right">Rating</Th>
                <Th className="text-right">Reviews</Th>
                <Th>Website</Th>
                <Th className="text-right">Site</Th>
                <Th className="text-right">Opportunity</Th>
              </tr>
            </thead>
            <tbody>
              {campaign.prospects.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2 transition-colors">
                  <Td>
                    <Link href={`/prospects/${p.id}`} className="text-ink font-medium hover:text-accent">
                      {p.business.name}
                    </Link>
                  </Td>
                  <Td className="text-ink-3">{p.business.area ?? p.business.city}</Td>
                  <Td className="tabular text-right">{p.business.rating ?? "—"}</Td>
                  <Td className="tabular text-right">{p.business.reviewCount ?? "—"}</Td>
                  <Td className="max-w-56 truncate">
                    {p.business.website ? (
                      <span className="text-ink-3">{new URL(p.business.website).hostname}</span>
                    ) : (
                      <Badge tone="danger">None</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <ScoreBadge score={p.websiteScore} />
                  </Td>
                  <Td className="text-right">
                    <ScoreBadge score={p.opportunityScore} />
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
