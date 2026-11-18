import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Routes reachable without a session. Everything else redirects to sign-in. */
const PUBLIC_PATHS = ["/login", "/reset-password", "/auth/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * `headers` with its `Cookie` re-serialised from the request's current cookie jar.
 * Supabase mutates that jar when it rotates the session, and passing explicit
 * headers to `NextResponse.next` would otherwise forward the cookies as they
 * arrived. Returns a copy; the caller's `headers` is left alone.
 */
function withCurrentCookies(request: NextRequest, headers: Headers): Headers {
  const merged = new Headers(headers);
  const cookie = request.cookies.toString();
  if (cookie) merged.set("cookie", cookie);
  else merged.delete("cookie");
  return merged;
}

/**
 * Refreshes the Supabase session cookie and performs an optimistic auth check.
 * This is a fast pre-filter only; pages and data services still verify the
 * session server-side (lib/auth/session.ts).
 *
 * `requestHeaders`, when given, replaces the headers forwarded to the renderer —
 * `proxy.ts` uses it to pass the per-request CSP nonce. Because cookies travel in
 * the `Cookie` header, any refreshed cookie has to be written back into those
 * headers too, or the renderer would see the stale session.
 */
export async function updateSession(request: NextRequest, requestHeaders?: Headers) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  const forward = () =>
    requestHeaders
      ? NextResponse.next({ request: { headers: withCurrentCookies(request, requestHeaders) } })
      : NextResponse.next({ request });

  // Without Supabase settings, pages render the setup screen (or local preview in development).
  if (!url || !key) return forward();

  let response = forward();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = forward();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        for (const [name, value] of Object.entries(headers)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const redirect = NextResponse.redirect(loginUrl);
    // Carry any refreshed/cleared auth cookies onto the redirect.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }
  return response;
}
