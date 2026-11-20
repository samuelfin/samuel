/**
 * Content Security Policy for the terminal.
 *
 * The policy is nonce-based. `proxy.ts` mints a fresh nonce per request, sets it on
 * the request as `x-nonce` and in the `Content-Security-Policy` request header;
 * Next.js parses that header and applies the nonce to framework scripts, page
 * bundles and the inline styles it generates.
 *
 * Nonces normally force dynamic rendering, which costs nothing here: every route is
 * auth-gated and already request-rendered (see lib/auth/session.ts and the CI build
 * comment), so there is no static output to give up.
 */

export interface CspOptions {
  nonce: string;
  isDevelopment: boolean;
  /** `NEXT_PUBLIC_SUPABASE_URL`; the browser client calls this origin directly. */
  supabaseUrl?: string;
}

/** A fresh, unpredictable nonce. Web Crypto only, so it runs on the edge runtime. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Origins the browser Supabase client needs: REST and auth over http(s), realtime
 * over the matching websocket scheme. An unparseable or non-http URL contributes
 * nothing rather than widening the policy.
 */
export function supabaseOrigins(supabaseUrl: string | undefined): string[] {
  if (!supabaseUrl) return [];
  try {
    const { protocol, origin, host } = new URL(supabaseUrl);
    if (protocol !== "https:" && protocol !== "http:") return [];
    return [origin, `${protocol === "https:" ? "wss" : "ws"}://${host}`];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy({ nonce, isDevelopment, supabaseUrl }: CspOptions): string {
  const supabase = supabaseOrigins(supabaseUrl);

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["form-action", ["'self'"]],
    // 'strict-dynamic' lets the nonced Next.js loader pull in its own chunks without
    // listing each one. In development React needs eval for readable error stacks.
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDevelopment ? ["'unsafe-eval'"] : [])]],
    // Covers <style> elements. The dev overlay injects un-nonced styles of its own.
    ["style-src", ["'self'", `'nonce-${nonce}'`, ...(isDevelopment ? ["'unsafe-inline'"] : [])]],
    // A nonce cannot be attached to a style *attribute*, which is what React's
    // `style={{…}}` compiles to, so attributes are allowed separately. A style
    // attribute cannot execute script, so this does not reopen XSS.
    ["style-src-attr", ["'unsafe-inline'"]],
    // i.ytimg.com serves YouTube video thumbnails, and nothing else is allowed
    // from it: images only, no script and no frame. Editorial stores an
    // 11-character video id rather than a URL, so the only address that can be
    // built for this host is a thumbnail path.
    ["img-src", ["'self'", "blob:", "data:", "https://i.ytimg.com"]],
    // next/font self-hosts its files under /_next/static, so no external font origin.
    ["font-src", ["'self'"]],
    // `ws:` is the Turbopack hot-reload socket, development only.
    ["connect-src", ["'self'", ...supabase, ...(isDevelopment ? ["ws:"] : [])]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
  ];

  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  // Pointless over plain-http localhost, and it would break the dev server.
  if (!isDevelopment) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
