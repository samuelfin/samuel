import { describe, expect, it } from "vitest";
import { isPublicPath } from "./proxy";

describe("isPublicPath", () => {
  it("allows the sign-in, reset and auth callback routes", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
  });

  it("protects terminal and admin routes", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/markets")).toBe(false);
    expect(isPublicPath("/admin")).toBe(false);
    expect(isPublicPath("/companies/MTNN")).toBe(false);
  });

  it("does not treat look-alike prefixes as public", () => {
    expect(isPublicPath("/login-help")).toBe(false);
    expect(isPublicPath("/authority")).toBe(false);
  });
});
