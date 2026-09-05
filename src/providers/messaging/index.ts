import { appConfig } from "@/config/app";
import { AppError } from "@/lib/errors";
import type { OutreachChannel } from "@/types";
import { InstagramGraphProvider } from "./instagram";
import { WhatsAppCloudProvider } from "./whatsapp";
import type {
  Eligibility,
  MessagingHealth,
  MessagingProvider,
  MessagingTarget,
  SendOutcome,
  SendPayload,
} from "./types";

/** Resend — the only channel here with a straightforward, sanctioned transport. */
class ResendEmailProvider implements MessagingProvider {
  readonly id = "resend";
  readonly channel = "email" as const;
  readonly label = "Resend (email)";
  readonly manualOnly = false;

  async isConfigured(): Promise<boolean> {
    return Boolean(appConfig.email.resendKey && appConfig.email.fromAddress);
  }

  async health(): Promise<MessagingHealth> {
    const configured = await this.isConfigured();
    const missing: string[] = [];
    if (!appConfig.email.resendKey) missing.push("RESEND_API_KEY");
    if (!appConfig.email.fromAddress) missing.push("OUTREACH_FROM_EMAIL");

    return {
      id: this.id,
      channel: this.channel,
      label: this.label,
      configured,
      status: configured ? "connected" : "not-configured",
      detail: configured
        ? `Sending from ${appConfig.email.fromAddress}.`
        : `Missing: ${missing.join(", ")}.`,
      manualOnly: false,
      setupHint:
        "Create an API key at resend.com, verify the sending domain, then set RESEND_API_KEY and OUTREACH_FROM_EMAIL on the server.",
      docsUrl: "https://resend.com/docs/introduction",
    };
  }

  async eligibility(_workspaceId: string, to: MessagingTarget): Promise<Eligibility> {
    if (!(await this.isConfigured())) return { canSend: false, reason: "Email is not connected." };
    if (!to.email) {
      return { canSend: false, reason: "No email address is on record for this business." };
    }
    return { canSend: true, reason: "Ready to send." };
  }

  async testConnection(): Promise<{ ok: boolean; detail: string }> {
    if (!(await this.isConfigured())) {
      return { ok: false, detail: "RESEND_API_KEY or OUTREACH_FROM_EMAIL is missing." };
    }
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${appConfig.email.resendKey}` },
      });
      if (!res.ok) {
        return { ok: false, detail: `Resend returned HTTP ${res.status}. Check the API key.` };
      }
      const data = (await res.json()) as { data?: { name: string; status: string }[] };
      const domains = data.data ?? [];
      const from = appConfig.email.fromAddress?.split("@")[1];
      const match = domains.find((d) => d.name === from);
      if (from && !match) {
        return {
          ok: false,
          detail: `The key is valid but "${from}" is not a verified domain on this Resend account.`,
        };
      }
      return {
        ok: true,
        detail: match
          ? `Key valid; ${match.name} is ${match.status}.`
          : `Key valid; ${domains.length} domain(s) on the account.`,
      };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : "Could not reach Resend." };
    }
  }

  async send(_workspaceId: string, payload: SendPayload): Promise<SendOutcome> {
    if (!(await this.isConfigured())) {
      return {
        status: "manual",
        detail: "No email transport is configured, so nothing was sent.",
      };
    }
    if (!payload.to.email) {
      throw new AppError({
        kind: "invalid-input",
        message: `No email address on record for ${payload.to.name}.`,
        remedy: "Add an email to the business record, or use a different channel.",
      });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${appConfig.email.resendKey}`,
      },
      body: JSON.stringify({
        from: appConfig.email.fromAddress,
        to: [payload.to.email],
        subject: payload.subject ?? "Hello",
        text: payload.body,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new AppError({
        kind: res.status === 429 ? "rate-limited" : "provider-error",
        message: `Resend rejected the message (HTTP ${res.status}).`,
        remedy: "Check that the sending domain is verified and the from address matches it.",
        retryable: res.status >= 500 || res.status === 429,
        detail: detail.slice(0, 300),
      });
    }

    const data = (await res.json()) as { id?: string };
    return { status: "sent", externalId: data.id ?? null, detail: `Delivered to ${payload.to.email}.` };
  }
}

/**
 * Channels with no sanctioned automated transport for cold contact. The app
 * writes the message; the human sends it. Automating these would breach the
 * platform's terms, so there is deliberately no code path that tries.
 */
class ManualProvider implements MessagingProvider {
  readonly manualOnly = true;

  constructor(
    readonly id: string,
    readonly channel: OutreachChannel,
    readonly label: string,
    private readonly why: string,
  ) {}

  async isConfigured(): Promise<boolean> {
    return false;
  }

  async health(): Promise<MessagingHealth> {
    return {
      id: this.id,
      channel: this.channel,
      label: this.label,
      configured: false,
      status: "manual",
      detail: "Copy and send by hand.",
      manualOnly: true,
      setupHint: this.why,
    };
  }

  async eligibility(): Promise<Eligibility> {
    return { canSend: false, reason: this.why };
  }

  async testConnection(): Promise<{ ok: boolean; detail: string }> {
    return { ok: false, detail: "This channel has no transport to test." };
  }

  async send(): Promise<SendOutcome> {
    return { status: "manual", detail: this.why };
  }
}

const email = new ResendEmailProvider();
const whatsapp = new WhatsAppCloudProvider();
const instagram = new InstagramGraphProvider();

const linkedin = new ManualProvider(
  "linkedin-manual",
  "linkedin",
  "LinkedIn",
  "LinkedIn's terms prohibit automated messaging. Copy the approved message and send it from your own account.",
);

const generic = new ManualProvider(
  "generic-manual",
  "generic",
  "Generic copy",
  "This channel has no transport. Copy the message wherever you need it.",
);

const BY_CHANNEL: Record<OutreachChannel, MessagingProvider> = {
  email,
  whatsapp,
  instagram,
  linkedin,
  generic,
};

export function getMessagingProvider(channel: OutreachChannel): MessagingProvider {
  return BY_CHANNEL[channel] ?? generic;
}

export function listMessagingProviders(): MessagingProvider[] {
  return [email, whatsapp, instagram, linkedin, generic];
}

export async function messagingHealth(workspaceId: string): Promise<MessagingHealth[]> {
  return Promise.all(listMessagingProviders().map((p) => p.health(workspaceId)));
}

export type {
  Eligibility,
  MessagingHealth,
  MessagingProvider,
  MessagingTarget,
  SendOutcome,
  SendPayload,
};
