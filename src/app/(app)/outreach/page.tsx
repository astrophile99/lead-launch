import Link from "next/link";
import { appConfig } from "@/config/app";
import { getWorkspaceContext } from "@/db/workspace";
import { messagingHealth } from "@/providers/messaging";
import { listVoices } from "@/services/voice";
import { QueryTabs } from "@/components/ui/Tabs";
import { ChannelStatus } from "@/components/features/OutreachActions";
import { OutreachCenter } from "@/components/features/OutreachCenter";
import { listQueue, parseQueueFilters } from "@/services/outreach-queue";
import { VoiceStudio, type VoiceView } from "@/components/features/VoiceStudio";
import {
  Badge,
  InfoNote,
  Panel,
  PanelHeader,
  PageHeader,
  StatTile,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";
export const metadata = { title: "Outreach" };

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
  const { workspaceId } = await getWorkspaceContext();

  const [queue, health, voices] = await Promise.all([
    listQueue(workspaceId, parseQueueFilters(sp)),
    messagingHealth(workspaceId),
    listVoices(workspaceId),
  ]);

  const byStatus = queue.counts;

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

  return (
    <>
      <PageHeader
        title="Outreach"
        description="One queue for Gmail, WhatsApp and Instagram. Every message is written only from recorded observations, and nothing leaves the building until you read it and press send."
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
          <OutreachCenter rows={queue.rows} counts={queue.counts} />
        ) : null}

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
