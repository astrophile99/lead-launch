import { NextResponse } from "next/server";
import { appConfig } from "@/config/app";
import { fail } from "@/lib/api";
import { consumeOAuthState } from "@/lib/oauth";
import { exchangeCode, fetchGoogleProfile, storeGrant } from "@/providers/messaging/gmail";

/**
 * GET /api/oauth/google/callback
 *
 * Where Google sends the browser back. Verifies state, exchanges the code with
 * the PKCE verifier, stores the encrypted grant, and returns the user to the
 * page they started from.
 *
 * Nothing in the query string is trusted. `state` is checked against a
 * server-side row before the code is used at all, and the redirect target comes
 * from that row rather than from the URL, so a crafted callback cannot bounce
 * the user somewhere else.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = appConfig.appUrl.replace(/\/$/, "");

  try {
    const denied = url.searchParams.get("error");
    if (denied) {
      // The user pressed Cancel, or the app is not approved for the scope.
      const back = new URL("/settings", base);
      back.searchParams.set("tab", "gmail");
      back.searchParams.set("oauth", "denied");
      back.searchParams.set("reason", denied.slice(0, 80));
      return NextResponse.redirect(back.toString());
    }

    const { codeVerifier, workspaceId, redirectTo } = await consumeOAuthState(
      "google",
      url.searchParams.get("state"),
    );

    const code = url.searchParams.get("code");
    if (!code) {
      const back = new URL("/settings", base);
      back.searchParams.set("tab", "gmail");
      back.searchParams.set("oauth", "failed");
      return NextResponse.redirect(back.toString());
    }

    const grant = await exchangeCode(code, codeVerifier);
    const profile = await fetchGoogleProfile(grant.access_token!);

    await storeGrant(
      workspaceId,
      {
        accessToken: grant.access_token!,
        refreshToken: grant.refresh_token ?? null,
        expiresIn: grant.expires_in ?? 3600,
        // Record the scopes Google actually granted, not the ones we asked for.
        scope: grant.scope ?? "",
      },
      profile,
    );

    const back = new URL(redirectTo ?? "/settings?tab=gmail", base);
    back.searchParams.set("oauth", "connected");
    return NextResponse.redirect(back.toString());
  } catch (e) {
    return fail(e);
  }
}
