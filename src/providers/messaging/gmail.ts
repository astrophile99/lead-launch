import { appConfig, capabilities } from "@/config/app";
import { prisma } from "@/db/client";
import { canEncrypt, decryptSecret, encryptSecret } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertRate } from "@/lib/rate-limit";
import type {
  Eligibility,
  MessagingHealth,
  MessagingProvider,
  MessagingTarget,
  SendOutcome,
  SendPayload,
} from "./types";

/**
 * Gmail, through the Gmail API and Google OAuth 2.0.
 *
 * ## What this does and does not ask for
 *
 * Scope: `https://www.googleapis.com/auth/gmail.compose` — create, update and
 * send drafts as the user. That is the narrowest scope that supports the whole
 * approve-and-send flow, and it is all we request.
 *
 * We deliberately do NOT request `gmail.readonly`, `gmail.modify` or
 * `mail.google.com`. Reading someone's mailbox is a different order of access,
 * it drags the whole account into Google's restricted-scope review, and this
 * product does not need it to do its job. If inbound reply tracking is added
 * later it will ask for `gmail.readonly` as a separate, explained step — not
 * quietly bundled in now "in case".
 *
 * ## Credentials
 *
 * There is no password field. Google does not permit password auth for Gmail,
 * and an app that asks for one is either phishing or about to be blocked, so
 * the only path here is OAuth. Access and refresh tokens are encrypted at rest
 * (`src/lib/crypto.ts`), decrypted only inside this file, and never returned
 * from an action, a route, a log line or a health check.
 *
 * ## Drafts are real
 *
 * `createDraft` / `updateDraft` / `sendDraft` map onto the actual Gmail draft
 * endpoints, so an approved message exists in the user's own Drafts folder and
 * can be sent, edited or deleted from Gmail itself. Keeping a "draft" that only
 * this app knows about, and then composing a fresh message at send time, would
 * be a lie about where the message lives.
 */

const SCOPES = ["https://www.googleapis.com/auth/gmail.compose"];
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES = SCOPES;

export type GmailConnection = {
  id: string;
  email: string;
  displayName: string | null;
  scopes: string[];
  status: string;
  connectedAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  fromName: string | null;
  replyTo: string | null;
  signature: string | null;
  dailyLimit: number;
  /** Whether a refresh token is stored. Never the token itself. */
  hasRefreshToken: boolean;
  expiresAt: Date | null;
};

/** The only shape of a Gmail account that ever leaves the server. */
export function redactConnection(row: {
  id: string;
  email: string;
  displayName: string | null;
  scopes: string;
  status: string;
  connectedAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  fromName: string | null;
  replyTo: string | null;
  signature: string | null;
  dailyLimit: number;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
}): GmailConnection {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    scopes: row.scopes ? row.scopes.split(/\s+/).filter(Boolean) : [],
    status: row.status,
    connectedAt: row.connectedAt,
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    fromName: row.fromName,
    replyTo: row.replyTo,
    signature: row.signature,
    dailyLimit: row.dailyLimit,
    hasRefreshToken: Boolean(row.refreshTokenEnc),
    expiresAt: row.expiresAt,
  };
}

/* ------------------------------------------------------------------ tokens */

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: appConfig.google.clientId ?? "",
      client_secret: appConfig.google.clientSecret ?? "",
      redirect_uri: appConfig.google.redirectUri ?? "",
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });
  const body = (await res.json()) as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new AppError({
      kind: "provider-error",
      // Google's error_description is about the request we made, not about the
      // user's account, so it is safe and genuinely useful to surface.
      message: `Google refused the authorisation: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}.`,
      remedy:
        "Check that the redirect URI matches the one on the OAuth client exactly, and that the Gmail API is enabled on the project.",
    });
  }
  return body;
}

/** Returns a usable access token, refreshing it if it has expired. */
async function accessTokenFor(workspaceId: string): Promise<{ token: string; email: string }> {
  const account = await prisma.gmailAccount.findUnique({ where: { workspaceId } });
  if (!account || !account.refreshTokenEnc) {
    throw new AppError({
      kind: "not-configured",
      message: "No Gmail account is connected to this workspace.",
      remedy: "Connect one in Settings → Gmail.",
    });
  }

  const stillValid =
    account.accessTokenEnc && account.expiresAt && account.expiresAt.getTime() > Date.now() + 60_000;
  if (stillValid) {
    return { token: decryptSecret(account.accessTokenEnc!), email: account.email };
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: appConfig.google.clientId ?? "",
      client_secret: appConfig.google.clientSecret ?? "",
      refresh_token: decryptSecret(account.refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  const body = (await res.json()) as TokenResponse;

  if (!res.ok || !body.access_token) {
    // A revoked grant is permanent until the user reconnects; say so rather
    // than retrying forever.
    await prisma.gmailAccount.update({
      where: { workspaceId },
      data: {
        status: "expired",
        lastError: body.error_description ?? body.error ?? `HTTP ${res.status}`,
        lastCheckedAt: new Date(),
      },
    });
    throw new AppError({
      kind: "not-configured",
      message: `The Gmail connection for ${account.email} is no longer valid.`,
      remedy: "Reconnect the account in Settings → Gmail. Access may have been revoked in Google.",
    });
  }

  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000);
  await prisma.gmailAccount.update({
    where: { workspaceId },
    data: {
      accessTokenEnc: encryptSecret(body.access_token),
      expiresAt,
      status: "connected",
      lastError: null,
      lastCheckedAt: new Date(),
    },
  });

  return { token: body.access_token, email: account.email };
}

/* ------------------------------------------------------------------- MIME */

/** Folds a header value and strips anything that could inject a new header. */
function headerValue(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").trim().slice(0, 500);
}

function encodeHeader(raw: string): string {
  const value = headerValue(raw);
  // Non-ASCII must be encoded; RFC 2047 base64 is the least surprising option.
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function buildMime(input: {
  from: string;
  fromName: string | null;
  to: string;
  subject: string;
  body: string;
  replyTo: string | null;
  signature: string | null;
}): string {
  const body = input.signature ? `${input.body}\n\n--\n${input.signature}` : input.body;
  const lines = [
    `From: ${input.fromName ? `${encodeHeader(input.fromName)} <${headerValue(input.from)}>` : headerValue(input.from)}`,
    `To: ${headerValue(input.to)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    ...(input.replyTo ? [`Reply-To: ${headerValue(input.replyTo)}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return lines.join("\r\n");
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

async function gmailFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* keep the raw text */
    }
    throw new AppError({
      kind:
        res.status === 429 || res.status === 403
          ? "rate-limited"
          : res.status === 401
            ? "not-configured"
            : "provider-error",
      message: `Gmail rejected the request (HTTP ${res.status}).`,
      remedy:
        res.status === 401
          ? "Reconnect the Gmail account — the authorisation is no longer accepted."
          : res.status === 403
            ? "Check the granted scopes include gmail.compose, and that the daily sending limit has not been reached."
            : "Retry. If it repeats, check the Google Cloud console for the project's Gmail API quota.",
      retryable: res.status >= 500 || res.status === 429,
      detail,
    });
  }
  return text ? JSON.parse(text) : {};
}

/* --------------------------------------------------------------- provider */

export class GmailProvider implements MessagingProvider {
  readonly id = "gmail";
  readonly channel = "email" as const;
  readonly label = "Gmail";
  readonly manualOnly = false;

  async isConfigured(workspaceId: string): Promise<boolean> {
    if (!capabilities.hasGoogleOAuth) return false;
    const account = await prisma.gmailAccount.findUnique({
      where: { workspaceId },
      select: { refreshTokenEnc: true, status: true },
    });
    return Boolean(account?.refreshTokenEnc && account.status === "connected");
  }

  async connection(workspaceId: string): Promise<GmailConnection | null> {
    const row = await prisma.gmailAccount.findUnique({ where: { workspaceId } });
    return row ? redactConnection(row) : null;
  }

  /**
   * Health is a question about the account, not about the environment.
   * Having a client id in .env does not mean anyone has authorised anything,
   * so this reports "not connected" until a real account exists.
   */
  async health(workspaceId: string): Promise<MessagingHealth> {
    const setupHint =
      "Create an OAuth client (Web application) in Google Cloud, enable the Gmail API, add the redirect URI, then set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI — and connect an account in Settings → Gmail.";

    if (!capabilities.canStoreSecrets) {
      return {
        id: this.id,
        channel: this.channel,
        label: this.label,
        configured: false,
        status: "not-configured",
        detail:
          "No TOKEN_ENCRYPTION_KEY is set, so an OAuth refresh token cannot be stored safely. Gmail is disabled rather than storing one in plaintext.",
        manualOnly: false,
        setupHint:
          "Generate a key with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` and set TOKEN_ENCRYPTION_KEY.",
        docsUrl: "https://developers.google.com/gmail/api/auth/scopes",
      };
    }

    if (!capabilities.hasGoogleOAuth) {
      const missing = [
        !appConfig.google.clientId && "GOOGLE_OAUTH_CLIENT_ID",
        !appConfig.google.clientSecret && "GOOGLE_OAUTH_CLIENT_SECRET",
        !appConfig.google.redirectUri && "GOOGLE_OAUTH_REDIRECT_URI",
      ].filter(Boolean);
      return {
        id: this.id,
        channel: this.channel,
        label: this.label,
        configured: false,
        status: "not-configured",
        detail: `Missing: ${missing.join(", ")}.`,
        manualOnly: false,
        setupHint,
        docsUrl: "https://developers.google.com/gmail/api/quickstart/js",
      };
    }

    const account = await prisma.gmailAccount.findUnique({ where: { workspaceId } });
    if (!account || !account.refreshTokenEnc) {
      return {
        id: this.id,
        channel: this.channel,
        label: this.label,
        configured: false,
        status: "not-configured",
        detail: "OAuth is configured, but no Google account has been connected yet.",
        manualOnly: false,
        setupHint: "Click Connect Gmail in Settings → Gmail.",
        docsUrl: "https://developers.google.com/gmail/api/auth/scopes",
      };
    }

    return {
      id: this.id,
      channel: this.channel,
      label: this.label,
      configured: account.status === "connected",
      status: account.status === "connected" ? "connected" : "error",
      detail:
        account.status === "connected"
          ? `Connected as ${account.email}. Scopes: ${account.scopes || "unknown"}.`
          : `${account.email}: ${account.lastError ?? "the authorisation is no longer valid."}`,
      manualOnly: false,
      setupHint:
        account.status === "connected" ? "" : "Reconnect the account in Settings → Gmail.",
      docsUrl: "https://developers.google.com/gmail/api/auth/scopes",
    };
  }

  async eligibility(workspaceId: string, to: MessagingTarget): Promise<Eligibility> {
    if (!(await this.isConfigured(workspaceId))) {
      return { canSend: false, reason: "No Gmail account is connected." };
    }
    if (!to.email) {
      return { canSend: false, reason: "No email address is on record for this business." };
    }
    return { canSend: true, reason: "Ready to send from the connected Gmail account." };
  }

  /** Verifies the stored credentials against the live API. */
  async testConnection(workspaceId: string): Promise<{ ok: boolean; detail: string }> {
    try {
      const { token } = await accessTokenFor(workspaceId);
      const profile = (await gmailFetch(token, "/profile")) as {
        emailAddress?: string;
        messagesTotal?: number;
      };
      await prisma.gmailAccount.update({
        where: { workspaceId },
        data: { status: "connected", lastError: null, lastCheckedAt: new Date() },
      });
      return {
        ok: true,
        detail: `Authenticated as ${profile.emailAddress ?? "the connected account"}.`,
      };
    } catch (e) {
      const message = e instanceof AppError ? e.message : "Could not reach Gmail.";
      await prisma.gmailAccount
        .update({
          where: { workspaceId },
          data: { status: "error", lastError: message, lastCheckedAt: new Date() },
        })
        .catch(() => undefined);
      return { ok: false, detail: message };
    }
  }

  /* ------------------------------------------------------------- drafts */

  /** Creates a real draft in the user's Gmail. Returns the Gmail draft id. */
  async createDraft(
    workspaceId: string,
    payload: SendPayload,
  ): Promise<{ draftId: string; messageId: string | null; threadId: string | null }> {
    const { token, email } = await accessTokenFor(workspaceId);
    const account = await prisma.gmailAccount.findUnique({ where: { workspaceId } });
    if (!payload.to.email) {
      throw new AppError({
        kind: "invalid-input",
        message: `No email address on record for ${payload.to.name}.`,
        remedy: "Add one to the business record, or use a different channel.",
      });
    }

    const mime = buildMime({
      from: email,
      fromName: account?.fromName ?? null,
      to: payload.to.email,
      subject: payload.subject ?? "",
      body: payload.body,
      replyTo: account?.replyTo ?? null,
      signature: account?.signature ?? null,
    });

    const result = (await gmailFetch(token, "/drafts", {
      method: "POST",
      body: JSON.stringify({
        message: {
          raw: base64url(mime),
          ...(payload.to.externalId ? { threadId: payload.to.externalId } : {}),
        },
      }),
    })) as { id?: string; message?: { id?: string; threadId?: string } };

    if (!result.id) {
      throw new AppError({
        kind: "provider-error",
        message: "Gmail accepted the draft but returned no id.",
        remedy: "Retry. If it repeats, check the Gmail API status page.",
        retryable: true,
      });
    }

    return {
      draftId: result.id,
      messageId: result.message?.id ?? null,
      threadId: result.message?.threadId ?? null,
    };
  }

  async updateDraft(
    workspaceId: string,
    draftId: string,
    payload: SendPayload,
  ): Promise<{ draftId: string; threadId: string | null }> {
    const { token, email } = await accessTokenFor(workspaceId);
    const account = await prisma.gmailAccount.findUnique({ where: { workspaceId } });
    if (!payload.to.email) {
      throw new AppError({
        kind: "invalid-input",
        message: "The draft has no recipient.",
        remedy: "Add an email address to the business record.",
      });
    }

    const mime = buildMime({
      from: email,
      fromName: account?.fromName ?? null,
      to: payload.to.email,
      subject: payload.subject ?? "",
      body: payload.body,
      replyTo: account?.replyTo ?? null,
      signature: account?.signature ?? null,
    });

    const result = (await gmailFetch(token, `/drafts/${encodeURIComponent(draftId)}`, {
      method: "PUT",
      body: JSON.stringify({ message: { raw: base64url(mime) } }),
    })) as { id?: string; message?: { threadId?: string } };

    return { draftId: result.id ?? draftId, threadId: result.message?.threadId ?? null };
  }

  async deleteDraft(workspaceId: string, draftId: string): Promise<void> {
    const { token } = await accessTokenFor(workspaceId);
    await gmailFetch(token, `/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
  }

  /**
   * Sends an existing draft.
   *
   * The caller must have created the draft and had it approved. There is no
   * "compose and send in one call" path in this provider, because that is the
   * shape that lets an unapproved message go out.
   */
  async sendDraft(
    workspaceId: string,
    draftId: string,
  ): Promise<{ externalId: string; threadId: string | null }> {
    const { token } = await accessTokenFor(workspaceId);
    assertRate(`gmail-send:${workspaceId}`, 60, 3_600_000, "Gmail send");

    const result = (await gmailFetch(token, "/drafts/send", {
      method: "POST",
      body: JSON.stringify({ id: draftId }),
    })) as { id?: string; threadId?: string };

    if (!result.id) {
      // No id means we cannot prove it went. Refuse to call it sent.
      throw new AppError({
        kind: "provider-error",
        message: "Gmail did not confirm the send.",
        remedy:
          "Check the Sent folder in Gmail before retrying — the message may have gone without a confirmation reaching us.",
        retryable: false,
      });
    }
    return { externalId: result.id, threadId: result.threadId ?? null };
  }

  /**
   * The MessagingProvider send path.
   *
   * Creates the draft and sends it in one call, for callers that already have
   * human approval recorded. The outreach service uses the draft/approve/send
   * split instead; this exists so the interface is honestly implemented.
   */
  async send(workspaceId: string, payload: SendPayload): Promise<SendOutcome> {
    if (!(await this.isConfigured(workspaceId))) {
      return {
        status: "manual",
        detail: "No Gmail account is connected, so nothing was sent.",
      };
    }
    const draft = await this.createDraft(workspaceId, payload);
    const sent = await this.sendDraft(workspaceId, draft.draftId);
    return {
      status: "sent",
      externalId: sent.externalId,
      detail: `Sent from Gmail to ${payload.to.email}.`,
    };
  }
}

export const gmailProvider = new GmailProvider();

/** Persists a fresh authorisation. Called only from the OAuth callback. */
export async function storeGrant(
  workspaceId: string,
  grant: { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string },
  profile: { email: string; name: string | null },
): Promise<void> {
  if (!canEncrypt()) {
    throw new AppError({
      kind: "not-configured",
      message: "Refusing to store a Google refresh token without TOKEN_ENCRYPTION_KEY.",
      remedy:
        "Set TOKEN_ENCRYPTION_KEY on the server and connect again. The token is not stored in plaintext under any circumstances.",
    });
  }

  const existing = await prisma.gmailAccount.findUnique({ where: { workspaceId } });
  const expiresAt = new Date(Date.now() + grant.expiresIn * 1000);

  // Google only returns a refresh token on the first consent (or with
  // prompt=consent). Keep the one we have rather than wiping it.
  const refreshTokenEnc = grant.refreshToken
    ? encryptSecret(grant.refreshToken)
    : (existing?.refreshTokenEnc ?? null);

  await prisma.gmailAccount.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      email: profile.email,
      displayName: profile.name,
      scopes: grant.scope,
      accessTokenEnc: encryptSecret(grant.accessToken),
      refreshTokenEnc,
      expiresAt,
      status: refreshTokenEnc ? "connected" : "error",
      lastError: refreshTokenEnc
        ? null
        : "Google returned no refresh token. Revoke the app's access in your Google account and connect again.",
      connectedAt: new Date(),
      lastCheckedAt: new Date(),
    },
    update: {
      email: profile.email,
      displayName: profile.name,
      scopes: grant.scope,
      accessTokenEnc: encryptSecret(grant.accessToken),
      refreshTokenEnc,
      expiresAt,
      status: refreshTokenEnc ? "connected" : "error",
      lastError: null,
      connectedAt: new Date(),
      lastCheckedAt: new Date(),
    },
  });
}

export async function disconnectGmail(workspaceId: string): Promise<void> {
  const account = await prisma.gmailAccount.findUnique({ where: { workspaceId } });
  if (!account) return;

  // Best effort: tell Google too, so the grant does not linger in the user's
  // account after they disconnected it here.
  if (account.refreshTokenEnc) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decryptSecret(account.refreshTokenEnc) }),
      });
    } catch {
      /* the local record is removed regardless */
    }
  }

  await prisma.gmailAccount.delete({ where: { workspaceId } });
}

/** Reads the connected account's profile, for the callback. */
export async function fetchGoogleProfile(
  accessToken: string,
): Promise<{ email: string; name: string | null }> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // gmail.compose alone does not grant userinfo, so fall back to the Gmail
    // profile endpoint, which it does cover.
    const gmail = (await gmailFetch(accessToken, "/profile")) as { emailAddress?: string };
    if (!gmail.emailAddress) {
      throw new AppError({
        kind: "provider-error",
        message: "Could not read the connected account's address.",
        remedy: "Try connecting again.",
      });
    }
    return { email: gmail.emailAddress, name: null };
  }
  const body = (await res.json()) as { email?: string; name?: string };
  return { email: body.email ?? "unknown", name: body.name ?? null };
}
