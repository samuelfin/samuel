import { describe, expect, it } from "vitest";
import { STATUS_META, isStale } from "./status";

const now = new Date("2026-11-18T12:00:00Z");

describe("isStale", () => {
  it("treats a daily value from earlier this week as fresh", () => {
    expect(isStale("2026-11-16T14:30:00Z", "daily", now)).toBe(false);
  });

  it("treats a daily value older than the policy as stale", () => {
    expect(isStale("2026-11-01T14:30:00Z", "daily", now)).toBe(true);
  });

  it("allows monthly releases to lag their reference period", () => {
    // October CPI (period end 31 Oct) is still current in mid-November.
    expect(isStale("2026-10-31", "monthly", now)).toBe(false);
    expect(isStale("2026-06-30", "monthly", now)).toBe(true);
  });

  it("never marks event-driven series stale by age", () => {
    expect(isStale("2025-01-01", "per_event", now)).toBe(false);
  });

  it("treats invalid timestamps as stale", () => {
    expect(isStale("garbage", "annual", now)).toBe(true);
  });
});

describe("STATUS_META", () => {
  it("labels demo data unmistakably", () => {
    expect(STATUS_META.demo.short).toBe("DEMO");
    expect(STATUS_META.demo.description).toMatch(/not market data/i);
  });
});
