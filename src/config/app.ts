/**
 * Global runtime configuration, resolved once from the environment.
 *
 * Nothing else in the application reads process.env. That keeps one answer to
 * "is this integration real or mocked?" per concern, lets the UI label mock
 * output honestly, and makes it obvious that every secret here is server-only.
 *
 * SECURITY: no value in this file may ever be prefixed NEXT_PUBLIC_. Everything
 * below is read in server components, route handlers and server actions only.
 * The single browser-visible flag lives in `publicConfig` at the bottom.
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

function bool(key: string, fallback: boolean): boolean {
  const v = env(key)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes";
}

export const appConfig = {
  mode: (env("APP_MODE") ?? "demo") as AppMode,
  defaultWorkspaceSlug: env("DEFAULT_WORKSPACE_SLUG") ?? "studio",
  appUrl: env("APP_URL") ?? "http://localhost:3000",

  auth: {
    /** Supabase project URL. Safe to expose; the anon key is not a secret either. */
    supabaseUrl: env("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    /** Server-only. Bypasses row-level security; never send this to a browser. */
    supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    googleOAuthEnabled: bool("AUTH_GOOGLE_ENABLED", false),
  },

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

  email: {
    resendKey: env("RESEND_API_KEY"),
    fromAddress: env("OUTREACH_FROM_EMAIL"),
  },

  whatsapp: {
    /** System-user access token with whatsapp_business_messaging. Server-only. */
    accessToken: env("WHATSAPP_ACCESS_TOKEN"),
    /** Shared secret Meta echoes back when registering the webhook. */
    webhookVerifyToken: env("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    /** Used to verify the X-Hub-Signature-256 header on inbound webhooks. */
    appSecret: env("META_APP_SECRET"),
    apiVersion: env("META_API_VERSION") ?? "v21.0",
  },

  instagram: {
    accessToken: env("INSTAGRAM_ACCESS_TOKEN"),
    webhookVerifyToken: env("INSTAGRAM_WEBHOOK_VERIFY_TOKEN"),
    apiVersion: env("META_API_VERSION") ?? "v21.0",
  },

  outreach: {
    rateLimitPerHour: int("OUTREACH_RATE_LIMIT_PER_HOUR", 20),
  },

  storage: {
    /** supabase | none. Where generated website assets persist in production. */
    provider: env("STORAGE_PROVIDER") ?? "none",
    bucket: env("STORAGE_BUCKET") ?? "websites",
  },

  repo: {
    /** Personal access token used to push generated projects to Git. */
    githubToken: env("GITHUB_TOKEN"),
    githubOwner: env("GITHUB_OWNER"),
    /** Prefix applied to every generated repository name. */
    repoPrefix: env("GITHUB_REPO_PREFIX") ?? "site-",
  },

  studio: {
    projectsRoot: env("PROJECTS_ROOT") ?? "./projects",
    maxQaIterations: int("WEBSITE_MAX_QA_ITERATIONS", 3),
  },
} as const;

/** Convenience predicates so callers do not re-derive "is this usable?". */
export const capabilities = {
  get hasAnyAiKey() {
    return Boolean(appConfig.ai.anthropic || appConfig.ai.openai || appConfig.ai.gemini);
  },
  get hasBusinessDataKey() {
    return Boolean(appConfig.businessData.googlePlaces || appConfig.businessData.serpapi);
  },
  get hasDeploymentKey() {
    return Boolean(appConfig.deployment.vercelToken || appConfig.deployment.netlifyToken);
  },
  get hasEmail() {
    return Boolean(appConfig.email.resendKey && appConfig.email.fromAddress);
  },
  get hasAuth() {
    return Boolean(appConfig.auth.supabaseUrl && appConfig.auth.supabaseAnonKey);
  },
  get hasStorage() {
    return appConfig.storage.provider !== "none";
  },
  get hasRepo() {
    return Boolean(appConfig.repo.githubToken && appConfig.repo.githubOwner);
  },
};

/**
 * The only configuration a browser bundle may contain. Keep it to flags — never
 * credentials, and never anything that would change a security decision.
 */
export const publicConfig = {
  mode: appConfig.mode,
} as const;
