import { describe, expect, it } from "vitest";
import { DATASETS, PROVIDERS, connectedDatasetCount, isConnected, notConnected, type DatasetId } from "./registry";

describe("provider registry", () => {
  it("maps every dataset to a known provider", () => {
    for (const provider of Object.values(DATASETS)) expect(PROVIDERS[provider]).toBeDefined();
  });

  it("has no connected datasets until an approved adapter is registered", () => {
    expect(connectedDatasetCount()).toBe(0);
    for (const dataset of Object.keys(DATASETS) as DatasetId[]) expect(isConnected(dataset)).toBe(false);
  });

  it("returns an explicit unavailable result naming the planned source and gate", () => {
    expect(notConnected("equities.prices")).toEqual({
      state: "unavailable",
      dataset: "equities.prices",
      reason: "no_provider",
      message: "Planned source: NGX — licence quote required.",
    });
  });

  it("supports a per-series provider override", () => {
    expect(notConnected("economy.observations", "cbn").message).toContain("CBN");
  });

  it("describes SFI-owned sources without a licensing gate", () => {
    // Reached through the provider override: no SFI dataset is registered, because
    // editorial sits beside the dataset machinery rather than inside it.
    expect(notConnected("companies.financials", "sfi").message).toMatch(/no approved items/i);
  });
});
