"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  saveInstagramAction,
  saveWhatsAppAction,
  testIntegrationAction,
} from "@/app/actions";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Button,
  ErrorState,
  Field,
  InfoNote,
  Input,
  Panel,
  PanelHeader,
} from "@/components/ui/primitives";

type Err = { message: string; remedy: string } | null;

export type WhatsAppConfig = {
  metaAppId: string;
  businessAccountId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  apiVersion: string;
  webhookVerifyToken: string;
  status: string;
  lastError: string | null;
  tokenConfigured: boolean;
  webhookUrl: string;
};

/**
 * WhatsApp Business configuration.
 *
 * Only non-secret identifiers are edited here. The access token and the app
 * secret are read from the server environment and are never rendered, posted or
 * stored in the database — the form reports whether they are present, nothing
 * more.
 */
export function WhatsAppForm({ config }: { config: WhatsAppConfig }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState<Err>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const set = <K extends keyof WhatsAppConfig>(k: K, v: WhatsAppConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <Panel>
        <PanelHeader
          title="WhatsApp Business (Meta Cloud API)"
          hint="These identifiers are configuration, not secrets, so they live in the database."
          actions={
            <Badge
              tone={
                config.status === "connected"
                  ? "ok"
                  : config.status === "error"
                    ? "danger"
                    : "neutral"
              }
            >
              {config.status}
            </Badge>
          }
        />

        <div className="px-4 py-3 grid gap-3 sm:grid-cols-2">
          <Field label="Meta App ID" htmlFor="wa-app" hint="From the Meta app dashboard.">
            <Input
              id="wa-app"
              value={draft.metaAppId}
              onChange={(e) => set("metaAppId", e.target.value)}
              placeholder="1234567890123456"
            />
          </Field>

          <Field
            label="WhatsApp Business Account ID"
            htmlFor="wa-waba"
            hint="The WABA the number belongs to."
          >
            <Input
              id="wa-waba"
              value={draft.businessAccountId}
              onChange={(e) => set("businessAccountId", e.target.value)}
            />
          </Field>

          <Field
            label="Phone Number ID"
            htmlFor="wa-phone-id"
            hint="Not the phone number — the numeric ID Meta assigns it."
          >
            <Input
              id="wa-phone-id"
              value={draft.phoneNumberId}
              onChange={(e) => set("phoneNumberId", e.target.value)}
            />
          </Field>

          <Field label="Display number" htmlFor="wa-phone" hint="Shown in the UI only.">
            <Input
              id="wa-phone"
              value={draft.displayPhoneNumber}
              onChange={(e) => set("displayPhoneNumber", e.target.value)}
              placeholder="+91 98765 43210"
            />
          </Field>

          <Field label="Graph API version" htmlFor="wa-version">
            <Input
              id="wa-version"
              value={draft.apiVersion}
              onChange={(e) => set("apiVersion", e.target.value)}
              placeholder="v21.0"
            />
          </Field>

          <Field
            label="Webhook verify token"
            htmlFor="wa-verify"
            hint="Any random string. Meta echoes it back when registering the webhook."
          >
            <Input
              id="wa-verify"
              value={draft.webhookVerifyToken}
              onChange={(e) => set("webhookVerifyToken", e.target.value)}
            />
          </Field>
        </div>

        {error ? (
          <div className="px-4 pb-3">
            <ErrorState title="Could not save" message={error.message} remedy={error.remedy} />
          </div>
        ) : null}

        {testResult ? (
          <div className="px-4 pb-3">
            <InfoNote tone={testResult.ok ? "ok" : "danger"}>{testResult.detail}</InfoNote>
          </div>
        ) : null}

        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setTestResult(null);
                const res = await saveWhatsAppAction(draft);
                if (!res.ok) {
                  setError({ message: res.error.message, remedy: res.error.remedy });
                  return;
                }
                toast.success("WhatsApp configuration saved", "Run a test to verify it works.");
                router.refresh();
              })
            }
          >
            Save configuration
          </Button>

          <Button
            disabled={pending || !config.tokenConfigured}
            title={
              config.tokenConfigured
                ? "Calls Meta to verify the number and token."
                : "WHATSAPP_ACCESS_TOKEN is not set on the server."
            }
            onClick={() =>
              start(async () => {
                setTestResult(null);
                const res = await testIntegrationAction("whatsapp-cloud");
                if (!res.ok) {
                  setTestResult({ ok: false, detail: res.error.message });
                  return;
                }
                setTestResult(res.data);
                if (res.data.ok) toast.success("WhatsApp connected", res.data.detail);
                else toast.error("WhatsApp test failed", res.data.detail);
                router.refresh();
              })
            }
          >
            Test connection
          </Button>
        </div>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Server-side secrets" hint="Set in .env; never rendered here." />
          <ul className="px-4 py-3 flex flex-col gap-2">
            <SecretRow
              name="WHATSAPP_ACCESS_TOKEN"
              present={config.tokenConfigured}
              detail="System-user token with whatsapp_business_messaging."
            />
            <SecretRow
              name="META_APP_SECRET"
              present={false}
              detail="Used to verify X-Hub-Signature-256 on inbound webhooks. Without it, webhook payloads cannot be trusted and are rejected."
              unknown
            />
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Webhook" hint="Register this URL in the Meta app dashboard." />
          <div className="px-4 py-3">
            <code className="block text-[11.5px] font-mono text-ink-2 bg-surface-2 border border-line rounded-sm px-2 py-1.5 break-all">
              {config.webhookUrl}
            </code>
            <p className="mt-2 text-[11.5px] text-ink-3 leading-relaxed">
              Subscribe to the <code>messages</code> field. Meta will call it with{" "}
              <code>hub.verify_token</code> set to the value above; the route only accepts the call
              if they match, and rejects any payload whose signature does not verify.
            </p>
          </div>
        </Panel>

        <InfoNote tone="warn">
          <strong className="font-semibold">Before you can message anyone.</strong> Meta does not
          permit free-form messages to a person who has not messaged you first. Cold outreach
          requires a template that Meta has approved, and the composer will tell you when a template
          is required rather than letting you queue a message that would be rejected.
        </InfoNote>
      </div>
    </div>
  );
}

export type InstagramConfig = {
  metaAppId: string;
  igBusinessId: string;
  pageId: string;
  username: string;
  status: string;
  lastError: string | null;
  tokenConfigured: boolean;
  permissions: string[];
  webhookUrl: string;
};

export function InstagramForm({ config }: { config: InstagramConfig }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState<Err>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const set = <K extends keyof InstagramConfig>(k: K, v: InstagramConfig[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
      <Panel>
        <PanelHeader
          title="Instagram messaging (Meta Graph API)"
          hint="Requires an Instagram Business account linked to a Facebook Page."
          actions={
            <Badge
              tone={
                config.status === "connected"
                  ? "ok"
                  : config.status === "error"
                    ? "danger"
                    : "neutral"
              }
            >
              {config.status}
            </Badge>
          }
        />

        <div className="px-4 py-3 grid gap-3 sm:grid-cols-2">
          <Field label="Meta App ID" htmlFor="ig-app">
            <Input
              id="ig-app"
              value={draft.metaAppId}
              onChange={(e) => set("metaAppId", e.target.value)}
            />
          </Field>

          <Field
            label="Instagram Business ID"
            htmlFor="ig-business"
            hint="The IG account's numeric ID, not the handle."
          >
            <Input
              id="ig-business"
              value={draft.igBusinessId}
              onChange={(e) => set("igBusinessId", e.target.value)}
            />
          </Field>

          <Field label="Linked Page ID" htmlFor="ig-page" hint="The Facebook Page it is linked to.">
            <Input id="ig-page" value={draft.pageId} onChange={(e) => set("pageId", e.target.value)} />
          </Field>

          <Field label="Handle" htmlFor="ig-username" hint="Display only.">
            <Input
              id="ig-username"
              value={draft.username}
              onChange={(e) => set("username", e.target.value)}
              placeholder="@yourstudio"
            />
          </Field>
        </div>

        {error ? (
          <div className="px-4 pb-3">
            <ErrorState title="Could not save" message={error.message} remedy={error.remedy} />
          </div>
        ) : null}

        {testResult ? (
          <div className="px-4 pb-3">
            <InfoNote tone={testResult.ok ? "ok" : "danger"}>{testResult.detail}</InfoNote>
          </div>
        ) : null}

        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            loading={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                setTestResult(null);
                const res = await saveInstagramAction(draft);
                if (!res.ok) {
                  setError({ message: res.error.message, remedy: res.error.remedy });
                  return;
                }
                toast.success("Instagram configuration saved");
                router.refresh();
              })
            }
          >
            Save configuration
          </Button>

          <Button
            disabled={pending || !config.tokenConfigured}
            title={
              config.tokenConfigured
                ? "Calls Meta to verify the account and token."
                : "INSTAGRAM_ACCESS_TOKEN is not set on the server."
            }
            onClick={() =>
              start(async () => {
                setTestResult(null);
                const res = await testIntegrationAction("instagram-graph");
                if (!res.ok) {
                  setTestResult({ ok: false, detail: res.error.message });
                  return;
                }
                setTestResult(res.data);
                if (res.data.ok) toast.success("Instagram connected", res.data.detail);
                else toast.error("Instagram test failed", res.data.detail);
                router.refresh();
              })
            }
          >
            Test connection
          </Button>
        </div>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Server-side secrets" />
          <ul className="px-4 py-3 flex flex-col gap-2">
            <SecretRow
              name="INSTAGRAM_ACCESS_TOKEN"
              present={config.tokenConfigured}
              detail="Page token with instagram_manage_messages."
            />
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title="Granted permissions" />
          <div className="px-4 py-3">
            {config.permissions.length ? (
              <div className="flex flex-wrap gap-1.5">
                {config.permissions.map((p) => (
                  <Badge key={p} tone="ok">
                    {p}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">
                None recorded. Permissions are read from Meta when the connection is tested.
              </p>
            )}
          </div>
        </Panel>

        <InfoNote tone="warn">
          <strong className="font-semibold">Instagram cannot be used for cold outreach.</strong> The
          Messaging API only permits replies inside a conversation the other person started, and
          only within Meta&apos;s messaging window. This app does not work around that. The
          Instagram composer still writes the message — you send it from your own account.
        </InfoNote>
      </div>
    </div>
  );
}

function SecretRow({
  name,
  present,
  detail,
  unknown = false,
}: {
  name: string;
  present: boolean;
  detail: string;
  unknown?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <Badge tone={unknown ? "neutral" : present ? "ok" : "warn"}>
        {unknown ? "server" : present ? "set" : "missing"}
      </Badge>
      <div className="min-w-0">
        <code className="text-[11.5px] font-mono text-ink">{name}</code>
        <p className="text-[11.5px] text-ink-3 leading-snug mt-0.5">{detail}</p>
      </div>
    </li>
  );
}
