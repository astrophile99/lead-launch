import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { AppError, toAppError } from "@/lib/errors";
import type {
  Eligibility,
  MessagingHealth,
  MessagingProvider,
  MessagingTarget,
  SendOutcome,
  SendPayload,
} from "./types";

/**
 * Instagram messaging via the Meta Graph API.
 *
 * The honest constraint, stated up front: Instagram has no sanctioned way to
 * cold-DM a business that has not messaged you first. The Messaging API only
 * lets you reply inside a conversation the other party opened, within Meta's
 * messaging window. There is no compliant automation for the outreach case this
 * product is mostly used for.
 *
 * So this adapter does two real things:
 *   - replies to conversations that exist, when the window is open
 *   - refuses, with the reason, when it cannot
 *
 * It deliberately implements no scraping or browser automation. The Instagram
 * composer in the UI is still useful: it writes the message and you send it
 * from your own account.
 */

const GRAPH = "https://graph.facebook.com";

type GraphError = { error?: { message?: string; type?: string; code?: number } };

export class InstagramGraphProvider implements MessagingProvider {
  readonly id = "instagram-graph";
  readonly channel = "instagram" as const;
  readonly label = "Instagram (Meta Graph API)";
  readonly manualOnly = false;

  private async account(workspaceId: string) {
    return prisma.instagramAccount.findUnique({ where: { workspaceId } });
  }

  async isConfigured(workspaceId: string): Promise<boolean> {
    const acc = await this.account(workspaceId);
    return Boolean(acc?.igBusinessId && appConfig.instagram.accessToken);
  }

  async health(workspaceId: string): Promise<MessagingHealth> {
    const acc = await this.account(workspaceId);
    const hasToken = Boolean(appConfig.instagram.accessToken);
    const hasIds = Boolean(acc?.igBusinessId);

    const missing: string[] = [];
    if (!acc?.metaAppId) missing.push("Meta App ID");
    if (!acc?.igBusinessId) missing.push("Instagram Business ID");
    if (!acc?.pageId) missing.push("Linked Page ID");
    if (!hasToken) missing.push("INSTAGRAM_ACCESS_TOKEN");

    const status: MessagingHealth["status"] =
      acc?.status === "error" ? "error" : hasIds && hasToken ? "connected" : "not-configured";

    return {
      id: this.id,
      channel: this.channel,
      label: this.label,
      configured: hasIds && hasToken,
      status,
      detail:
        status === "error"
          ? (acc?.lastError ?? "The last call to Meta failed.")
          : status === "connected"
            ? `Connected as @${acc?.username ?? acc?.igBusinessId}. Replies only — Instagram does not permit cold DMs.`
            : `Missing: ${missing.join(", ")}.`,
      manualOnly: false,
      setupHint:
        "Link an Instagram Business account to a Facebook Page, add the Instagram product to your Meta app, and grant instagram_manage_messages. Put the token in INSTAGRAM_ACCESS_TOKEN on the server.",
      docsUrl: "https://developers.facebook.com/docs/messenger-platform/instagram",
    };
  }

  async eligibility(workspaceId: string, to: MessagingTarget): Promise<Eligibility> {
    if (!(await this.isConfigured(workspaceId))) {
      return { canSend: false, reason: "Instagram is not connected." };
    }
    if (!to.externalId) {
      return {
        canSend: false,
        reason:
          "Instagram only allows replies to conversations the other person started. There is no open conversation with this business, so this message has to be sent by hand.",
      };
    }

    const conversation = await prisma.instagramConversation.findFirst({
      where: { account: { workspaceId }, externalId: to.externalId },
    });
    if (!conversation) {
      return {
        canSend: false,
        reason: "No conversation on record for this recipient.",
      };
    }
    if (conversation.windowExpiresAt && conversation.windowExpiresAt.getTime() < Date.now()) {
      return {
        canSend: false,
        reason: `Meta's messaging window for this conversation closed on ${conversation.windowExpiresAt.toISOString().slice(0, 10)}. Wait for them to message again.`,
      };
    }
    return { canSend: true, reason: "Conversation is open and within the messaging window." };
  }

  async testConnection(workspaceId: string): Promise<{ ok: boolean; detail: string }> {
    const acc = await this.account(workspaceId);
    const token = appConfig.instagram.accessToken;
    if (!acc?.igBusinessId || !token) {
      return { ok: false, detail: "Instagram Business ID or INSTAGRAM_ACCESS_TOKEN is missing." };
    }

    try {
      const res = await fetch(
        `${GRAPH}/${appConfig.instagram.apiVersion}/${encodeURIComponent(acc.igBusinessId)}?fields=username,name,followers_count`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const payload = (await res.json()) as GraphError & {
        username?: string;
        name?: string;
        followers_count?: number;
      };

      if (!res.ok) {
        const detail = payload.error?.message ?? `Meta returned HTTP ${res.status}.`;
        await prisma.instagramAccount.update({
          where: { workspaceId },
          data: { status: "error", lastError: detail, lastCheckedAt: new Date() },
        });
        return { ok: false, detail };
      }

      await prisma.instagramAccount.update({
        where: { workspaceId },
        data: {
          status: "connected",
          lastError: null,
          lastCheckedAt: new Date(),
          username: payload.username ?? acc.username,
          tokenConfigured: true,
        },
      });

      return { ok: true, detail: `Connected as @${payload.username ?? acc.igBusinessId}.` };
    } catch (e) {
      const err = toAppError(e, "Check outbound network access to graph.facebook.com.");
      await prisma.instagramAccount.update({
        where: { workspaceId },
        data: { status: "error", lastError: err.message, lastCheckedAt: new Date() },
      });
      return { ok: false, detail: err.message };
    }
  }

  async send(workspaceId: string, payload: SendPayload): Promise<SendOutcome> {
    const eligible = await this.eligibility(workspaceId, payload.to);
    if (!eligible.canSend) {
      return { status: "manual", detail: eligible.reason };
    }

    const acc = await this.account(workspaceId);
    const token = appConfig.instagram.accessToken;
    if (!acc?.igBusinessId || !token) {
      return { status: "manual", detail: "Instagram is not connected, so nothing was sent." };
    }

    try {
      const res = await fetch(
        `${GRAPH}/${appConfig.instagram.apiVersion}/${encodeURIComponent(acc.igBusinessId)}/messages`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            recipient: { id: payload.to.externalId },
            message: { text: payload.body },
          }),
        },
      );
      const data = (await res.json()) as GraphError & { message_id?: string };

      if (!res.ok) {
        throw new AppError({
          kind: res.status === 429 ? "rate-limited" : "provider-error",
          message: data.error?.message ?? `Meta returned HTTP ${res.status}.`,
          remedy:
            "Confirm the conversation is still inside Meta's messaging window and that the token carries instagram_manage_messages.",
          retryable: res.status >= 500 || res.status === 429,
        });
      }

      return {
        status: "sent",
        externalId: data.message_id ?? null,
        detail: `Delivered to @${payload.to.handle ?? payload.to.externalId}.`,
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw toAppError(e, "Retry, or send the message from your own account.");
    }
  }
}
