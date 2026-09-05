import Link from "next/link";
import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { getWorkspaceContext } from "@/db/workspace";
import { fromJson } from "@/lib/json";
import { formatDateTime } from "@/lib/utils";
import { messagingHealth } from "@/providers/messaging";
import { listVoices } from "@/services/voice";
import { QueryTabs } from "@/components/ui/Tabs";
import { ChannelStatus, MessageActions } from "@/components/features/OutreachActions";
import { VoiceStudio, type VoiceView } from "@/components/features/VoiceStudio";
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
export const metadata = { title: "Outreach" };

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  draft: "warn",
  approved: "info",
  sent: "ok",
  replied: "ok",
  bounced: "danger",
  "opted-out": "neutral",
};

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  instagram: "Instagram DM",
  linkedin: "LinkedIn",
  generic: "Generic",
};

export default async function OutreachPage({ searchParams }: PageProps<"/outreach">) {
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "messages";
  const status = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? "draft";
  const { workspaceId } = await getWorkspaceContext();

  const where = status === "all" ? {} : { status };

  const [messages, counts, health, voices] = await Promise.all([
    tab === "messages"
      ? prisma.outreachMessage.findMany({
          where: { prospect: { workspaceId }, ...where },
          include: {
            prospect: { include: { business: true } },
            events: { orderBy: { at: "desc" }, take: 4 },
          },
          orderBy: { createdAt: "desc" },
          take: 40,
        })
      : [],
    prisma.outreachMessage.groupBy({
      by: ["status"],
      where: { prospect: { workspaceId } },
      _count: { _all: true },
    }),
    messagingHealth(workspaceId),
    listVoices(workspaceId),
  ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<
    string,
    number
  >;
  const healthByChannel = new Map(health.map((h) => [h.channel, h]));

  const voiceViews: VoiceView[] = voices.map((v) => ({
    id: v.id,
    name: v.name,
    isDefault: v.isDefault,
    tone: v.tone,
    length: v.length,
    salesIntensity: v.salesIntensity,
    formality: v.formality,
    personality: v.personality,
    customInstructions: v.customInstructions,
    exampleMessages: v.exampleMessages,
    analysis: v.analysis,
    analysedAt: v.analysedAt?.toISOString() ?? null,
  }));

  const tabs = [
    { id: "messages", label: "Messages", count: byStatus.draft ?? 0 },
    { id: "voice", label: "Voice studio" },
    { id: "channels", label: "Channels", count: health.filter((h) => h.configured).length },
  ];

  const statusTabs = [
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
            <Badge tone="neutral">Limit: {appConfig.outreach.rateLimitPerHour}/hour</Badge>
            {health
              .filter((h) => h.configured)
              .map((h) => (
                <Badge key={h.id} tone="ok" dot>
                  {CHANNEL_LABEL[h.channel] ?? h.channel} ready
                </Badge>
              ))}
            {voiceViews.length === 0 ? (
              <Link
                href="/outreach?tab=voice"
                className="text-[12px] text-accent hover:underline underline-offset-2"
              >
                Set your voice →
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-2.5 grid-cols-2 md:grid-cols-5 mb-5">
        <StatTile
          label="Awaiting approval"
          value={byStatus.draft ?? 0}
          tone={byStatus.draft ? "warn" : undefined}
        />
        <StatTile label="Approved" value={byStatus.approved ?? 0} />
        <StatTile label="Sent" value={byStatus.sent ?? 0} tone="ok" />
        <StatTile label="Replied" value={byStatus.replied ?? 0} tone="ok" />
        <StatTile label="Opted out" value={byStatus["opted-out"] ?? 0} />
      </div>

      <QueryTabs basePath="/outreach" current={tab} tabs={tabs} />

      <div className="mt-5">
        {/* ------------------------------------------------------- messages */}
        {tab === "messages" ? (
          <>
            <div className="mb-4">
              <QueryTabs
                basePath="/outreach?tab=messages"
                param="status"
                current={status}
                tabs={statusTabs}
              />
            </div>

            <div className="flex flex-col gap-3">
              {messages.length === 0 ? (
                <Panel>
                  <EmptyState
                    title="Nothing here"
                    body="Open a prospect that has been audited and draft a message. Drafts land here for review before anything is sent."
                  />
                </Panel>
              ) : (
                messages.map((m) => {
                  const channelHealth = healthByChannel.get(
                    m.channel as (typeof health)[number]["channel"],
                  );
                  const canTransmit = Boolean(channelHealth?.configured);
                  return (
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
                            <Badge tone="neutral">{CHANNEL_LABEL[m.channel] ?? m.channel}</Badge>
                            <Badge tone="neutral">{m.variant}</Badge>
                            {m.provider === "mock" ? (
                              <MockBadge what="composed, not written by a model" />
                            ) : null}
                          </span>
                        }
                        hint={`${m.subject ? `Subject: ${m.subject} · ` : ""}${m.body.length} characters · created ${formatDateTime(m.createdAt)}`}
                        actions={
                          <MessageActions
                            messageId={m.id}
                            status={m.status}
                            canTransmit={canTransmit}
                            transmitReason={
                              channelHealth?.manualOnly
                                ? channelHealth.setupHint
                                : (channelHealth?.detail ??
                                  "This channel is not connected, so it must be sent by hand.")
                            }
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
                          <Badge
                            key={o}
                            tone="neutral"
                            title="This message was grounded in this observation"
                          >
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
                  );
                })
              )}
            </div>
          </>
        ) : null}

        {/* ---------------------------------------------------------- voice */}
        {tab === "voice" ? <VoiceStudio voices={voiceViews} /> : null}

        {/* ------------------------------------------------------- channels */}
        {tab === "channels" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader
                title="Transports"
                hint="Adapters against sanctioned APIs. There is no workaround path in this codebase."
              />
              <div className="p-4 grid gap-2.5">
                {health.map((h) => (
                  <ChannelStatus
                    key={h.id}
                    label={h.label}
                    status={h.status}
                    detail={h.status === "connected" ? h.detail : h.setupHint}
                  />
                ))}
              </div>
            </Panel>

            <div className="flex flex-col gap-5">
              <InfoNote>
                <strong className="font-semibold">Why there is no “send to all”.</strong> Bulk cold
                messaging breaches the terms of every channel here except email, and even there it
                is the fastest way to lose a sending domain. Approval is per message, the hourly cap
                is enforced in the service layer rather than the UI, and an opt-out is checked twice
                — when a draft is written and again before it sends.
              </InfoNote>

              <InfoNote tone="warn">
                <strong className="font-semibold">WhatsApp.</strong> Meta only permits an approved
                template for someone who has not messaged you first. Free-form text is limited to
                the 24-hour service window after they reply. The composer reflects that rather than
                letting you queue a message that would be rejected.
              </InfoNote>

              <InfoNote tone="warn">
                <strong className="font-semibold">Instagram.</strong> There is no sanctioned way to
                cold-DM a business. The API only allows replies inside a conversation the other
                party opened. The Instagram composer still writes the message; you send it from your
                own account.
              </InfoNote>

              <Panel>
                <PanelHeader title="Set up a channel" />
                <div className="p-4 flex flex-col gap-1.5">
                  <Link
                    href="/settings?tab=whatsapp"
                    className="text-[12.5px] text-accent hover:underline underline-offset-2"
                  >
                    Configure WhatsApp Business →
                  </Link>
                  <Link
                    href="/settings?tab=instagram"
                    className="text-[12.5px] text-accent hover:underline underline-offset-2"
                  >
                    Configure Instagram messaging →
                  </Link>
                  <Link
                    href="/settings?tab=integrations"
                    className="text-[12.5px] text-accent hover:underline underline-offset-2"
                  >
                    All integrations →
                  </Link>
                </div>
              </Panel>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
