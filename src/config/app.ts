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

/** Comma-separated env value -> trimmed, de-duplicated, non-empty entries. */
function list(key: string): string[] {
  const v = env(key);
  if (!v) return [];
  const seen = new Set<string>();
  for (const part of v.split(",")) {
    const t = part.trim();
    if (t) seen.add(t);
  }
  return [...seen];
}

function bool(key: string, fallback: boolean): boolean {
  const v = env(key)?.toLowerCase();
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes";
}

/** FOSSGIS's round-robin front door. Free, worldwide, no key. */
const OVERPASS_DEFAULT = "https://overpass-api.de/api/interpreter";

/**
 * Tried in order after the primary, and only after it has been retried.
 *
 * The first two are the individual FOSSGIS machines that `overpass-api.de`
 * round-robins between. Addressing them by name is what makes recovery
 * deterministic rather than a coin flip: when one is unhealthy, retrying the
 * round-robin hostname may keep landing on the broken half, whereas the named
 * hosts reach the working one directly. They are listed in no meaningful
 * order - which of the two is healthy changes over time, and the point is that
 * both get tried.
 *
 * `private.coffee` is an independent worldwide instance documented on the OSM
 * wiki, kept last so third-party infrastructure is only used once FOSSGIS's
 * own has failed.
 */
const OVERPASS_FALLBACKS = [
  "https://lambert.openstreetmap.de/api/interpreter",
  "https://gall.openstreetmap.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

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
    /**
     * Overpass endpoint for the free discovery layer.
     *
     * Kept as a single URL for backwards compatibility; `overpassUrls` below
     * is what the provider actually reads.
     */
    overpassUrl: env("OVERPASS_API_URL") ?? OVERPASS_DEFAULT,
    /**
     * The endpoints the provider will try, in order.
     *
     * Why a list at all: `overpass-api.de` is a DNS round-robin over two
     * FOSSGIS machines, and when one of them is unhealthy it answers *every*
     * query - including a trivial one - with `504 Dispatcher_Client::
     * request_read_and_idx::timeout`. A single-endpoint client with no retry
     * therefore fails roughly half the time through no fault of the query.
     *
     * Resolution order:
     *   - `OVERPASS_API_URLS` set  -> exactly that list, nothing appended.
     *     This is the escape hatch for pinning to one instance: set it to a
     *     single URL and no built-in fallback is ever contacted.
     *   - otherwise                -> `OVERPASS_API_URL` (or the default)
     *     first, then the built-in fallbacks.
     *
     * The built-ins are worldwide-coverage instances only. Regional servers
     * (Switzerland, Britain and Ireland, Virginia, Ethiopia) are deliberately
     * excluded: they answer 200 with zero elements for anywhere outside their
     * region, which would read as "no businesses found" rather than as a
     * failure - a wrong answer is worse than an error.
     */
    get overpassUrls(): string[] {
      const explicit = list("OVERPASS_API_URLS");
      if (explicit.length) return explicit;
      const primary = env("OVERPASS_API_URL") ?? OVERPASS_DEFAULT;
      return [primary, ...OVERPASS_FALLBACKS.filter((u) => u !== primary)];
    },
    // Getters, like overpassUrls above: the retry budget is the one thing a
    // test of the retry logic has to be able to change.
    /** Per-attempt ceiling. Overpass answers healthy queries in a few seconds. */
    get overpassTimeoutMs(): number {
      return int("OVERPASS_TIMEOUT_MS", 25_000);
    },
    /**
     * Total attempts across all endpoints. Bounded so a public, volunteer-run
     * service is never hammered on our behalf.
     */
    get overpassMaxAttempts(): number {
      return int("OVERPASS_MAX_ATTEMPTS", 4);
    },
    /**
     * Wall-clock budget for the whole discovery call. No new attempt starts
     * once this is spent, so the request cannot outlive the serverless
     * function waiting on it.
     *
     * The budget is split between the endpoints still to be tried, so it has
     * to cover the slow case several times over: with four endpoints, 45s gave
     * each attempt 11s, which cut off servers measured answering in 9.2s under
     * load. 60s gives each 15s and matches what these servers actually do.
     * Lower it to fit a shorter platform limit - Vercel Hobby functions stop
     * at 10s - accepting that fewer endpoints will be reached.
     */
    get overpassDeadlineMs(): number {
      return int("OVERPASS_DEADLINE_MS", 60_000);
    },
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
