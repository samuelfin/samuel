import { describe, expect, it } from "vitest";
import { formulaText, type MetricInput, type MetricKind } from "./definitions";

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

  it("states the window of a compound rate", () => {
    expect(text("cagr", [input("base", "Revenue")], 5)).toBe("Revenue, compounded over 5 years");
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
