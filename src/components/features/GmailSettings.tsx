"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  disconnectGmailAction,
  testGmailAction,
  updateGmailSettingsAction,
} from "@/app/actions";
import {
  Badge,
  Button,
  DetailList,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Panel,
  PanelHeader,
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/utils";

/**
 * Gmail integration settings.
 *
 * Three things this screen is careful about:
 *
 *   1. **It never shows a token.** The server hands this component a redacted
 *      view: the address, the granted scopes, whether a refresh token exists.
 *      Not the token. There is no field to paste one into either, because
 *      there is no supported way to obtain one by hand.
 *   2. **It never shows Connected because the environment is configured.**
 *      Green here means an account is authorised and the last check against
 *      the live API succeeded.
 *   3. **It says what permission is being asked for, and what is not.** A user
 *      about to grant access to their mail deserves to read the scope in
 *      English before they click.
 */

export type GmailView = {
  connection: {
    email: string;
    displayName: string | null;
    scopes: string[];
    status: string;
    connectedAt: string | null;
    lastCheckedAt: string | null;
    lastError: string | null;
    fromName: string | null;
    replyTo: string | null;
    signature: string | null;
    dailyLimit: number;
    hasRefreshToken: boolean;
  } | null;
  health: {
    configured: boolean;
    status: string;
    detail: string;
    setupHint: string;
    docsUrl?: string;
  };
  scopes: string[];
};

const SCOPE_ENGLISH: Record<string, { does: string; doesNot: string }> = {
  "https://www.googleapis.com/auth/gmail.compose": {
    does: "Create, update and send drafts as you.",
    doesNot:
      "It does not grant access to read your inbox, your existing mail, your contacts or your labels.",
  },
};

export function GmailSettings({ view }: { view: GmailView }) {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const conn = view.connection;
  const oauth = params.get("oauth");

  const [fromName, setFromName] = useState(conn?.fromName ?? "");
  const [replyTo, setReplyTo] = useState(conn?.replyTo ?? "");
  const [signature, setSignature] = useState(conn?.signature ?? "");
  const [dailyLimit, setDailyLimit] = useState(String(conn?.dailyLimit ?? 50));

  return (
    <div className="flex flex-col gap-5">
      {oauth === "connected" ? (
        <InfoNote tone="ok">Google account connected.</InfoNote>
      ) : oauth === "denied" ? (
        <InfoNote tone="warn">
          The authorisation was declined, so nothing was connected.{" "}
          {params.get("reason") ? `Google said: ${params.get("reason")}.` : ""}
        </InfoNote>
      ) : oauth === "failed" ? (
        <InfoNote tone="danger">
          The authorisation did not complete. Start it again from this page.
        </InfoNote>
      ) : null}

      <Panel>
        <PanelHeader
          title="Gmail"
          hint="Send outreach from your own address, from inside Lead → Launch. Drafts are real Gmail drafts, so an approved message sits in your own Drafts folder."
          actions={
            <Badge
              tone={
                conn?.status === "connected"
                  ? "ok"
                  : conn?.status === "expired" || conn?.status === "error"
                    ? "danger"
                    : "neutral"
              }
              dot
            >
              {conn?.status === "connected"
                ? "Connected"
                : conn
                  ? conn.status
                  : "Not connected"}
            </Badge>
          }
        />

        <div className="px-4 py-3.5 flex flex-col gap-3.5">
          {conn ? (
            <>
              <DetailList
                items={[
                  ["Account", conn.email],
                  ["Name", conn.displayName ?? "—"],
                  [
                    "Connected",
                    conn.connectedAt ? formatDateTime(conn.connectedAt) : "—",
                  ],
                  [
                    "Last checked",
                    conn.lastCheckedAt ? formatDateTime(conn.lastCheckedAt) : "never",
                  ],
                  [
                    "Refresh token",
                    conn.hasRefreshToken ? (
                      <span key="rt" className="text-ok">
                        stored, encrypted at rest
                      </span>
                    ) : (
                      <span key="rt" className="text-danger">
                        missing — reconnect to obtain one
                      </span>
                    ),
                  ],
                ]}
              />

              {conn.lastError ? <InfoNote tone="danger">{conn.lastError}</InfoNote> : null}

              <div>
                <p className="label mb-1.5">Granted permissions</p>
                <ul className="flex flex-col gap-1.5">
                  {conn.scopes.map((s) => (
                    <li key={s} className="text-[12px]">
                      <code className="text-ink-2">{s.replace(/^https:\/\/www\.googleapis\.com\/auth\//, "")}</code>
                      {SCOPE_ENGLISH[s] ? (
                        <>
                          <span className="text-ink-3"> — {SCOPE_ENGLISH[s].does}</span>
                          <span className="block text-ink-4 text-[11.5px]">
                            {SCOPE_ENGLISH[s].doesNot}
                          </span>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const res = await testGmailAction();
                      if (!res.ok) {
                        setError({ message: res.error.message, remedy: res.error.remedy });
                        return;
                      }
                      if (res.data.ok) toast.success("Gmail is reachable", res.data.detail);
                      else toast.error("Gmail check failed", res.data.detail);
                      router.refresh();
                    })
                  }
                >
                  Check connection
                </Button>

                <a
                  href="/api/oauth/google/start?returnTo=/settings%3Ftab%3Dgmail"
                  className="inline-flex items-center h-7 px-2.5 rounded-sm border border-line-strong bg-surface-2 text-[12px] text-ink hover:bg-surface-3 transition-colors"
                >
                  Reconnect
                </a>

                {!confirmDisconnect ? (
                  <Button size="sm" onClick={() => setConfirmDisconnect(true)}>
                    Disconnect
                  </Button>
                ) : (
                  <span className="flex items-center gap-2">
                    <Button
                      size="sm"
                      loading={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await disconnectGmailAction();
                          if (!res.ok) {
                            setError({ message: res.error.message, remedy: res.error.remedy });
                            return;
                          }
                          toast.success(
                            "Gmail disconnected",
                            "The stored token was deleted and the grant revoked with Google.",
                          );
                          setConfirmDisconnect(false);
                          router.refresh();
                        })
                      }
                    >
                      Confirm disconnect
                    </Button>
                    <Button size="sm" onClick={() => setConfirmDisconnect(false)}>
                      Cancel
                    </Button>
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              <InfoNote tone={view.health.configured ? "info" : "warn"}>
                {view.health.detail} {view.health.setupHint}
              </InfoNote>

              <div>
                <p className="label mb-1.5">What connecting will ask for</p>
                <ul className="flex flex-col gap-1.5">
                  {view.scopes.map((s) => (
                    <li key={s} className="text-[12px]">
                      <code className="text-ink-2">
                        {s.replace(/^https:\/\/www\.googleapis\.com\/auth\//, "")}
                      </code>
                      {SCOPE_ENGLISH[s] ? (
                        <>
                          <span className="text-ink-3"> — {SCOPE_ENGLISH[s].does}</span>
                          <span className="block text-ink-4 text-[11.5px]">
                            {SCOPE_ENGLISH[s].doesNot}
                          </span>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <InfoNote>
                Lead → Launch will never ask for your Gmail password. Google does not permit
                password access to Gmail, and an application that asks for one is either phishing or
                about to be blocked. Access is granted through Google&apos;s own consent screen and
                can be revoked from your Google account at any time.
              </InfoNote>

              <div>
                <a
                  href="/api/oauth/google/start?returnTo=/settings%3Ftab%3Dgmail"
                  className={
                    view.health.status === "not-configured" && !view.health.configured
                      ? "inline-flex items-center h-8 px-3 rounded-sm border border-line bg-surface-2 text-[12.5px] text-ink-4 pointer-events-none"
                      : "inline-flex items-center h-8 px-3 rounded-sm bg-accent text-accent-ink text-[12.5px] font-medium hover:bg-accent-hover transition-colors"
                  }
                  aria-disabled={!view.health.configured}
                >
                  Connect Gmail
                </a>
              </div>
            </>
          )}

          {error ? (
            <ErrorState title="Gmail" message={error.message} remedy={error.remedy} />
          ) : null}
        </div>
      </Panel>

      {conn ? (
        <Panel>
          <PanelHeader
            title="Sending"
            hint="Applied to every message sent from this account."
            actions={
              <Button
                variant="primary"
                size="sm"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const res = await updateGmailSettingsAction({
                      fromName: fromName || null,
                      replyTo: replyTo || null,
                      signature: signature || null,
                      dailyLimit,
                    });
                    if (!res.ok) {
                      setError({ message: res.error.message, remedy: res.error.remedy });
                      return;
                    }
                    toast.success("Saved");
                    router.refresh();
                  })
                }
              >
                Save
              </Button>
            }
          />
          <div className="px-4 py-3.5 grid gap-3.5 sm:grid-cols-2">
            <Field label="Sender name" htmlFor="gmail-from" hint="Shown beside your address.">
              <Input
                id="gmail-from"
                value={fromName}
                maxLength={80}
                placeholder={conn.displayName ?? "Your name"}
                onChange={(e) => setFromName(e.target.value)}
              />
            </Field>
            <Field
              label="Reply-to address"
              htmlFor="gmail-reply"
              hint="Leave blank to reply to the connected account."
            >
              <Input
                id="gmail-reply"
                type="email"
                value={replyTo}
                maxLength={160}
                onChange={(e) => setReplyTo(e.target.value)}
              />
            </Field>
            <Field
              label="Daily send limit"
              htmlFor="gmail-limit"
              hint="A warning threshold in this app. Google enforces its own limit regardless."
            >
              <Input
                id="gmail-limit"
                type="number"
                min={1}
                max={2000}
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
              />
            </Field>
            <Field
              label="Signature"
              htmlFor="gmail-signature"
              hint="Appended after a plain-text separator. Kept short on purpose."
              className="sm:col-span-2"
            >
              <Textarea
                id="gmail-signature"
                rows={3}
                value={signature}
                maxLength={600}
                onChange={(e) => setSignature(e.target.value)}
              />
            </Field>
          </div>
          <div className="px-4 pb-3.5">
            <InfoNote>
              <strong className="font-semibold">Approval is always required.</strong> There is no
              auto-send mode in this application, hidden or otherwise. A draft is written, you read
              it, you approve it, and then you press send — three separate actions, in that order.
            </InfoNote>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
