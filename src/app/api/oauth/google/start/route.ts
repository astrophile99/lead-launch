import { NextResponse } from "next/server";
import { appConfig, capabilities } from "@/config/app";
import { requireWrite } from "@/lib/authz";
import { fail } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { beginOAuth } from "@/lib/oauth";
import { assertRate } from "@/lib/rate-limit";
import { GOOGLE_SCOPES } from "@/providers/messaging/gmail";

/**
 * GET /api/oauth/google/start
 *
 * Redirects to Google's consent screen.
 *
 * `access_type=offline` plus `prompt=consent` because we need a refresh token
 * and Google only issues one on an explicit consent — without it, reconnecting
 * an account silently produces a connection that stops working within the hour.
 *
 * The scope list is exactly what the feature needs: create, update and send
 * drafts. It is spelled out in the provider rather than assembled dynamically,
 * so anyone reviewing this can see the full extent of what is requested.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireWrite();
    assertRate(`oauth-start:${ctx.workspaceId}`, 10, 60_000, "authorisation");

    if (!capabilities.canStoreSecrets) {
      throw new AppError({
        kind: "not-configured",
        message: "TOKEN_ENCRYPTION_KEY is not set, so a Google refresh token cannot be stored.",
        remedy:
          "Set TOKEN_ENCRYPTION_KEY on the server before connecting Gmail. The app will not store the token in plaintext.",
      });
    }
    if (!capabilities.hasGoogleOAuth) {
      throw new AppError({
        kind: "not-configured",
        message: "Google OAuth is not configured on this server.",
        remedy:
          "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI, then restart.",
      });
    }

    const url = new URL(request.url);
    const raw = url.searchParams.get("returnTo");
    // Only same-origin relative paths, so this cannot be turned into an open
    // redirect by appending ?returnTo=https://evil.example. The leading
    // `[^/\\]` rejects protocol-relative URLs, which start with two slashes.
    const redirectTo = raw && /^\/[^/\\]/.test(raw) ? raw : "/settings?tab=gmail";

    const { state, codeChallenge } = await beginOAuth("google", ctx.workspaceId, redirectTo);

    const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorize.searchParams.set("client_id", appConfig.google.clientId!);
    authorize.searchParams.set("redirect_uri", appConfig.google.redirectUri!);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
    authorize.searchParams.set("include_granted_scopes", "true");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("code_challenge", codeChallenge);
    authorize.searchParams.set("code_challenge_method", "S256");

    return NextResponse.redirect(authorize.toString());
  } catch (e) {
    return fail(e);
  }
}
