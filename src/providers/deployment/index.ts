import { appConfig } from "@/config/app";
import { AppError, notConfigured } from "@/lib/errors";

/**
 * Deployment adapters.
 *
 * When no credential is configured the provider says so explicitly and the UI
 * shows setup instructions. Nothing ever reports a successful deployment that
 * did not happen, and no fake preview URL is ever generated.
 */

export type DeployInput = {
  projectSlug: string;
  files: { path: string; content: string }[];
  environment: "preview" | "production";
};

export type DeployResult = {
  status: "ready" | "building" | "failed";
  url: string | null;
  detail: string;
};

export interface DeploymentProvider {
  readonly id: string;
  readonly label: string;
  readonly setupHint: string;
  isConfigured(): boolean;
  deploy(input: DeployInput): Promise<DeployResult>;
}

class VercelProvider implements DeploymentProvider {
  readonly id = "vercel";
  readonly label = "Vercel";
  readonly setupHint =
    "Create a token at vercel.com/account/tokens and set VERCEL_TOKEN (plus VERCEL_TEAM_ID if the project belongs to a team).";

  isConfigured(): boolean {
    return Boolean(appConfig.deployment.vercelToken);
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const token = appConfig.deployment.vercelToken;
    if (!token) throw notConfigured("Vercel", this.setupHint);

    const query = appConfig.deployment.vercelTeamId
      ? `?teamId=${encodeURIComponent(appConfig.deployment.vercelTeamId)}`
      : "";

    const res = await fetch(`https://api.vercel.com/v13/deployments${query}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: input.projectSlug,
        target: input.environment === "production" ? "production" : undefined,
        files: input.files.map((f) => ({ file: f.path, data: f.content })),
        projectSettings: { framework: null },
      }),
    });

    const payload = (await res.json()) as { url?: string; error?: { message?: string }; readyState?: string };

    if (!res.ok) {
      throw new AppError({
        kind: res.status === 403 ? "not-configured" : "provider-error",
        message: payload.error?.message ?? `Vercel returned HTTP ${res.status}.`,
        remedy:
          res.status === 403
            ? "The token was rejected. Check VERCEL_TOKEN and the team scope."
            : "Check the Vercel dashboard for the deployment log, then retry.",
        retryable: res.status >= 500,
      });
    }

    return {
      status: payload.readyState === "READY" ? "ready" : "building",
      url: payload.url ? `https://${payload.url}` : null,
      detail: `Deployment created on Vercel (${input.environment}).`,
    };
  }
}

class NetlifyProvider implements DeploymentProvider {
  readonly id = "netlify";
  readonly label = "Netlify";
  readonly setupHint =
    "Create a personal access token at app.netlify.com/user/applications and set NETLIFY_TOKEN.";

  isConfigured(): boolean {
    return Boolean(appConfig.deployment.netlifyToken);
  }

  async deploy(): Promise<DeployResult> {
    if (!this.isConfigured()) throw notConfigured("Netlify", this.setupHint);
    throw new AppError({
      kind: "not-configured",
      message: "The Netlify adapter needs its digest upload step implemented.",
      remedy:
        "Netlify deploys require a SHA1 file digest handshake. Use the Vercel adapter, or complete this adapter before enabling it.",
    });
  }
}

class NoDeploymentProvider implements DeploymentProvider {
  readonly id = "none";
  readonly label = "No deployment provider";
  readonly setupHint =
    "Set VERCEL_TOKEN (or NETLIFY_TOKEN) in .env to deploy from here. Until then, the generated files are on disk under the projects root and can be deployed by hand.";

  isConfigured(): boolean {
    return false;
  }

  async deploy(): Promise<DeployResult> {
    throw notConfigured("Deployment", this.setupHint);
  }
}

const providers: DeploymentProvider[] = [
  new VercelProvider(),
  new NetlifyProvider(),
  new NoDeploymentProvider(),
];

export function getDeploymentProvider(id?: string | null): DeploymentProvider {
  if (id) {
    const explicit = providers.find((p) => p.id === id);
    if (explicit) return explicit;
  }
  return providers.find((p) => p.isConfigured()) ?? providers[providers.length - 1];
}

export function deploymentProviderHealth() {
  return providers
    .filter((p) => p.id !== "none")
    .map((p) => ({
      id: p.id,
      label: p.label,
      configured: p.isConfigured(),
      isMock: false,
      setupHint: p.setupHint,
    }));
}
