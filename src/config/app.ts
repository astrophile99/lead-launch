/**
 * Global runtime configuration, resolved once from the environment.
 *
 * Nothing in the UI reads process.env directly - everything goes through here
 * so that "is this integration real or mocked?" has exactly one answer per
 * concern, and so the UI can honestly label mock output.
 */

export type AppMode = "demo" | "live";

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function int(key: string, fallback: number): number {
  const v = env(key);
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const appConfig = {
  mode: (env("APP_MODE") ?? "demo") as AppMode,
  defaultWorkspaceSlug: env("DEFAULT_WORKSPACE_SLUG") ?? "studio",

  ai: {
    anthropic: env("ANTHROPIC_API_KEY"),
    openai: env("OPENAI_API_KEY"),
    gemini: env("GEMINI_API_KEY"),
  },

  businessData: {
    googlePlaces: env("GOOGLE_PLACES_API_KEY"),
    serpapi: env("SERPAPI_API_KEY"),
  },

  audit: {
    pagespeed: env("PAGESPEED_API_KEY"),
    fetchTimeoutMs: int("AUDIT_FETCH_TIMEOUT_MS", 15_000),
  },

  deployment: {
    vercelToken: env("VERCEL_TOKEN"),
    vercelTeamId: env("VERCEL_TEAM_ID"),
    netlifyToken: env("NETLIFY_TOKEN"),
  },

  outreach: {
    resend: env("RESEND_API_KEY"),
    fromEmail: env("OUTREACH_FROM_EMAIL"),
    rateLimitPerHour: int("OUTREACH_RATE_LIMIT_PER_HOUR", 20),
  },

  studio: {
    projectsRoot: env("PROJECTS_ROOT") ?? "./projects",
    maxQaIterations: int("WEBSITE_MAX_QA_ITERATIONS", 3),
  },
} as const;

/** True when no credential exists for a concern, so a mock will be used. */
export const capabilities = {
  get hasAnyAiKey() {
    return Boolean(
      appConfig.ai.anthropic || appConfig.ai.openai || appConfig.ai.gemini,
    );
  },
  get hasBusinessDataKey() {
    return Boolean(
      appConfig.businessData.googlePlaces || appConfig.businessData.serpapi,
    );
  },
  get hasDeploymentKey() {
    return Boolean(
      appConfig.deployment.vercelToken || appConfig.deployment.netlifyToken,
    );
  },
  get hasOutreachKey() {
    return Boolean(appConfig.outreach.resend && appConfig.outreach.fromEmail);
  },
};
