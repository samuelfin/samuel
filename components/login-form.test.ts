import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// After sign-in the form must do a full page load. A client-side
// router.replace("/") + router.refresh() raced the new session cookie and left
// a blank screen until the reader reloaded by hand.
describe("login form", () => {
  const source = readFileSync(new URL("./login-form.tsx", import.meta.url), "utf8");

  it("leaves the sign-in page with a full page load", () => {
    expect(source).toMatch(/window\.location\.assign\("\/"\)/);
  });

  it("does not navigate client-side after signing in", () => {
    expect(source).not.toMatch(/router\.(replace|push|refresh)\(/);
  });
});
