import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Per-request security envelope: a fresh CSP nonce, then the Supabase session
 * refresh. The nonce goes out on the request (so Next.js can stamp it onto the
 * scripts and styles it renders) and on the response (so the browser enforces it).
 *
 * Static security headers that need no nonce live in `next.config.ts`, which also
 * covers the static-asset paths this proxy deliberately skips.
 */
export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the nonce out of this request header while rendering.
  requestHeaders.set("Content-Security-Policy", policy);

  // Applies to the redirect to /login as well, not just the rendered page.
  const response = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
