import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import type { OutreachChannel } from "@/types";

/**
 * Outreach dispatch adapters.
 *
 * There is no "blast" path anywhere in this layer. A provider either transmits
 * a single approved message, or returns status "manual" - meaning nothing was
 * sent and the user must do it themselves. Platforms without a sanctioned API
 * for cold contact (Instagram, WhatsApp for unsolicited messages) are always
 * manual by design; we do not automate around their terms.
 */

export type OutreachTarget = {
  email: string | null;
  phone: string | null;
  handle: string | null;
  name: string;
};

export type SendResult = {
  status: "sent" | "manual";
  detail: string;
};

export interface OutreachProvider {
  readonly id: string;
  readonly label: string;
  readonly setupHint: string;
  isConfigured(): boolean;
  send(input: { to: OutreachTarget; subject: string | null; body: string }): Promise<SendResult>;
}

class ResendEmailProvider implements OutreachProvider {
  readonly id = "resend";
  readonly label = "Resend (email)";
  readonly setupHint =
    "Set RESEND_API_KEY and OUTREACH_FROM_EMAIL in .env to send approved emails directly from the app.";

  isConfigured(): boolean {
    return Boolean(appConfig.outreach.resend && appConfig.outreach.fromEmail);
  }

  async send({
    to,
    subject,
    body,
  }: {
    to: OutreachTarget;
    subject: string | null;
    body: string;
  }): Promise<SendResult> {
    if (!this.isConfigured()) {
      return {
        status: "manual",
        detail: "No email provider is configured, so nothing was sent.",
      };
    }
    if (!to.email) {
      throw new AppError({
        kind: "invalid-input",
        message: `No email address on record for ${to.name}.`,
        remedy: "Add an email to the business record, or use a different channel.",
      });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${appConfig.outreach.resend}`,
      },
      body: JSON.stringify({
        from: appConfig.outreach.fromEmail,
        to: [to.email],
        subject: subject ?? "Hello",
        text: body,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new AppError({
        kind: res.status === 429 ? "rate-limited" : "provider-error",
        message: `Resend rejected the message (HTTP ${res.status}).`,
        remedy: "Check the sending domain is verified and the from address matches it.",
        retryable: res.status >= 500 || res.status === 429,
        detail: detail.slice(0, 300),
      });
    }

    return { status: "sent", detail: `delivered to ${to.email}` };
  }
}

class ManualProvider implements OutreachProvider {
  constructor(
    readonly id: string,
    readonly label: string,
    readonly setupHint: string,
  ) {}

  isConfigured(): boolean {
    return false;
  }

  async send(): Promise<SendResult> {
    return {
      status: "manual",
      detail: `${this.label} messages are copied and sent by hand. Nothing was transmitted.`,
    };
  }
}

const email = new ResendEmailProvider();

const MANUAL: Record<Exclude<OutreachChannel, "email">, OutreachProvider> = {
  whatsapp: new ManualProvider(
    "whatsapp-manual",
    "WhatsApp",
    "Cold WhatsApp messaging has no sanctioned bulk API. Copy the approved message and send it from your own account.",
  ),
  instagram: new ManualProvider(
    "instagram-manual",
    "Instagram DM",
    "Instagram does not permit automated cold DMs. Copy the approved message and send it yourself.",
  ),
  linkedin: new ManualProvider(
    "linkedin-manual",
    "LinkedIn",
    "LinkedIn automation breaches their terms. Copy the approved message and send it from your account.",
  ),
  generic: new ManualProvider(
    "generic-manual",
    "Generic copy",
    "This channel has no transport. Copy the message wherever you need it.",
  ),
};

export function getOutreachProvider(channel: OutreachChannel): OutreachProvider {
  return channel === "email" ? email : MANUAL[channel];
}

export function outreachProviderHealth() {
  return [
    {
      id: email.id,
      label: email.label,
      configured: email.isConfigured(),
      isMock: false,
      setupHint: email.setupHint,
    },
    ...Object.values(MANUAL).map((p) => ({
      id: p.id,
      label: p.label,
      configured: false,
      isMock: false,
      setupHint: p.setupHint,
    })),
  ];
}
