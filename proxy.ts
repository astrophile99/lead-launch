import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/sign-in",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/auth/callback",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },

      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  /*
   * IMPORTANT:
   * Use getClaims() for authorization decisions.
   * Do not rely on getSession() in server-side protection.
   */
  const { data, error } = await supabase.auth.getClaims();

  const claims = error ? null : data?.claims;
  const userExists = Boolean(claims);
  const isPublic = isPublicPath(request.nextUrl.pathname);

  /*
   * Not authenticated + protected route
   * → send to sign in.
   */
  if (!userExists && !isPublic) {
    const signInUrl = request.nextUrl.clone();

    signInUrl.pathname = "/sign-in";
    signInUrl.search = "";

    signInUrl.searchParams.set(
      "redirectTo",
      request.nextUrl.pathname
    );

    return NextResponse.redirect(signInUrl);
  }

  /*
   * Authenticated user trying to visit an auth screen
   * → send them home.
   *
   * /auth/callback is excluded because OAuth/email flows need it.
   */
  if (
    userExists &&
    isPublic &&
    !request.nextUrl.pathname.startsWith("/auth/callback")
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on application routes, excluding Next internals
     * and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};