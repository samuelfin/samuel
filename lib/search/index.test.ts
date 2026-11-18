import { describe, expect, it } from "vitest";
import { buildSearchIndex, looksLikeSymbol, normalize, search } from "./index";

const index = buildSearchIndex();

describe("search", () => {
  it("puts an exact function code first", () => {
    const groups = search(index, "eco");
    expect(groups[0].category).toBe("Function");
    expect(groups[0].results[0].href).toBe("/economy");
  });

  it("finds indicators by name", () => {
    const labels = search(index, "inflation").flatMap((g) => g.results.map((r) => r.label));
    expect(labels).toContain("Headline inflation");
    expect(labels).toContain("Food inflation");
  });

  it("groups results by category without duplicates", () => {
    const categories = search(index, "ngx").map((g) => g.category);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it("caps results per category", () => {
    for (const group of search(index, "n", 3)) expect(group.results.length).toBeLessThanOrEqual(3);
  });

  it("returns nothing for blank or unmatched queries", () => {
    expect(search(index, "   ")).toEqual([]);
    expect(search(index, "zzzzqqq")).toEqual([]);
  });

  it("links every entry to an internal route", () => {
    for (const entry of index) expect(entry.href.startsWith("/")).toBe(true);
  });
});

describe("helpers", () => {
  it("normalises ampersands and punctuation", () => {
    expect(normalize("Oil & Gas")).toBe("oil and gas");
    expect(normalize("Construction/Real Estate")).toBe("construction real estate");
  });

  it("recognises ticker-shaped queries", () => {
    expect(looksLikeSymbol("MTNN")).toBe(true);
    expect(looksLikeSymbol("mtnn")).toBe(false);
    expect(looksLikeSymbol("A")).toBe(false);
  });
});
