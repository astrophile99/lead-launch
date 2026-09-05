import { appConfig, capabilities } from "@/config/app";
import { prisma } from "@/db/client";
import { aiProviderHealth } from "@/providers/ai/router";
import { auditProviderHealth } from "@/providers/audit";
import { businessDataHealth } from "@/providers/business-data";
import { deploymentProviderHealth } from "@/providers/deployment";
import { messagingHealth } from "@/providers/messaging";

/**
 * One place that answers "what is actually connected?".
 *
 * Everything reported here is derived from configuration and, where a provider
 * supports it, a live check. A concern is never reported as connected because
 * its UI exists — only because a credential is present and, ideally, verified.
 */

export type IntegrationStatus = "connected" | "not-configured" | "error" | "mock" | "manual";

export type IntegrationItem = {
  id: string;
  label: string;
  status: IntegrationStatus;
  detail: string;
  setupHint: string;
  docsUrl?: string;
  /** True when this item can be verified against the live provider. */
  testable: boolean;
  /** Environment variables this item reads, for the setup docs. */
  envVars: string[];
  lastCheckedAt?: string | null;
};

export type IntegrationGroup = {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** True when at least one real (non-mock) item in the group is connected. */
  ready: boolean;
  items: IntegrationItem[];
};

function statusOf(configured: boolean, isMock: boolean): IntegrationStatus {
  if (isMock) return "mock";
  return configured ? "connected" : "not-configured";
}

export async function getIntegrationGroups(workspaceId: string): Promise<IntegrationGroup[]> {
  const [messaging, wa, ig] = await Promise.all([
    messagingHealth(workspaceId),
    prisma.whatsAppAccount.findUnique({ where: { workspaceId } }),
    prisma.instagramAccount.findUnique({ where: { workspaceId } }),
  ]);

  const ai: IntegrationGroup = {
    id: "ai",
    label: "AI providers",
    description:
      "Capability routing lives in the AI Control Center. Without any key the app composes from stored data and labels it.",
    icon: "cpu",
    ready: capabilities.hasAnyAiKey,
    items: aiProviderHealth().map((p) => ({
      id: p.id,
      label: p.label,
      status: statusOf(p.configured, p.isMock),
      detail: p.isMock
        ? "Always available. Rearranges stored facts; performs no inference."
        : p.configured
          ? "Key present."
          : "No key configured.",
      setupHint: p.setupHint,
      testable: !p.isMock,
      envVars: p.isMock ? [] : [`${p.id.toUpperCase()}_API_KEY`],
    })),
  };

  const discovery: IntegrationGroup = {
    id: "discovery",
    label: "Business discovery",
    description: "Finds businesses and, where the provider allows it, competitors.",
    icon: "search",
    ready: capabilities.hasBusinessDataKey,
    items: businessDataHealth().map((p) => ({
      id: p.id,
      label: p.label,
      status: statusOf(p.configured, p.isMock),
      detail: p.isMock ? "Deterministic demo businesses." : p.configured ? "Key present." : "No key configured.",
      setupHint: p.setupHint,
      testable: !p.isMock,
      envVars: p.id === "google-places" ? ["GOOGLE_PLACES_API_KEY"] : [],
      docsUrl:
        p.id === "google-places"
          ? "https://developers.google.com/maps/documentation/places/web-service/overview"
          : undefined,
    })),
  };

  const audit: IntegrationGroup = {
    id: "audit",
    label: "Website audit",
    description: "The built-in extractor always works. Lighthouse adds real Core Web Vitals.",
    icon: "stethoscope",
    ready: true,
    items: auditProviderHealth().map((p) => ({
      id: p.id,
      label: p.label,
      status: statusOf(p.configured, p.isMock),
      detail: p.setupHint,
      setupHint: p.setupHint,
      testable: p.id === "lighthouse-psi",
      envVars: p.id === "lighthouse-psi" ? ["PAGESPEED_API_KEY"] : [],
      docsUrl:
        p.id === "lighthouse-psi"
          ? "https://developers.google.com/speed/docs/insights/v5/get-started"
          : undefined,
    })),
  };

  const outreach: IntegrationGroup = {
    id: "outreach",
    label: "Outreach channels",
    description:
      "Channels without a sanctioned API for cold contact stay manual by design — the app writes, you send.",
    icon: "send",
    ready: messaging.some((m) => m.configured),
    items: messaging.map((m) => ({
      id: m.id,
      label: m.label,
      status:
        m.status === "connected"
          ? "connected"
          : m.status === "error"
            ? "error"
            : m.status === "manual"
              ? "manual"
              : "not-configured",
      detail: m.detail,
      setupHint: m.setupHint,
      docsUrl: m.docsUrl,
      testable: !m.manualOnly,
      envVars:
        m.channel === "email"
          ? ["RESEND_API_KEY", "OUTREACH_FROM_EMAIL"]
          : m.channel === "whatsapp"
            ? ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "META_APP_SECRET"]
            : m.channel === "instagram"
              ? ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_WEBHOOK_VERIFY_TOKEN"]
              : [],
      lastCheckedAt:
        m.channel === "whatsapp"
          ? (wa?.lastCheckedAt?.toISOString() ?? null)
          : m.channel === "instagram"
            ? (ig?.lastCheckedAt?.toISOString() ?? null)
            : null,
    })),
  };

  const deployment: IntegrationGroup = {
    id: "deployment",
    label: "Deployment",
    description: "Generated sites exist on disk regardless; these push them somewhere public.",
    icon: "deploy",
    ready: capabilities.hasDeploymentKey,
    items: deploymentProviderHealth().map((p) => ({
      id: p.id,
      label: p.label,
      status: statusOf(p.configured, false),
      detail: p.configured ? "Token present." : "No token configured.",
      setupHint: p.setupHint,
      testable: p.id === "vercel",
      envVars: p.id === "vercel" ? ["VERCEL_TOKEN", "VERCEL_TEAM_ID"] : ["NETLIFY_TOKEN"],
    })),
  };

  const platform: IntegrationGroup = {
    id: "platform",
    label: "Platform",
    description: "Database, authentication, source control and asset storage.",
    icon: "database",
    ready: true,
    items: [
      {
        id: "database",
        label: process.env.DATABASE_URL?.startsWith("postgres")
          ? "PostgreSQL"
          : "SQLite (local dev)",
        status: "connected",
        detail: process.env.DATABASE_URL?.startsWith("postgres")
          ? "Connected to PostgreSQL."
          : "Local file database. Fine for development; move to Postgres for production.",
        setupHint:
          'Set provider = "postgresql" in prisma/schema.prisma, point DATABASE_URL at the cluster, install @prisma/adapter-pg and register it in src/db/client.ts.',
        testable: true,
        envVars: ["DATABASE_URL"],
      },
      {
        id: "auth",
        label: "Supabase Auth",
        status: capabilities.hasAuth ? "connected" : "not-configured",
        detail: capabilities.hasAuth
          ? "Project configured. Sign-in is enforced once AUTH is switched on."
          : "Not configured. The app runs single-tenant against the seeded workspace and the sign-in screens are inert.",
        setupHint:
          "Create a Supabase project, then set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.",
        docsUrl: "https://supabase.com/docs/guides/auth",
        testable: false,
        envVars: [
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
        ],
      },
      {
        id: "repo",
        label: "GitHub (generated site source)",
        status: capabilities.hasRepo ? "connected" : "not-configured",
        detail: capabilities.hasRepo
          ? `Repositories created under ${appConfig.repo.githubOwner} with prefix "${appConfig.repo.repoPrefix}".`
          : "Not configured. Generated sites live only on this machine's disk, which is not durable in a serverless deployment.",
        setupHint:
          "Create a fine-grained personal access token with repository create/write, then set GITHUB_TOKEN and GITHUB_OWNER.",
        testable: false,
        envVars: ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO_PREFIX"],
      },
      {
        id: "storage",
        label: "Object storage (assets)",
        status: capabilities.hasStorage ? "connected" : "not-configured",
        detail: capabilities.hasStorage
          ? `Using ${appConfig.storage.provider}, bucket "${appConfig.storage.bucket}".`
          : "Not configured. Uploaded and generated assets are not persisted outside this machine.",
        setupHint:
          "Set STORAGE_PROVIDER=supabase and STORAGE_BUCKET, and create the bucket in your Supabase project.",
        testable: false,
        envVars: ["STORAGE_PROVIDER", "STORAGE_BUCKET"],
      },
    ],
  };

  return [ai, discovery, audit, outreach, deployment, platform];
}

/* ------------------------------------------------------- setup checklist */

export type SetupStep = {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
  /** Optional — the app is fully usable in demo mode without it. */
  optional: boolean;
};

/** The first-run checklist. Every item is checked against real state. */
export async function getSetupSteps(workspaceId: string): Promise<SetupStep[]> {
  const [prospects, voice, wa, ig, campaigns] = await Promise.all([
    prisma.prospect.count({ where: { workspaceId } }),
    prisma.outreachVoice.count({ where: { workspaceId } }),
    prisma.whatsAppAccount.findUnique({ where: { workspaceId } }),
    prisma.instagramAccount.findUnique({ where: { workspaceId } }),
    prisma.campaign.count({ where: { workspaceId } }),
  ]);

  return [
    {
      id: "workspace",
      label: "Create your workspace",
      detail: "Done automatically when the database is seeded.",
      done: true,
      href: "/settings?tab=workspace",
      optional: false,
    },
    {
      id: "campaign",
      label: "Run your first campaign",
      detail:
        campaigns > 0
          ? `${campaigns} campaign${campaigns === 1 ? "" : "s"} run, ${prospects} prospects on file.`
          : "Find businesses worth building for. Works in demo mode with no keys.",
      done: campaigns > 0,
      href: "/discover",
      optional: false,
    },
    {
      id: "ai",
      label: "Connect an AI provider",
      detail: capabilities.hasAnyAiKey
        ? "At least one provider has a key."
        : "Without one, analysis and copy are composed from stored data rather than reasoned.",
      done: capabilities.hasAnyAiKey,
      href: "/settings?tab=integrations",
      optional: false,
    },
    {
      id: "discovery",
      label: "Connect Google Places",
      detail: capabilities.hasBusinessDataKey
        ? "Real business discovery is available."
        : "Required to discover real businesses instead of demo data.",
      done: capabilities.hasBusinessDataKey,
      href: "/settings?tab=integrations",
      optional: false,
    },
    {
      id: "voice",
      label: "Configure your outreach voice",
      detail:
        voice > 0
          ? "A voice is saved and applied to every generated message."
          : "Set the tone once so drafts sound like you, not like a model.",
      done: voice > 0,
      href: "/outreach?tab=voice",
      optional: false,
    },
    {
      id: "email",
      label: "Connect email sending",
      detail: capabilities.hasEmail
        ? "Approved emails can be sent from the app."
        : "Until this is set, approved emails must be copied and sent by hand.",
      done: capabilities.hasEmail,
      href: "/settings?tab=integrations",
      optional: true,
    },
    {
      id: "whatsapp",
      label: "Connect WhatsApp Business",
      detail:
        wa?.status === "connected"
          ? `Connected as ${wa.displayPhoneNumber ?? wa.phoneNumberId}.`
          : "Meta Cloud API. Needs an App ID, Business Account ID, Phone Number ID and a system-user token.",
      done: wa?.status === "connected",
      href: "/settings?tab=whatsapp",
      optional: true,
    },
    {
      id: "instagram",
      label: "Connect Instagram messaging",
      detail:
        ig?.status === "connected"
          ? `Connected as @${ig.username ?? ig.igBusinessId}.`
          : "Replies only — Instagram does not permit cold DMs through any sanctioned API.",
      done: ig?.status === "connected",
      href: "/settings?tab=instagram",
      optional: true,
    },
    {
      id: "deployment",
      label: "Connect Vercel",
      detail: capabilities.hasDeploymentKey
        ? "Generated sites can be deployed from here."
        : "Needed to publish a generated site to a real URL.",
      done: capabilities.hasDeploymentKey,
      href: "/settings?tab=integrations",
      optional: true,
    },
    {
      id: "auth",
      label: "Connect Supabase Auth",
      detail: capabilities.hasAuth
        ? "Authentication is configured."
        : "Required before more than one person uses this workspace.",
      done: capabilities.hasAuth,
      href: "/settings?tab=integrations",
      optional: true,
    },
  ];
}
