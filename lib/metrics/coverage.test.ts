import { describe, expect, it } from "vitest";
import { coverageScore, coverageSentence, type RequiredLine } from "./coverage";

/**
 * The score counts what a person has checked, and nothing else. A generous
 * coverage score is worse than no score: it tells a reader the history is there
 * and tells the desk there is nothing to do.
 */

const required: RequiredLine[] = [
  { statementType: "income", lineItem: "revenue", label: "Revenue" },
  { statementType: "income", lineItem: "profit_after_tax", label: "Profit after tax" },
  { statementType: "balance_sheet", lineItem: "total_assets", label: "Total assets" },
];

const years = [2021, 2022, 2023, 2024, 2025];

describe("the coverage score", () => {
  it("counts a year as held once anything approved exists for it", () => {
    const score = coverageScore({
      years,
      required,
      statements: [
        { financialYear: 2024, statementType: "income", lineItems: ["revenue", "profit_after_tax"] },
        { financialYear: 2024, statementType: "balance_sheet", lineItems: ["total_assets"] },
      ],
    });
    expect(score.yearsHeld).toBe(1);
    expect(score.yearsExpected).toBe(5);
    expect(score.requiredExpected).toBe(3);
    expect(score.requiredPresent).toBe(3);
    expect(coverageSentence(score)).toBe("1 of 5 years verified · 3 of 3 required figures");
  });

  it("names the required figures a held year is missing", () => {
    const score = coverageScore({
      years,
      required,
      statements: [{ financialYear: 2024, statementType: "income", lineItems: ["revenue"] }],
    });
    const year = score.years.find((entry) => entry.financialYear === 2024);
    expect(year?.missing).toEqual(["Profit after tax", "Total assets"]);
    expect(score.requiredPresent).toBe(1);
  });

  it("measures the required figures against the years held, not against years nobody has", () => {
    // Counting 2021 to 2025 as 15 required figures when only one year exists
    // would read as 1 of 15 and tell a reader the data is worse than it is;
    // counting 3 of 3 for the year held tells them what is true about it.
    const score = coverageScore({
      years,
      required,
      statements: [
        { financialYear: 2023, statementType: "income", lineItems: ["revenue", "profit_after_tax"] },
      ],
    });
    expect(score.requiredExpected).toBe(3);
    expect(score.requiredPresent).toBe(2);
  });

  it("does not count a year as held just because it is in the window", () => {
    const score = coverageScore({ years, required, statements: [] });
    expect(score.yearsHeld).toBe(0);
    expect(score.years.every((year) => !year.held)).toBe(true);
    expect(score.years.every((year) => year.missing.length === 0)).toBe(true);
    expect(coverageSentence(score)).toMatch(/No year of this company/);
  });

  it("ignores a year outside the window", () => {
    const score = coverageScore({
      years,
      required,
      statements: [{ financialYear: 2019, statementType: "income", lineItems: ["revenue"] }],
    });
    expect(score.yearsHeld).toBe(0);
  });
});
