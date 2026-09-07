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
  isProduction: process.env.NODE_ENV === "production",

  database: {
    /** Passed to the Prisma driver adapter in src/db/client.ts. */
    url: env("DATABASE_URL") ?? "file:./dev.db",
    /**
     * Which engine is actually behind that URL. SQLite is correct for local
     * development and wrong for anything with more than one process, so the
     * distinction is surfaced rather than assumed.
     */
    get isPostgres() {
      return (env("DATABASE_URL") ?? "").startsWith("postgres");
    },
  },

  auth: {
    /** Supabase project URL. Safe to expose; the anon key is not a secret either. */
    supabaseUrl: env("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    /** Server-only. Bypasses row-level security; never send this to a browser. */
    supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    googleOAuthEnabled: bool("AUTH_GOOGLE_ENABLED", false),
  },

  security: {
    /**
     * AES-256-GCM key protecting OAuth tokens at rest. Base64 32 bytes, or any
     * longer passphrase (hashed to 32). With no key the app refuses to store a
     * provider token rather than falling back to plaintext.
     */
    tokenEncryptionKey: env("TOKEN_ENCRYPTION_KEY"),
  },

  /**
   * Gmail, via Google OAuth 2.0. There is no password field anywhere in this
   * application and there never will be - an app that asks for a Gmail password
   * is either phishing or about to be locked out by Google, and both are worse
   * than the OAuth dance.
   */
  google: {
    clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    /** Must exactly match an authorised redirect URI on the OAuth client. */
    redirectUri: env("GOOGLE_OAUTH_REDIRECT_URI"),
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

  /**
   * Research budget controls. Every one of these exists to stop the recurring
   * cost of finding out about a business from growing without anyone noticing.
   */
  research: {
    /** Hard ceiling on pages fetched per site, however many links are found. */
    maxPagesPerSite: int("RESEARCH_MAX_PAGES", 6),
    /** Refuse a response larger than this rather than buffering it. */
    maxBytesPerPage: int("RESEARCH_MAX_BYTES", 1_500_000),
    fetchTimeoutMs: int("RESEARCH_TIMEOUT_MS", 12_000),
    maxRedirects: int("RESEARCH_MAX_REDIRECTS", 3),
    /** Minimum gap between two requests to the same host, in ms. */
    hostThrottleMs: int("RESEARCH_HOST_THROTTLE_MS", 1_200),
    /** How long a cached research record stays fresh. */
    cacheTtlDays: int("RESEARCH_CACHE_TTL_DAYS", 30),
    /** Honour robots.txt on business sites. Off only for local testing. */
    respectRobots: bool("RESEARCH_RESPECT_ROBOTS", true),
    /** Identifies this crawler to the sites it visits. */
    userAgent:
      env("RESEARCH_USER_AGENT") ??
      "LeadLaunchBot/1.0 (+https://github.com/astrophile99/lead-launch; local business research)",
    /** Overpass endpoint for the free discovery layer. */
    overpassUrl: env("OVERPASS_API_URL") ?? "https://overpass-api.de/api/interpreter",
    /** Google Places calls included in the monthly free allowance. */
    googleFreeCallsPerMonth: int("GOOGLE_PLACES_FREE_CALLS", 5_000),
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
  get hasGoogleOAuth() {
    return Boolean(
      appConfig.google.clientId && appConfig.google.clientSecret && appConfig.google.redirectUri,
    );
  },
  get canStoreSecrets() {
    return Boolean(appConfig.security.tokenEncryptionKey);
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
