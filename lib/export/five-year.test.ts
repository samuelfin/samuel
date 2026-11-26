import { describe, expect, it } from "vitest";
import { fiveYearFilename, fiveYearSheets, type FiveYearInput, type FiveYearMetric } from "./five-year";
import type { MetricDefinition } from "@/lib/metrics/definitions";
import { coverageScore } from "@/lib/metrics/coverage";
import type { FigureSource } from "@/lib/metrics/series";

/**
 * A file is read without the page around it.
 *
 * Nobody downloading a workbook remembers which company, which basis or which
 * day it came from, so every sheet says. And a year with no figure says so in
 * words: a zero in a spreadsheet is a number somebody will chart, and a blank is
 * a number somebody will assume.
 */

const years = [2023, 2024];

const figures: FigureSource[] = [
  {
    financialYear: 2024,
    lineItem: "revenue",
    valueStandardised: 2131750000000,
    reported: "2,131,750 millions",
    sourcePage: 215,
    documentTitle: "Zenith Bank Plc — financial statements 2023",
    sourceUri: "https://issuer.test/ar.pdf",
    audited: true,
    consolidated: true,
    currency: "NGN",
  },
];

const metric = (over: Partial<FiveYearMetric> = {}): FiveYearMetric => ({
  code: "net_margin",
  financialYear: 2024,
  status: "available",
  reason: null,
  value: "31.753677",
  definitionVersion: 1,
  currency: "NGN",
  consolidated: true,
  allAudited: true,
  disclosedPage: null,
  ...over,
});

const definition: MetricDefinition = {
  id: "d1",
  code: "net_margin",
  version: 1,
  label: "Net profit margin",
  definition: "Profit after tax as a percentage of revenue, from the income statement of the same period.",
  kind: "margin",
  resultUnit: "percent",
  decimals: 1,
  group: "profitability",
  templateId: null,
  templateName: null,
  disclosedLineItem: null,
  disclosedLabel: null,
  windowYears: null,
  ownerName: "Interim: Technical Lead",
  approvedByName: "Interim: Technical Lead",
  approvedAt: "2026-11-26T00:00:00Z",
  selfApproved: true,
  rejectedAt: null,
  decisionReason: "Checked against the filing.",
  recordReason: "Seeded with stage 3d.",
  recordedBy: null,
  effectiveFrom: "2026-11-26",
  isActive: true,
  status: "published",
  sortOrder: 30,
  inputs: [
    { role: "numerator", lineItem: "profit_after_tax", label: "Profit after tax", sign: 1, useAbsolute: false, sortOrder: 10 },
    { role: "denominator", lineItem: "revenue", label: "Revenue", sign: 1, useAbsolute: false, sortOrder: 10 },
  ],
};

function input(over: Partial<FiveYearInput> = {}): FiveYearInput {
  return {
    company: { name: "Zenith Bank Plc", symbol: "ZENITHBANK", sector: "Banking" },
    generatedAt: "2026-11-26T18:30:05.123Z",
    years,
    figures,
    figureLabels: new Map([["revenue", "Revenue"]]),
    metrics: [metric()],
    definitions: [definition],
    coverage: coverageScore({
      years,
      required: [{ statementType: "income", lineItem: "revenue", label: "Revenue" }],
      statements: [{ financialYear: 2024, statementType: "income", lineItems: ["revenue"] }],
    }),
    ...over,
  };
}

function flat(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map((cell) => String(cell ?? "")).join(" | ")).join("\n");
}

describe("the workbook a reader downloads", () => {
  const sheets = fiveYearSheets(input());

  it("has a sheet for the figures, the ratios, the sources and the method", () => {
    expect(sheets.map((sheet) => sheet.name)).toEqual([
      "Figures",
      "Ratios",
      "Sources",
      "How calculated",
    ]);
  });

  it("says on every sheet who it is about, when it was generated and where the figures came from", () => {
    for (const sheet of sheets) {
      const text = flat(sheet.rows);
      expect(text, sheet.name).toContain("Zenith Bank Plc (ZENITHBANK)");
      expect(text, sheet.name).toContain("2026-11-26 18:30:05 UTC");
      expect(text, sheet.name).toContain("named on the Sources sheet");
      expect(text, sheet.name).toContain("1 of 2 years verified");
      expect(text, sheet.name).toContain("No figure is converted between currencies");
    }
  });

  it("writes a figure as a number and a missing year as a sentence", () => {
    const text = flat(sheets[0].rows);
    expect(sheets[0].rows.some((row) => row.includes(2131750000000))).toBe(true);
    expect(text).toContain("Pending verification");
    expect(text).not.toContain("| 0 |");
  });

  it("carries the page and the filing for every figure", () => {
    const text = flat(sheets[2].rows);
    expect(text).toContain("215");
    expect(text).toContain("Zenith Bank Plc — financial statements 2023");
    expect(text).toContain("https://issuer.test/ar.pdf");
    expect(text).toContain("Audited");
    expect(text).toContain("Consolidated");
  });

  it("carries the formula, its version and who approved it", () => {
    const text = flat(sheets[3].rows);
    expect(text).toContain("Profit after tax ÷ Revenue");
    expect(text).toContain("v1");
    expect(text).toContain("Interim: Technical Lead, who also recorded it");
    expect(text).toContain("No economist has reviewed these formulas");
  });

  it("marks the ratio with the version it was computed under", () => {
    const text = flat(sheets[1].rows);
    expect(text).toContain("Net profit margin");
    expect(text).toContain("31.753677");
    expect(text).toContain("v1");
  });
});

describe("what the workbook refuses to imply", () => {
  it("gives the reason, in words, where a ratio has no answer", () => {
    const sheets = fiveYearSheets(
      input({ metrics: [metric({ status: "not_available", value: null, reason: "no_prior_period" })] }),
    );
    const text = flat(sheets[1].rows);
    expect(text).toMatch(/Not available: the previous financial year is not held/);
    expect(text).not.toContain("| 0 |");
  });

  it("says when a figure is the issuer's own rather than ours", () => {
    const sheets = fiveYearSheets(
      input({ metrics: [metric({ status: "disclosed", value: "28.4", disclosedPage: 9 })] }),
    );
    expect(flat(sheets[1].rows)).toContain("Reported by the issuer: 28.4");
    // And it appears on the Sources sheet with its page, like any reported figure.
    expect(flat(sheets[2].rows)).toContain("as the issuer disclosed it");
    expect(flat(sheets[2].rows)).toContain("9");
  });

  it("says plainly when there is nothing to show", () => {
    const sheets = fiveYearSheets(input({ figures: [], metrics: [], definitions: [] }));
    expect(flat(sheets[0].rows)).toContain("No figure has been entered and checked");
    expect(flat(sheets[1].rows)).toContain("No ratio is published for this company");
  });
});

describe("the filename", () => {
  it("names the company and the window, and nothing a shell would mind", () => {
    expect(fiveYearFilename("zenith-bank", [2021, 2022, 2023, 2024, 2025])).toBe(
      "sfi-zenith-bank-2021-2025.xlsx",
    );
    expect(fiveYearFilename("odd/slug; rm -rf", [2024])).toBe("sfi-odd-slug--rm--rf-2024-2024.xlsx");
  });
});
