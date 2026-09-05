import Link from "next/link";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { relativeTime } from "@/lib/utils";
import {
  Badge,
  EmptyState,
  InfoNote,
  Panel,
  PanelHeader,
  PageHeader,
  ScoreBadge,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  brief: "neutral",
  queued: "info",
  building: "info",
  ready: "ok",
  failed: "danger",
  deployed: "ok",
};

export default async function StudioPage() {
  const { workspaceId } = await getWorkspaceContext();

  const projects = await prisma.websiteProject.findMany({
    where: { workspaceId },
    include: {
      prospect: { include: { business: true } },
      versions: { orderBy: { version: "desc" }, take: 1 },
      _count: { select: { versions: true, deployments: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <>
      <PageHeader
        title="Website Studio"
        description="Each prospect gets an isolated project directory. Builds are versioned, archived and scored against a quality gate before anything is shown to a client."
        meta={<Badge tone="neutral">{projects.length} projects</Badge>}
      />

      {projects.length === 0 ? (
        <Panel>
          <EmptyState
            title="No website projects yet"
            body="Open a prospect, generate a website concept, and the project appears here with its brief ready to edit."
          />
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title="Projects" />
          <Table>
            <thead>
              <tr>
                <Th>Business</Th>
                <Th>Slug</Th>
                <Th>Status</Th>
                <Th className="text-right">Versions</Th>
                <Th className="text-right">Quality</Th>
                <Th className="text-right">Before</Th>
                <Th className="text-right">Deployments</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2 transition-colors">
                  <Td>
                    <Link href={`/studio/${p.id}`} className="text-ink font-medium hover:text-accent">
                      {p.prospect.business.name}
                    </Link>
                  </Td>
                  <Td className="font-mono text-[11.5px] text-ink-3">{p.slug}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status}</Badge>
                  </Td>
                  <Td className="tabular text-right">{p._count.versions}</Td>
                  <Td className="text-right">
                    <ScoreBadge score={p.versions[0]?.qualityScore ?? null} />
                  </Td>
                  <Td className="text-right">
                    <ScoreBadge score={p.prospect.websiteScore} />
                  </Td>
                  <Td className="tabular text-right">{p._count.deployments}</Td>
                  <Td className="text-ink-3">{relativeTime(p.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <div className="mt-5">
        <InfoNote>
          <strong className="font-semibold">How builds work.</strong> With no{" "}
          <code>codeGeneration</code> provider configured, the built-in scaffolder produces the site
          — a real, runnable, deployable static project, generated deterministically rather than
          written by a model. Configure an AI provider and the same contract runs the agent path
          instead, starting from the scaffold rather than an empty directory. Either way, the output
          is measured by the same quality gate.
        </InfoNote>
      </div>
    </>
  );
}
