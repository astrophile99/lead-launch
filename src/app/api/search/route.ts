import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { truncate } from "@/lib/utils";

export type SearchHit = {
  id: string;
  kind: "prospect" | "campaign" | "project" | "outreach" | "note" | "task";
  title: string;
  subtitle: string;
  href: string;
};

/** Global search. Scoped to the caller's workspace at every query. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ hits: [] satisfies SearchHit[] });

  const { workspaceId } = await getWorkspaceContext();
  const like = { contains: q } as const;

  const [prospects, campaigns, projects, messages, notes, tasks] = await Promise.all([
    prisma.prospect.findMany({
      where: {
        workspaceId,
        OR: [
          { business: { name: like } },
          { business: { category: like } },
          { business: { area: like } },
          { business: { city: like } },
        ],
      },
      include: { business: true },
      take: 8,
      orderBy: { opportunityScore: "desc" },
    }),
    prisma.campaign.findMany({
      where: { workspaceId, OR: [{ name: like }, { category: like }, { city: like }] },
      take: 4,
      orderBy: { createdAt: "desc" },
    }),
    prisma.websiteProject.findMany({
      where: { workspaceId, slug: like },
      include: { prospect: { include: { business: true } } },
      take: 4,
    }),
    prisma.outreachMessage.findMany({
      where: { prospect: { workspaceId }, OR: [{ subject: like }, { body: like }] },
      include: { prospect: { include: { business: true } } },
      take: 4,
      orderBy: { createdAt: "desc" },
    }),
    prisma.note.findMany({
      where: { prospect: { workspaceId }, body: like },
      include: { prospect: { include: { business: true } } },
      take: 4,
      orderBy: { createdAt: "desc" },
    }),
    prisma.task.findMany({
      where: { workspaceId, title: like, status: "open" },
      include: { prospect: { include: { business: true } } },
      take: 4,
    }),
  ]);

  const hits: SearchHit[] = [
    ...prospects.map((p) => ({
      id: p.id,
      kind: "prospect" as const,
      title: p.business.name,
      subtitle: `${p.business.category} · ${p.business.area ?? p.business.city}${
        p.opportunityScore != null ? ` · ${p.opportunityScore}/100` : ""
      }`,
      href: `/prospects/${p.id}`,
    })),
    ...campaigns.map((c) => ({
      id: c.id,
      kind: "campaign" as const,
      title: c.name,
      subtitle: `Campaign · ${c.discovered} discovered · ${c.status}`,
      href: `/discover/${c.id}`,
    })),
    ...projects.map((p) => ({
      id: p.id,
      kind: "project" as const,
      title: p.prospect.business.name,
      subtitle: `Website project · ${p.status}`,
      href: `/studio/${p.id}`,
    })),
    ...messages.map((m) => ({
      id: m.id,
      kind: "outreach" as const,
      title: m.subject ?? `${m.variant} ${m.channel} message`,
      subtitle: `${m.prospect.business.name} · ${m.status}`,
      href: `/prospects/${m.prospectId}?tab=outreach`,
    })),
    ...notes.map((n) => ({
      id: n.id,
      kind: "note" as const,
      title: truncate(n.body, 60),
      subtitle: `Note on ${n.prospect.business.name}`,
      href: `/prospects/${n.prospectId}?tab=notes`,
    })),
    ...tasks.map((t) => ({
      id: t.id,
      kind: "task" as const,
      title: t.title,
      subtitle: t.prospect ? `Task on ${t.prospect.business.name}` : "Task",
      href: t.prospectId ? `/prospects/${t.prospectId}` : "/pipeline",
    })),
  ];

  return NextResponse.json({ hits });
}
