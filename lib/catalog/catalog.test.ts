import { describe, expect, it } from "vitest";
import { MODULES, moduleByCode, moduleForPath } from "./modules";
import { INDICATORS, HEADLINE_INDICATOR_IDS, unitLabel } from "./indicators";
import { INSTRUMENT_CLASSES, RATE_CONCEPTS } from "./fixed-income";
import { RATIOS } from "./financials";
import { PROVIDERS } from "@/lib/providers/registry";

function unique<T>(values: T[]) {
  return new Set(values).size === values.length;
}

describe("modules", () => {
  it("has the navigation modules from the brief, with unique codes and routes", () => {
    // Twelve from the original brief, plus Leadership at 3b and Methodology
    // at 3d, where the first calculated figures appear.
    expect(MODULES).toHaveLength(14);
    expect(unique(MODULES.map((m) => m.code))).toBe(true);
    expect(unique(MODULES.map((m) => m.href))).toBe(true);
  });

  it("resolves nested routes to their module", () => {
    expect(moduleForPath("/companies/MTNN")?.code).toBe("CO");
    expect(moduleForPath("/people/ada-okonkwo")?.code).toBe("LD");
    expect(moduleForPath("/")?.code).toBe("OVR");
    expect(moduleForPath("/economy")?.code).toBe("ECO");
    expect(moduleForPath("/methodology")?.code).toBe("METH");
    expect(moduleForPath("/nowhere")).toBeUndefined();
  });

  it("looks up function codes case-insensitively", () => {
    expect(moduleByCode(" fi ")?.href).toBe("/fixed-income");
  });
});

describe("indicators", () => {
  it("have unique ids and known sources", () => {
    expect(unique(INDICATORS.map((i) => i.id))).toBe(true);
    for (const i of INDICATORS) expect(PROVIDERS[i.source]).toBeDefined();
  });

  it("headline ids all exist", () => {
    for (const id of HEADLINE_INDICATOR_IDS) expect(INDICATORS.some((i) => i.id === id)).toBe(true);
  });

  it("describes units with magnitude", () => {
    expect(unitLabel("USD", "billions")).toBe("US$ bn");
    expect(unitLabel("NGN", "trillions")).toBe("₦ tn");
    expect(unitLabel("percent_per_annum")).toBe("% p.a.");
  });
});

describe("fixed income and financials", () => {
  it("keeps the four rate concepts distinct", () => {
    expect(RATE_CONCEPTS.map((c) => c.id).sort()).toEqual(["coupon", "indicative", "market_yield", "stop_rate"]);
  });

  it("references known providers", () => {
    for (const c of INSTRUMENT_CLASSES) {
      expect(PROVIDERS[c.primarySource]).toBeDefined();
      if (c.secondarySource) expect(PROVIDERS[c.secondarySource]).toBeDefined();
    }
  });

  it("gives every ratio a formula and a period rule", () => {
    for (const r of RATIOS) {
      expect(r.formula.length).toBeGreaterThan(0);
      expect(r.periodRule.length).toBeGreaterThan(0);
    }
  });
});
