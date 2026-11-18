import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy, createNonce, supabaseOrigins } from "./csp";

const PROD = { nonce: "test-nonce", isDevelopment: false, supabaseUrl: "https://abc123.supabase.co" };

function directive(policy: string, name: string): string | undefined {
  return policy.split("; ").find((d) => d === name || d.startsWith(`${name} `));
}

describe("createNonce", () => {
  it("returns a fresh base64 value each time", () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("carries at least 128 bits of entropy", () => {
    expect(Buffer.from(createNonce(), "base64")).toHaveLength(16);
  });
});

describe("supabaseOrigins", () => {
  it("returns the https origin and its websocket origin", () => {
    expect(supabaseOrigins("https://abc123.supabase.co")).toEqual([
      "https://abc123.supabase.co",
      "wss://abc123.supabase.co",
    ]);
  });

  it("ignores a path on the configured URL", () => {
    expect(supabaseOrigins("https://abc123.supabase.co/rest/v1")).toEqual([
      "https://abc123.supabase.co",
      "wss://abc123.supabase.co",
    ]);
  });

  it("widens nothing when the URL is missing or unusable", () => {
    expect(supabaseOrigins(undefined)).toEqual([]);
    expect(supabaseOrigins("")).toEqual([]);
    expect(supabaseOrigins("not a url")).toEqual([]);
    expect(supabaseOrigins("javascript:alert(1)")).toEqual([]);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("binds scripts to the nonce and strict-dynamic", () => {
    const policy = buildContentSecurityPolicy(PROD);
    expect(directive(policy, "script-src")).toBe("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
  });

  it("locks down the dangerous directives", () => {
    const policy = buildContentSecurityPolicy(PROD);
    expect(directive(policy, "default-src")).toBe("default-src 'self'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "frame-src")).toBe("frame-src 'none'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
    expect(directive(policy, "form-action")).toBe("form-action 'self'");
  });

  it("never allows inline or eval'd script in production", () => {
    const policy = buildContentSecurityPolicy(PROD);
    expect(directive(policy, "script-src")).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows inline style attributes but not inline <style> elements", () => {
    const policy = buildContentSecurityPolicy(PROD);
    expect(directive(policy, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'nonce-test-nonce'");
  });

  it("lets the browser reach Supabase over https and wss, and nothing else", () => {
    expect(directive(buildContentSecurityPolicy(PROD), "connect-src")).toBe(
      "connect-src 'self' https://abc123.supabase.co wss://abc123.supabase.co",
    );
  });

  it("keeps connect-src tight when Supabase is not configured", () => {
    const policy = buildContentSecurityPolicy({ ...PROD, supabaseUrl: undefined });
    expect(directive(policy, "connect-src")).toBe("connect-src 'self'");
  });

  it("self-hosts fonts rather than allowing an external origin", () => {
    expect(directive(buildContentSecurityPolicy(PROD), "font-src")).toBe("font-src 'self'");
  });

  it("upgrades insecure requests in production only", () => {
    expect(buildContentSecurityPolicy(PROD)).toContain("upgrade-insecure-requests");
    expect(buildContentSecurityPolicy({ ...PROD, isDevelopment: true })).not.toContain("upgrade-insecure-requests");
  });

  it("grants the development-only allowances needed by React and Turbopack", () => {
    const dev = buildContentSecurityPolicy({ ...PROD, isDevelopment: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "style-src")).toContain("'unsafe-inline'");
    expect(directive(dev, "connect-src")).toContain("ws:");
  });
});
