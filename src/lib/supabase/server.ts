import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * The Supabase server client, memoized for the duration of one request.
 *
 * Creating one is not free, and the expensive part is invisible: this project
 * signs its JWTs with ES256, so `getClaims()` verifies them locally against
 * the project's JSON Web Key Set — but the key set is cached on the *client
 * instance* (`this.jwks` in GoTrueClient). A brand-new client starts with an
 * empty cache, so every additional client means another network round trip to
 * `/.well-known/jwks.json` before a single claim can be checked. Measured
 * against this project: 33-38ms warm, 304-580ms cold.
 *
 * The app layout, the chrome loader and the page each used to build their own
 * client, so one navigation paid that three times over before touching the
 * database. `cache()` is request-scoped, so this collapses them into one
 * client per render without sharing anything between requests or users.
 *
 * Note this memoizes the *client*, never the identity: `getClaims()` still
 * runs per call, still verifies the caller's own token, and still fails
 * closed.
 */
export const createSupabaseServerClient = cache(async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot always mutate cookies.
          // Route handlers / middleware handle session refresh when needed.
        }
      },
    },
  });
});