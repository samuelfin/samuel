import { describe, expect, it } from "vitest";
import {
  formatMetricValue,
  formulaText,
  reasonText,
  REASON_TAGS,
  UNAVAILABLE_REASONS,
  type MetricInput,
  type MetricKind,
} from "./definitions";

/**
 * The formula a reader is shown is built from the same declared inputs the
 * database divides. It is not stored as text anywhere, and these tests exist to
 * keep it that way: if the rendering and the arithmetic ever drift, a reader is
 * being told one thing while being shown the result of another.
 */

function input(
  role: MetricInput["role"],
  label: string,
  opts: { sign?: 1 | -1; abs?: boolean; order?: number } = {},
): MetricInput {
  return {
    role,
    lineItem: label.toLowerCase().replace(/[^a-z]+/g, "_"),
    label,
    sign: opts.sign ?? 1,
    useAbsolute: opts.abs ?? false,
    sortOrder: opts.order ?? 10,
  };
}

function text(kind: MetricKind, inputs: MetricInput[], windowYears: number | null = null): string {
  return formulaText({ kind, windowYears, inputs });
}

describe("rendering a formula", () => {
  it("divides a margin", () => {
    expect(text("margin", [input("numerator", "Profit after tax"), input("denominator", "Revenue")])).toBe(
      "Profit after tax ÷ Revenue",
    );
  });

  it("divides a ratio the same way, because only the unit differs", () => {
    expect(text("ratio", [input("numerator", "Total borrowings"), input("denominator", "Shareholders' equity")])).toBe(
      "Total borrowings ÷ Shareholders' equity",
    );
  });

  it("says which side is averaged", () => {
    expect(
      text("average_ratio", [input("numerator", "Profit after tax"), input("denominator", "Total assets")]),
    ).toBe("Profit after tax ÷ average total assets, opening and closing");
  });

  it("names the base twice in a growth, because that is what the sum does", () => {
    expect(text("growth", [input("base", "Revenue")])).toBe(
      "(Revenue this year − Revenue last year) ÷ Revenue last year",
    );
  });

  it("names both endpoints of a compound rate, because both are required", () => {
    // A five-year rate spans four years of compounding, and it is measured
    // between those two years alone. Saying "compounded over 5 years" left it
    // possible to read a rate measured over two years as one measured over
    // five, which is what the formula now refuses to describe.
    expect(text("cagr", [input("base", "Revenue")], 5)).toBe(
      "Revenue now against revenue 4 financial years earlier, as an annual compound rate",
    );
    expect(text("cagr", [input("base", "Profit after tax")], 3)).toBe(
      "Profit after tax now against profit after tax 2 financial years earlier, as an annual compound rate",
    );
  });

  it("adds the parts of a sum in their declared order", () => {
    expect(
      text("sum", [
        input("numerator", "Net cash from operations", { order: 10 }),
        input("numerator", "Capital expenditure", { order: 20 }),
      ]),
    ).toBe("Net cash from operations + Capital expenditure");
  });

  it("subtracts a negatively signed input", () => {
    expect(
      text("margin", [
        input("numerator", "Gross loans and advances", { order: 10 }),
        input("numerator", "Loans and advances (net)", { sign: -1, order: 20 }),
        input("denominator", "Non-performing loans"),
      ]),
    ).toBe("Gross loans and advances − Loans and advances (net) ÷ Non-performing loans");
  });

  it("says when a figure is taken at its size, not its sign", () => {
    // 3c stores finance costs negative. Interest cover divides by how large they
    // are, and a reader who is not told that would read the formula as producing
    // a negative multiple.
    expect(
      text("ratio", [
        input("numerator", "Operating profit"),
        input("denominator", "Finance costs", { abs: true }),
      ]),
    ).toBe("Operating profit ÷ the size of finance costs");
  });
});

describe("why there is no number", () => {
  it("names the figures it is waiting for", () => {
    expect(
      reasonText("input_missing", {
        missingLabels: ["Operating expenses", "Total operating income"],
      }),
    ).toBe("Not available: waiting for Operating expenses and Total operating income, entered from the filing.");
    expect(reasonText("input_missing", { missingLabels: ["Net debt"] })).toBe(
      "Not available: waiting for Net debt, entered from the filing.",
    );
    expect(
      reasonText("input_missing", { missingLabels: ["Revenue", "Gross profit", "EBITDA"] }),
    ).toBe("Not available: waiting for Revenue, Gross profit and EBITDA, entered from the filing.");
  });

  it("says nothing is missing where nothing is", () => {
    // A first year has no opening balance. Nobody has failed to enter anything,
    // and telling a reader to wait for a figure would send them looking for one
    // that does not exist.
    expect(reasonText("no_prior_period", { kind: "average_ratio" })).toMatch(/no opening balance to average/);
    expect(reasonText("no_prior_period", { kind: "growth" })).toMatch(/nothing to measure the change against/);
  });

  it("states the window a compound rate needs", () => {
    expect(reasonText("insufficient_history", { kind: "cagr", windowYears: 5 })).toBe(
      "Not available: a 5-year rate is measured against the year 4 years earlier, which is not held.",
    );
  });

  it("distinguishes a figure we may not use from one we do not have", () => {
    expect(reasonText("currency_mismatch")).toMatch(/another currency/);
    expect(reasonText("basis_mismatch")).toMatch(/company-only/);
  });

  it("explains a refusal to divide by a loss in the terms of the shape", () => {
    expect(reasonText("not_applicable", { kind: "growth" })).toMatch(/previous year was a loss/);
    expect(reasonText("not_applicable", { kind: "cagr" })).toMatch(/both years to be positive/);
    expect(reasonText("not_applicable", { kind: "margin" })).toMatch(/divides by is negative/);
    expect(reasonText("denominator_zero")).toMatch(/is zero/);
  });

  it("covers every reason the database can give", () => {
    for (const reason of UNAVAILABLE_REASONS) {
      expect(reasonText(reason)).toMatch(/^Not available: /);
    }
  });
});

describe("showing a value", () => {
  it("formats a percentage and a multiple to the definition's decimals", () => {
    expect(formatMetricValue("31.753677", "percent", 1)).toBe("31.8%");
    expect(formatMetricValue("0.607681", "times", 2)).toBe("0.61×");
    expect(formatMetricValue(-20, "percent", 1)).toBe("-20.0%");
  });

  it("keeps a currency sum in the filing's own currency", () => {
    expect(formatMetricValue("300000000", "currency", 0, "NGN")).toBe("NGN 300,000,000");
    expect(formatMetricValue("300000000", "currency", 0, "USD")).toBe("USD 300,000,000");
  });

  it("shows a dash where there is no value, never a zero", () => {
    // The reason is shown beside it. A zero here would be a figure nobody
    // reported and nothing computed.
    expect(formatMetricValue(null, "percent", 1)).toBe("—");
    expect(formatMetricValue(undefined, "times", 2)).toBe("—");
    expect(formatMetricValue("", "percent", 1)).toBe("—");
    expect(formatMetricValue("not a number", "percent", 1)).toBe("—");
  });
});

describe("the short form of a reason", () => {
  it("has plain words for every reason, and none of them is blank", () => {
    for (const reason of UNAVAILABLE_REASONS) {
      expect(REASON_TAGS[reason]).toMatch(/^[A-Z][a-z]/);
      expect(REASON_TAGS[reason].length).toBeGreaterThan(5);
    }
    // The one a reader can act on reads as the rest of the platform reads it.
    expect(REASON_TAGS.input_missing).toBe("Pending verification");
  });
});
