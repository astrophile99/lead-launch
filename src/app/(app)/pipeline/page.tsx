import Link from "next/link";
import { OPEN_STAGES, type PipelineStage } from "@/config/pipeline";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { formatCurrency, relativeTime } from "@/lib/utils";
import { PipelineBoard, type BoardCard } from "@/components/features/PipelineBoard";
import {
  Badge,
  EmptyState,
  Panel,
  PanelHeader,
  PageHeader,
  StatTile,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const { workspaceId } = await getWorkspaceContext();

  const [prospects, openTasks, openValue] = await Promise.all([
    prisma.prospect.findMany({
      where: { workspaceId },
      include: {
        business: { select: { name: true, category: true, area: true, city: true } },
        tasks: { where: { status: "open" }, orderBy: { dueAt: "asc" }, take: 1 },
        activities: { orderBy: { at: "desc" }, take: 1, select: { at: true } },
      },
      orderBy: { opportunityScore: "desc" },
    }),
    prisma.task.findMany({
      where: { workspaceId, status: "open", dueAt: { lt: new Date() } },
      include: { prospect: { include: { business: { select: { name: true } } } } },
      orderBy: { dueAt: "asc" },
      take: 10,
    }),
    prisma.prospect.aggregate({
      where: { workspaceId, stage: { in: OPEN_STAGES } },
      _sum: { estimatedValue: true },
    }),
  ]);

  const cards: BoardCard[] = prospects.map((p) => ({
    id: p.id,
    name: p.business.name,
    category: p.business.category,
    area: p.business.area ?? p.business.city,
    stage: p.stage as PipelineStage,
    opportunityScore: p.opportunityScore,
    websiteScore: p.websiteScore,
    estimatedValue: p.estimatedValue,
    lastActivity: p.activities[0]?.at.toISOString() ?? null,
    nextAction: p.tasks[0]?.title ?? null,
    nextActionTaskId: p.tasks[0]?.id ?? null,
  }));

  const won = cards.filter((c) => c.stage === "won");

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Drag a card to change its stage, or use the selector on the card. Stage changes are written to the activity log."
        meta={<Badge tone="neutral">{cards.length} prospects</Badge>}
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-4 mb-5">
        <StatTile label="Open pipeline value" value={formatCurrency(openValue._sum.estimatedValue ?? 0)} />
        <StatTile label="Won" value={won.length} tone={won.length ? "ok" : undefined} />
        <StatTile label="Overdue actions" value={openTasks.length} tone={openTasks.length ? "danger" : undefined} />
        <StatTile
          label="Active stages"
          value={new Set(cards.filter((c) => OPEN_STAGES.includes(c.stage)).map((c) => c.stage)).size}
        />
      </div>

      {cards.length === 0 ? (
        <Panel>
          <EmptyState title="Pipeline is empty" body="Discover prospects and they will appear in the first column." />
        </Panel>
      ) : (
        <PipelineBoard cards={cards} />
      )}

      {openTasks.length ? (
        <Panel className="mt-5">
          <PanelHeader title="Overdue" hint="Suggested actions whose due date has passed." />
          <ul>
            {openTasks.map((t) => (
              <li key={t.id} className="px-4 py-2.5 border-b border-line last:border-0 flex items-center gap-3">
                <span className="size-1.5 rounded-full bg-danger shrink-0" />
                <span className="text-[12.5px] text-ink-2 flex-1 min-w-0 truncate">{t.title}</span>
                {t.prospect ? (
                  <Link
                    href={`/prospects/${t.prospectId}`}
                    className="text-[12px] text-ink-3 hover:text-accent truncate max-w-56"
                  >
                    {t.prospect.business.name}
                  </Link>
                ) : null}
                <span className="text-[11.5px] text-danger shrink-0">
                  {t.dueAt ? relativeTime(t.dueAt) : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
