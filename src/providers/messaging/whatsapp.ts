import { appConfig } from "@/config/app";
import { prisma } from "@/db/client";
import { AppError, toAppError } from "@/lib/errors";
import { normalisePhone } from "@/lib/utils";
import type {
  Eligibility,
  MessagingHealth,
  MessagingProvider,
  MessagingTarget,
  SendOutcome,
  SendPayload,
} from "./types";

/**
 * Meta WhatsApp Business — Cloud API.
 *
 * This is not a "WhatsApp API key" integration. Sending requires:
 *   - a Meta app (App ID)
 *   - a WhatsApp Business Account (WABA) id
 *   - a registered phone number and its Phone Number ID
 *   - a system-user access token with whatsapp_business_messaging
 *   - a verified webhook for delivery and inbound events
 *
 * The IDs live in the WhatsAppAccount row because they are configuration, not
 * secrets. The access token is a secret and is read from the server environment
 * only - it is never written to the database and never reaches the browser.
 *
 * Policy that this adapter enforces rather than works around: a business cannot
 * freely message a person who has not messaged first. Outside the 24-hour
 * customer service window, only an approved template may be sent. Cold outreach
 * to a number that has never contacted you is template-only, and Meta must have
 * approved that template.
 */

const GRAPH = "https://graph.facebook.com";

type GraphError = { error?: { message?: string; type?: string; code?: number } };

type SendResponse = GraphError & {
  messages?: { id: string }[];
  contacts?: { wa_id: string }[];
};

export class WhatsAppCloudProvider implements MessagingProvider {
  readonly id = "whatsapp-cloud";
  readonly channel = "whatsapp" as const;
  readonly label = "WhatsApp Business (Meta Cloud API)";
  readonly manualOnly = false;

  private async account(workspaceId: string) {
    return prisma.whatsAppAccount.findUnique({ where: { workspaceId } });
  }

  /** Configuration is complete only when the IDs *and* the secret are present. */
  async isConfigured(workspaceId: string): Promise<boolean> {
    const acc = await this.account(workspaceId);
    return Boolean(acc?.phoneNumberId && acc?.businessAccountId && appConfig.whatsapp.accessToken);
  }

  async health(workspaceId: string): Promise<MessagingHealth> {
    const acc = await this.account(workspaceId);
    const hasToken = Boolean(appConfig.whatsapp.accessToken);
    const hasIds = Boolean(acc?.phoneNumberId && acc?.businessAccountId);

    const missing: string[] = [];
    if (!acc?.metaAppId) missing.push("Meta App ID");
    if (!acc?.businessAccountId) missing.push("Business Account ID");
    if (!acc?.phoneNumberId) missing.push("Phone Number ID");
    if (!hasToken) missing.push("WHATSAPP_ACCESS_TOKEN");

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
            ? `Sending as ${acc?.displayPhoneNumber ?? acc?.phoneNumberId} on API ${acc?.apiVersion ?? appConfig.whatsapp.apiVersion}.`
            : `Missing: ${missing.join(", ")}.`,
      manualOnly: false,
      setupHint:
        "Create a Meta app, add the WhatsApp product, register a phone number, then paste the App ID, Business Account ID and Phone Number ID here. Put the system-user access token in WHATSAPP_ACCESS_TOKEN on the server.",
      docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    };
  }

  async eligibility(workspaceId: string, to: MessagingTarget): Promise<Eligibility> {
    if (!(await this.isConfigured(workspaceId))) {
      return { canSend: false, reason: "WhatsApp is not connected." };
    }
    if (!normalisePhone(to.phone)) {
      return { canSend: false, reason: "No usable phone number is on record for this business." };
    }
    // Cold outreach always falls outside the service window: the recipient has
    // not messaged us. Meta permits only an approved template here.
    return {
      canSend: true,
      requiresTemplate: true,
      reason:
        "This contact has not messaged you, so Meta requires an approved template rather than free-form text.",
    };
  }

  async testConnection(workspaceId: string): Promise<{ ok: boolean; detail: string }> {
    const acc = await this.account(workspaceId);
    const token = appConfig.whatsapp.accessToken;
    if (!acc?.phoneNumberId || !token) {
      return { ok: false, detail: "Phone Number ID or WHATSAPP_ACCESS_TOKEN is missing." };
    }

    const version = acc.apiVersion || appConfig.whatsapp.apiVersion;
    try {
      const res = await fetch(
        `${GRAPH}/${version}/${encodeURIComponent(acc.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const payload = (await res.json()) as GraphError & {
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
      };

      if (!res.ok) {
        const detail = payload.error?.message ?? `Meta returned HTTP ${res.status}.`;
        await prisma.whatsAppAccount.update({
          where: { workspaceId },
          data: { status: "error", lastError: detail, lastCheckedAt: new Date() },
        });
        return { ok: false, detail };
      }

      await prisma.whatsAppAccount.update({
        where: { workspaceId },
        data: {
          status: "connected",
          lastError: null,
          lastCheckedAt: new Date(),
          displayPhoneNumber: payload.display_phone_number ?? acc.displayPhoneNumber,
          tokenConfigured: true,
        },
      });

      return {
        ok: true,
        detail: `Connected as ${payload.verified_name ?? "unnamed"} (${payload.display_phone_number ?? acc.phoneNumberId})${
          payload.quality_rating ? `, quality ${payload.quality_rating}` : ""
        }.`,
      };
    } catch (e) {
      const err = toAppError(e, "Check outbound network access to graph.facebook.com.");
      await prisma.whatsAppAccount.update({
        where: { workspaceId },
        data: { status: "error", lastError: err.message, lastCheckedAt: new Date() },
      });
      return { ok: false, detail: err.message };
    }
  }

  async send(workspaceId: string, payload: SendPayload): Promise<SendOutcome> {
    const acc = await this.account(workspaceId);
    const token = appConfig.whatsapp.accessToken;

    if (!acc?.phoneNumberId || !token) {
      return {
        status: "manual",
        detail:
          "WhatsApp is not connected, so nothing was sent. Copy the message and send it yourself, or finish the setup in Settings → Integrations.",
      };
    }

    const phone = normalisePhone(payload.to.phone);
    if (!phone) {
      throw new AppError({
        kind: "invalid-input",
        message: `No usable phone number for ${payload.to.name}.`,
        remedy: "Add an international-format phone number to the business record.",
      });
    }

    // Meta expects the full number including country code, digits only.
    const wa = (payload.to.phone ?? "").replace(/\D+/g, "");
    const version = acc.apiVersion || appConfig.whatsapp.apiVersion;

    const body = payload.template
      ? {
          messaging_product: "whatsapp",
          to: wa,
          type: "template",
          template: {
            name: payload.template.name,
            language: { code: payload.template.language },
            components: payload.template.variables.length
              ? [
                  {
                    type: "body",
                    parameters: payload.template.variables.map((text) => ({ type: "text", text })),
                  },
                ]
              : [],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: wa,
          type: "text",
          text: { preview_url: false, body: payload.body },
        };

    try {
      const res = await fetch(`${GRAPH}/${version}/${encodeURIComponent(acc.phoneNumberId)}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as SendResponse;

      if (!res.ok) {
        const message = data.error?.message ?? `Meta returned HTTP ${res.status}.`;
        // 131047 / 131026: outside the service window, or the recipient cannot
        // receive this message. That is policy, not a transient failure.
        const policy = data.error?.code === 131047 || data.error?.code === 131026;
        throw new AppError({
          kind: policy ? "blocked" : res.status === 429 ? "rate-limited" : "provider-error",
          message,
          remedy: policy
            ? "Meta only allows an approved template for a contact who has not messaged you. Pick a template, or reach this prospect on another channel."
            : "Check the phone number format, the token's permissions, and the number's messaging limits in Meta Business Manager.",
          retryable: res.status >= 500 || res.status === 429,
          detail: data.error?.type,
        });
      }

      return {
        status: "sent",
        externalId: data.messages?.[0]?.id ?? null,
        detail: `Accepted by Meta for ${payload.to.phone}.`,
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw toAppError(e, "Retry, or send the message by hand from your own account.");
    }
  }
}
