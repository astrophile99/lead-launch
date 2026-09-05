import type { OutreachChannel } from "@/types";

/**
 * Messaging transports.
 *
 * Every adapter here talks to an official, sanctioned API. There is no
 * scraping, no browser automation against a consumer app, and no path that
 * sends without an explicit human approval upstream.
 *
 * A provider that cannot send returns `status: "manual"` with the reason. It
 * never throws to look like a delivery failure, and never returns "sent" for a
 * message that did not leave the building.
 */

export type MessagingTarget = {
  name: string;
  email: string | null;
  phone: string | null;
  handle: string | null;
  /** Provider-side conversation or recipient id, when one is known. */
  externalId: string | null;
};

export type SendPayload = {
  to: MessagingTarget;
  subject: string | null;
  body: string;
  /** Set when the channel requires a pre-approved template for this message. */
  template?: { name: string; language: string; variables: string[] } | null;
};

export type SendOutcome =
  | {
      status: "sent";
      /** Provider message id, stored so delivery webhooks can be matched later. */
      externalId: string | null;
      detail: string;
    }
  | {
      status: "manual";
      /** Why nothing was transmitted, in words the user can act on. */
      detail: string;
    };

/** Whether this transport can currently send to a specific target, and why not. */
export type Eligibility = {
  canSend: boolean;
  reason: string;
  /** True when the block is a policy window rather than a configuration gap. */
  requiresTemplate?: boolean;
};

export type MessagingHealth = {
  id: string;
  channel: OutreachChannel;
  label: string;
  configured: boolean;
  status: "connected" | "not-configured" | "error" | "manual";
  detail: string;
  setupHint: string;
  /** True when the channel has no sanctioned automated transport at all. */
  manualOnly: boolean;
  /** Documentation the user needs to complete setup. */
  docsUrl?: string;
};

export interface MessagingProvider {
  readonly id: string;
  readonly channel: OutreachChannel;
  readonly label: string;
  /** True when this channel has no sanctioned automated transport at all. */
  readonly manualOnly: boolean;

  isConfigured(workspaceId: string): Promise<boolean>;
  health(workspaceId: string): Promise<MessagingHealth>;
  /** Cheap local check; does not call the provider. */
  eligibility(workspaceId: string, to: MessagingTarget): Promise<Eligibility>;
  /** Verifies credentials against the live API. */
  testConnection(workspaceId: string): Promise<{ ok: boolean; detail: string }>;
  send(workspaceId: string, payload: SendPayload): Promise<SendOutcome>;
}
