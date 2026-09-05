import Link from "next/link";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime } from "@/lib/utils";
import { outreachProviderHealth } from "@/providers/outreach";
import { QueryTabs } from "@/components/ui/Tabs";
import { MessageActions } from "@/components/features/OutreachActions";
import {
  Badge,
  EmptyState,
  InfoNote,
  MockBadge,
  Panel,
  PanelHeader,
  PageHeader,
  StatTile,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  draft: "warn",
  approved: "info",
  sent: "ok",
  replied: "ok",
  bounced: "danger",
  "opted-out": "neutral",
};

export default async function OutreachPage({ searchParams }: PageProps<"/outreach">) {
  const sp = await searchParams;
  const status = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? "draft";
  const { workspaceId } = await getWorkspaceContext();

  const where = status === "all" ? {} : { status };

  const [messages, counts] = await Promise.all([
    prisma.outreachMessage.findMany({
      where: { prospect: { workspaceId }, ...where },
      include: {
        prospect: { include: { business: true } },
        events: { orderBy: { at: "desc" }, take: 4 },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.outreachMessage.groupBy({
      by: ["status"],
      where: { prospect: { workspaceId } },
      _count: { _all: true },
    }),
  ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>;
  const providers = outreachProviderHealth();
  const emailReady = providers.find((p) => p.id === "resend")?.configured ?? false;

  const tabs = [
    { id: "draft", label: "Awaiting approval", count: byStatus.draft ?? 0 },
    { id: "approved", label: "Approved", count: byStatus.approved ?? 0 },
    { id: "sent", label: "Sent", count: byStatus.sent ?? 0 },
    { id: "replied", label: "Replied", count: byStatus.replied ?? 0 },
    { id: "all", label: "All" },
  ];

  return (
    <>
      <PageHeader
        title="Outreach"
        description="Every message is written only from recorded audit observations, and nothing leaves the app without an explicit approval."
        meta={
          <>
            <Badge tone={emailReady ? "ok" : "neutral"}>
              {emailReady ? "Email transport ready" : "No email transport configured"}
            </Badge>
            <Badge tone="neutral">Limit: {appConfig.outreach.rateLimitPerHour}/hour</Badge>
          </>
        }
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-5 mb-5">
        <StatTile label="Awaiting approval" value={byStatus.draft ?? 0} tone={byStatus.draft ? "warn" : undefined} />
        <StatTile label="Approved" value={byStatus.approved ?? 0} />
        <StatTile label="Sent" value={byStatus.sent ?? 0} tone="ok" />
        <StatTile label="Replied" value={byStatus.replied ?? 0} tone="ok" />
        <StatTile label="Opted out" value={byStatus["opted-out"] ?? 0} />
      </div>

      <QueryTabs basePath="/outreach" param="status" current={status} tabs={tabs} />

      <div className="mt-5 flex flex-col gap-3">
        {messages.length === 0 ? (
          <Panel>
            <EmptyState
              title="Nothing here"
              body="Open a prospect that has been audited and draft a message. Drafts land here for review."
            />
          </Panel>
        ) : (
          messages.map((m) => (
            <Panel key={m.id}>
              <PanelHeader
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/prospects/${m.prospectId}?tab=outreach`}
                      className="hover:text-accent"
                    >
                      {m.prospect.business.name}
                    </Link>
                    <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
                    <Badge tone="neutral">{m.channel}</Badge>
                    <Badge tone="neutral">{m.variant}</Badge>
                    {m.provider === "mock" ? <MockBadge what="composed, not written by a model" /> : null}
                  </span>
                }
                hint={`${m.subject ? `Subject: ${m.subject} · ` : ""}Created ${formatDateTime(m.createdAt)}`}
                actions={
                  <MessageActions
                    messageId={m.id}
                    status={m.status}
                    channel={m.channel}
                    canTransmit={m.channel === "email" && emailReady}
                  />
                }
              />
              <pre
                id={`msg-${m.id}`}
                className="px-4 py-3 whitespace-pre-wrap font-sans text-[12.5px] text-ink-2 leading-relaxed"
              >
                {m.body}
              </pre>
              <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                {fromJson<string[]>(m.observationsJson, []).map((o) => (
                  <Badge key={o} tone="neutral" title="This message was grounded in this observation">
                    {o.length > 70 ? `${o.slice(0, 67)}…` : o}
                  </Badge>
                ))}
              </div>
              {m.events.length ? (
                <ul className="px-4 pb-3 text-[11.5px] text-ink-4">
                  {m.events.map((e) => (
                    <li key={e.id}>
                      {formatDateTime(e.at)} — {e.type}
                      {e.detail ? `: ${e.detail}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          ))
        )}
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Transports" hint="Adapters, not workarounds." />
          <ul>
            {providers.map((p) => (
              <li key={p.id} className="px-4 py-2.5 border-b border-line last:border-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[12.5px] text-ink font-medium">{p.label}</span>
                  <Badge tone={p.configured ? "ok" : "neutral"} className="ml-auto">
                    {p.configured ? "ready" : "manual"}
                  </Badge>
                </div>
                <p className="text-[11.5px] text-ink-3 leading-relaxed">{p.setupHint}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <InfoNote>
          <strong className="font-semibold">Why there is no “send to all”.</strong> Bulk cold
          messaging breaches the terms of every channel here except email, and even there it is the
          fastest way to lose a sending domain. Approval is per message, the hourly cap is enforced
          in the service layer rather than the UI, and prospects marked not interested are excluded
          from every subsequent draft.
        </InfoNote>
      </div>
    </>
  );
}
