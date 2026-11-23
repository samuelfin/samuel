import { describe, expect, it } from "vitest";
import {
  type LineDefinition,
  type PreparedLine,
  financialYearOf,
  footingWarnings,
  formatReported,
  magnitudeApplies,
  parseFigure,
  parseIsoDate,
  parsePeriod,
  standardisePreview,
  validateLine,
  validateStatement,
  validateTemplateAssignment,
} from "./validation";

const REVENUE: LineDefinition = {
  lineItem: "revenue",
  label: "Revenue",
  statementType: "income",
  unitKind: "currency",
  unitLabel: "currency",
  standardSign: "positive",
};

const COST: LineDefinition = {
  lineItem: "cost_of_sales",
  label: "Cost of sales",
  statementType: "income",
  unitKind: "currency",
  unitLabel: "currency",
  standardSign: "negative",
};

const PAT: LineDefinition = {
  lineItem: "profit_after_tax",
  label: "Profit after tax",
  statementType: "income",
  unitKind: "currency",
  unitLabel: "currency",
  standardSign: "signed",
};

const PBT: LineDefinition = {
  lineItem: "profit_before_tax",
  label: "Profit before tax",
  statementType: "income",
  unitKind: "currency",
  unitLabel: "currency",
  standardSign: "signed",
};

const EPS: LineDefinition = {
  lineItem: "earnings_per_share",
  label: "Earnings per share",
  statementType: "income",
  unitKind: "per_share",
  unitLabel: "per share",
  standardSign: "signed",
};

const NPL: LineDefinition = {
  lineItem: "npl_ratio",
  label: "NPL ratio",
  statementType: "operating",
  unitKind: "percent",
  unitLabel: "%",
  standardSign: "positive",
};

const ASSETS: LineDefinition = {
  lineItem: "total_assets",
  label: "Total assets",
  statementType: "balance_sheet",
  unitKind: "currency",
  unitLabel: "currency",
  standardSign: "positive",
};

const COMPANY = "11111111-1111-4111-8111-111111111111";
const DOCUMENT = "22222222-2222-4222-8222-222222222222";

describe("parseFigure", () => {
  it("reads a figure as it is printed", () => {
    expect(parseFigure("1234")).toEqual({ value: 1234, presentation: "plain" });
    expect(parseFigure("1,234,567")).toEqual({ value: 1234567, presentation: "plain" });
    expect(parseFigure("1 234 567")).toEqual({ value: 1234567, presentation: "plain" });
    expect(parseFigure("4.25")).toEqual({ value: 4.25, presentation: "plain" });
    expect(parseFigure("₦1,234")).toEqual({ value: 1234, presentation: "plain" });
  });

  /**
   * The whole reason the presentation is derived rather than selected: brackets
   * are how a filing says negative, and the analyst should not have to also tick
   * a box that could contradict what they typed.
   */
  it("reads accounting brackets as the negative they are", () => {
    expect(parseFigure("(1,234)")).toEqual({ value: 1234, presentation: "bracketed" });
    expect(parseFigure(" ( 1,234 ) ")).toEqual({ value: 1234, presentation: "bracketed" });
  });

  it("reads a leading minus as negative, and keeps the two distinguishable", () => {
    expect(parseFigure("-1,234")).toEqual({ value: -1234, presentation: "negative" });
    expect(parseFigure("+1,234")).toEqual({ value: 1234, presentation: "plain" });
  });

  it("refuses a bracketed minus, which is a double negative nobody means", () => {
    expect(parseFigure("(-1,234)")).toBeNull();
  });

  it("refuses what is not a figure", () => {
    for (const input of [
      "",
      "   ",
      "n/a",
      "1,234-",
      "1..2",
      "1,,234",
      ",234",
      "1,234,",
      "(1,234",
      "1,234)",
      "12 34.5.6",
      "1e9",
      "0x10",
      "revenue",
      "₦",
    ]) {
      expect(parseFigure(input), input).toBeNull();
    }
  });

  it("refuses a control character, however it arrived", () => {
    expect(parseFigure("1234\n")).toEqual({ value: 1234, presentation: "plain" });
    expect(parseFigure("12\u000034")).toBeNull();
  });

  it("refuses a figure beyond the precision a double can carry", () => {
    expect(parseFigure("1000000000000000000")).toBeNull();
  });
});

describe("standardisePreview", () => {
  it("scales money and leaves a ratio alone", () => {
    expect(
      standardisePreview({ value: 1000, presentation: "plain", magnitude: "thousands", standardSign: "positive" }),
    ).toBe(1_000_000);
    expect(
      standardisePreview({ value: 4.3, presentation: "plain", magnitude: "units", standardSign: "positive" }),
    ).toBe(4.3);
  });

  it("arrives at one value however the outflow was presented", () => {
    const plain = standardisePreview({
      value: 400,
      presentation: "plain",
      magnitude: "thousands",
      standardSign: "negative",
    });
    const bracketed = standardisePreview({
      value: 400,
      presentation: "bracketed",
      magnitude: "thousands",
      standardSign: "negative",
    });
    const typedNegative = standardisePreview({
      value: -400,
      presentation: "negative",
      magnitude: "thousands",
      standardSign: "negative",
    });
    expect(plain).toBe(-400_000);
    expect(bracketed).toBe(-400_000);
    expect(typedNegative).toBe(-400_000);
  });

  it("keeps a loss negative where the line is genuinely either", () => {
    expect(
      standardisePreview({ value: 150, presentation: "bracketed", magnitude: "millions", standardSign: "signed" }),
    ).toBe(-150_000_000);
  });

  it("refuses a negative figure on a line that cannot be negative", () => {
    expect(
      standardisePreview({ value: 1000, presentation: "bracketed", magnitude: "thousands", standardSign: "positive" }),
    ).toBeNull();
  });
});

describe("magnitudeApplies", () => {
  it("applies the statement's scale to money and to nothing else", () => {
    expect(magnitudeApplies("currency")).toBe(true);
    expect(magnitudeApplies("currency_per_unit")).toBe(true);
    for (const kind of ["per_share", "percent", "count", "quantity"] as const) {
      expect(magnitudeApplies(kind), kind).toBe(false);
    }
  });
});

describe("validateLine", () => {
  it("defaults money to the statement's scale and everything else to units", () => {
    const money = validateLine({ lineItem: "revenue", raw: "1,000", sourcePage: "40" }, REVENUE, "thousands");
    expect(money.ok && money.value.magnitude).toBe("thousands");
    expect(money.ok && money.value.standardised).toBe(1_000_000);

    const eps = validateLine({ lineItem: "earnings_per_share", raw: "4.25", sourcePage: "42" }, EPS, "thousands");
    expect(eps.ok && eps.value.magnitude).toBe("units");
    expect(eps.ok && eps.value.standardised).toBe(4.25);

    const ratio = validateLine({ lineItem: "npl_ratio", raw: "4.3", sourcePage: "90" }, NPL, "billions");
    expect(ratio.ok && ratio.value.standardised).toBe(4.3);
  });

  it("takes a per-line scale where a filing states subscribers in millions", () => {
    const line = validateLine(
      { lineItem: "revenue", raw: "77.5", magnitude: "millions", sourcePage: "12" },
      REVENUE,
      "thousands",
    );
    expect(line.ok && line.value.standardised).toBe(77_500_000);
  });

  it("insists on a page", () => {
    for (const page of ["", "0", "-1", "4.5", "page 7", "999999"]) {
      const line = validateLine({ lineItem: "revenue", raw: "1000", sourcePage: page }, REVENUE, "thousands");
      expect(line.ok, page).toBe(false);
      if (!line.ok) expect(line.error).toMatch(/page of the filing/);
    }
  });

  it("names the figure in the message, because an analyst is reading it", () => {
    const line = validateLine({ lineItem: "revenue", raw: "n/a", sourcePage: "40" }, REVENUE, "thousands");
    expect(line.ok).toBe(false);
    if (!line.ok) {
      expect(line.error).toMatch(/^Revenue: "n\/a" is not a figure/);
      expect(line.error).toMatch(/\(1,234\)/);
    }
  });

  it("refuses a line item that is not one we store", () => {
    const line = validateLine({ lineItem: "Revenue; drop table", raw: "1", sourcePage: "1" }, REVENUE, "units");
    expect(line.ok).toBe(false);
  });
});

describe("parsePeriod", () => {
  /**
   * Nigerian year-ends are mostly December, but Flour Mills reports to March.
   * Assuming a calendar year would store a period the filing does not cover.
   */
  it("derives a start twelve months before the reporting date", () => {
    expect(parsePeriod({ periodEnd: "2024-12-31" })).toEqual({
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
    });
    expect(parsePeriod({ periodEnd: "2024-03-31" })).toEqual({
      periodStart: "2023-04-01",
      periodEnd: "2024-03-31",
    });
  });

  it("takes an explicit start, and refuses one that is not earlier", () => {
    expect(parsePeriod({ periodEnd: "2024-12-31", periodStart: "2024-07-01" })).toEqual({
      periodStart: "2024-07-01",
      periodEnd: "2024-12-31",
    });
    expect(parsePeriod({ periodEnd: "2024-12-31", periodStart: "2024-12-31" })).toBeNull();
    expect(parsePeriod({ periodEnd: "2024-01-01", periodStart: "2024-12-31" })).toBeNull();
  });

  it("refuses a date the calendar does not have", () => {
    expect(parseIsoDate("2020-02-31")).toBeNull();
    expect(parseIsoDate("2021-02-29")).toBeNull();
    expect(parseIsoDate("2020-02-29")).toBe("2020-02-29");
    expect(parsePeriod({ periodEnd: "2024-13-01" })).toBeNull();
  });

  it("names a financial year by its reporting date", () => {
    expect(financialYearOf("2024-12-31")).toBe(2024);
    expect(financialYearOf("2024-03-31")).toBe(2024);
    expect(financialYearOf("not a date")).toBeNull();
  });
});

describe("validateStatement", () => {
  const definitions = [REVENUE, COST, PBT, PAT, EPS, ASSETS];

  function statement(overrides: Partial<Parameters<typeof validateStatement>[0]> = {}) {
    return validateStatement(
      {
        companyId: COMPANY,
        statementType: "income",
        periodType: "FY",
        periodEnd: "2024-12-31",
        audited: true,
        consolidated: true,
        currency: "NGN",
        magnitude: "thousands",
        documentId: DOCUMENT,
        lines: [
          { lineItem: "revenue", raw: "1,000", sourcePage: "40" },
          { lineItem: "profit_before_tax", raw: "300", sourcePage: "40" },
          { lineItem: "profit_after_tax", raw: "200", sourcePage: "40" },
        ],
        ...overrides,
      },
      definitions,
      ["revenue", "profit_before_tax", "profit_after_tax"],
    );
  }

  it("prepares the payload the database expects", () => {
    const result = statement();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.periodStart).toBe("2024-01-01");
    expect(result.value.currency).toBe("NGN");
    expect(result.value.restatementKind).toBeNull();
    expect(result.value.lines.map((l) => l.line_item)).toEqual([
      "revenue",
      "profit_before_tax",
      "profit_after_tax",
    ]);
  });

  it("ignores blank cells rather than storing zeroes", () => {
    const result = statement({
      lines: [
        { lineItem: "revenue", raw: "1,000", sourcePage: "40" },
        { lineItem: "cost_of_sales", raw: "   ", sourcePage: "" },
        { lineItem: "profit_before_tax", raw: "300", sourcePage: "40" },
        { lineItem: "profit_after_tax", raw: "200", sourcePage: "40" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.lines).toHaveLength(3);
  });

  it("refuses a statement missing a figure its template requires, and names it", () => {
    const result = statement({
      lines: [{ lineItem: "revenue", raw: "1,000", sourcePage: "40" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/missing figures the template requires/);
      expect(result.error).toMatch(/Profit before tax/);
      expect(result.error).toMatch(/Profit after tax/);
    }
  });

  it("refuses a balance-sheet figure inside an income statement", () => {
    const result = statement({
      lines: [
        { lineItem: "revenue", raw: "1,000", sourcePage: "40" },
        { lineItem: "profit_before_tax", raw: "300", sourcePage: "40" },
        { lineItem: "profit_after_tax", raw: "200", sourcePage: "40" },
        { lineItem: "total_assets", raw: "9,000", sourcePage: "60" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/belongs to the balance sheet/);
  });

  it("refuses a figure no template defines", () => {
    const result = statement({
      lines: [
        { lineItem: "revenue", raw: "1,000", sourcePage: "40" },
        { lineItem: "profit_before_tax", raw: "300", sourcePage: "40" },
        { lineItem: "profit_after_tax", raw: "200", sourcePage: "40" },
        { lineItem: "adjusted_underlying_profit", raw: "1", sourcePage: "4" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not part of this company's template/);
  });

  it("insists a correction says which kind it is and why", () => {
    const supersedes = "33333333-3333-4333-8333-333333333333";
    const unnamed = statement({ supersedesId: supersedes });
    expect(unnamed.ok).toBe(false);
    if (!unnamed.ok) expect(unnamed.error).toMatch(/issuer restated these figures, or we are correcting/);

    const unexplained = statement({ supersedesId: supersedes, restatementKind: "sfi_correction" });
    expect(unexplained.ok).toBe(false);
    if (!unexplained.ok) expect(unexplained.error).toMatch(/Say why the figures are changing/);

    const complete = statement({
      supersedesId: supersedes,
      restatementKind: "issuer_restated",
      correctionReason: "Restated in the following year's report.",
    });
    expect(complete.ok).toBe(true);
  });

  it("refuses a restatement kind on a first entry", () => {
    const result = statement({ restatementKind: "issuer_restated" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/first entry is the original reading/);
  });

  it("needs a company, a filing, a period and a scale", () => {
    expect(statement({ companyId: "not-a-uuid" }).ok).toBe(false);
    expect(statement({ documentId: "" }).ok).toBe(false);
    expect(statement({ periodEnd: "" }).ok).toBe(false);
    expect(statement({ magnitude: "zillions" }).ok).toBe(false);
    expect(statement({ currency: "naira" }).ok).toBe(false);
    expect(statement({ statementType: "guesswork" }).ok).toBe(false);
    expect(statement({ periodType: "FY2024" }).ok).toBe(false);
  });

  it("uppercases the currency, so NGN and ngn are one currency", () => {
    const result = statement({ currency: "usd" });
    expect(result.ok && result.value.currency).toBe("USD");
  });
});

describe("validateTemplateAssignment", () => {
  it("needs a company, a template and a date", () => {
    expect(
      validateTemplateAssignment({ companyId: COMPANY, templateId: "bank", validFrom: "2015-01-01" }).ok,
    ).toBe(true);
    expect(validateTemplateAssignment({ companyId: "x", templateId: "bank", validFrom: "2015-01-01" }).ok).toBe(false);
    expect(
      validateTemplateAssignment({ companyId: COMPANY, templateId: "Bank; drop", validFrom: "2015-01-01" }).ok,
    ).toBe(false);
    expect(validateTemplateAssignment({ companyId: COMPANY, templateId: "bank", validFrom: "2015" }).ok).toBe(false);
  });
});

describe("footingWarnings", () => {
  function line(item: string, standardised: number): PreparedLine {
    return {
      line_item: item,
      value_reported: standardised,
      presentation: "plain",
      magnitude: "units",
      source_page: 1,
      as_restated: false,
      ai_assisted: false,
      note: null,
      standardised,
    };
  }

  it("says nothing when a balance sheet foots", () => {
    expect(
      footingWarnings("balance_sheet", [
        line("total_assets", 9000),
        line("total_liabilities", 7000),
        line("shareholders_equity", 2000),
      ]),
    ).toEqual([]);
  });

  it("warns when it does not, and still returns a warning rather than refusing", () => {
    const warnings = footingWarnings("balance_sheet", [
      line("total_assets", 9000),
      line("total_liabilities", 7000),
      line("shareholders_equity", 2500),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/do not equal total liabilities plus equity/);
    // The wording has to leave the analyst free to record what the page says.
    expect(warnings[0].message).toMatch(/record it as it reads/);
  });

  it("tolerates the rounding a published statement carries", () => {
    expect(
      footingWarnings("balance_sheet", [
        line("total_assets", 9001),
        line("total_liabilities", 7000),
        line("shareholders_equity", 2000),
      ]),
    ).toEqual([]);
  });

  it("checks an income statement as a sum, because costs are stored negative", () => {
    expect(
      footingWarnings("income", [line("revenue", 1000), line("cost_of_sales", -600), line("gross_profit", 400)]),
    ).toEqual([]);
    const warnings = footingWarnings("income", [
      line("revenue", 1000),
      line("cost_of_sales", -600),
      line("gross_profit", 1600),
    ]);
    expect(warnings.some((w) => /Gross profit does not equal/.test(w.message))).toBe(true);
  });

  it("notices a profit bigger than revenue without calling it an error", () => {
    const warnings = footingWarnings("income", [line("revenue", 100), line("profit_after_tax", 900)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/That does happen/);
  });

  it("says nothing about an operating metric, which has nothing to foot", () => {
    expect(footingWarnings("operating", [line("npl_ratio", 4.3)])).toEqual([]);
  });
});

describe("formatReported", () => {
  it("shows a figure in the scale the filing used", () => {
    expect(formatReported(1234, "thousands", "currency")).toBe("1,234 thousands");
    expect(formatReported(4.3, "units", "%")).toBe("4.3%");
    expect(formatReported(77.5, "millions", "subscribers")).toBe("77.5 millions subscribers");
    expect(formatReported(4.25, "units", "per share")).toBe("4.25 per share");
  });
});
