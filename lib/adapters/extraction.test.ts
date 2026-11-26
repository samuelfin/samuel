import { afterEach, describe, expect, it } from "vitest";
import {
  availableExtractors,
  extractionEnabled,
  getExtractor,
  manualPasteExtractor,
} from "./extraction";

/**
 * The extractor's job is to propose, and these tests are mostly about what it
 * refuses to propose.
 *
 * A suggestion queue that is incomplete costs an analyst some typing. One that
 * is confidently wrong costs the register its accuracy, because a reviewer
 * reading a plausible label beside a plausible figure is exactly the person who
 * would wave it through. So every ambiguity goes to `unmatched`.
 */

const ALLOWED = [
  { lineItem: "revenue", label: "Revenue" },
  { lineItem: "cost_of_sales", label: "Cost of sales" },
  { lineItem: "profit_after_tax", label: "Profit after tax" },
  { lineItem: "total_subscribers", label: "Total subscribers" },
];

async function extract(text: string) {
  return manualPasteExtractor.extract({ documentId: "doc", text, allowedLineItems: ALLOWED });
}

afterEach(() => {
  delete process.env.SFI_EXTRACTION_DISABLED;
});

describe("the pasted-text extractor", () => {
  it("is recorded as what it is, with no model", () => {
    expect(manualPasteExtractor.id).toBe("manual_paste");
    expect(manualPasteExtractor.model).toBeNull();
    expect(manualPasteExtractor.promptVersion).toBeNull();
    // The provider column constrains the id to lowercase with underscores.
    expect(manualPasteExtractor.id).toMatch(/^[a-z][a-z0-9_]{1,47}$/);
  });

  it("reads a table row as a label, a figure and a page", async () => {
    const result = await extract("Revenue 1,234,567 p.40");
    expect(result.unmatched).toEqual([]);
    expect(result.figures).toHaveLength(1);
    expect(result.figures[0]).toMatchObject({
      lineItem: "revenue",
      valueReported: 1234567,
      presentation: "plain",
      sourcePage: 40,
      rawLabel: "Revenue",
      rawValue: "1,234,567",
    });
  });

  it("keeps the figure verbatim as well as parsed", async () => {
    const result = await extract("Cost of sales (400,000) page 41");
    expect(result.figures[0]).toMatchObject({
      lineItem: "cost_of_sales",
      valueReported: 400000,
      presentation: "bracketed",
      rawValue: "(400,000)",
    });
  });

  it("reads a scale word as the figure's own scale", async () => {
    const result = await extract("Total subscribers 77.5 million p.12");
    expect(result.figures[0]).toMatchObject({
      lineItem: "total_subscribers",
      valueReported: 77.5,
      magnitude: "millions",
      sourcePage: 12,
    });
  });

  it("accepts the line item's code as a label", async () => {
    const result = await extract("profit_after_tax 200,000 p.40");
    expect(result.figures[0].lineItem).toBe("profit_after_tax");
  });

  it("proposes nothing for a figure with no page", async () => {
    const result = await extract("Revenue 1,234,567");
    expect(result.figures).toEqual([]);
    expect(result.unmatched).toEqual(["Revenue 1,234,567"]);
  });

  /**
   * The refusal that matters most. "Turnover" is revenue in most filings, and an
   * extractor that guessed would be right often enough to be trusted and wrong
   * often enough to matter.
   */
  it("refuses a label it does not recognise rather than guessing the nearest", async () => {
    const result = await extract("Turnover 1,234,567 p.40");
    expect(result.figures).toEqual([]);
    expect(result.unmatched).toEqual(["Turnover 1,234,567 p.40"]);
  });

  it("refuses a label two catalogue lines share", async () => {
    const ambiguous = [
      { lineItem: "revenue", label: "Revenue" },
      { lineItem: "service_revenue", label: "Revenue" },
    ];
    const result = await manualPasteExtractor.extract({
      documentId: "doc",
      text: "Revenue 1,000 p.40",
      allowedLineItems: ambiguous,
    });
    expect(result.figures).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });

  it("proposes a figure once, and sends the repeat to unmatched", async () => {
    const result = await extract("Revenue 1,000 p.40\nRevenue 2,000 p.41");
    expect(result.figures).toHaveLength(1);
    expect(result.figures[0].valueReported).toBe(1000);
    expect(result.unmatched).toEqual(["Revenue 2,000 p.41"]);
  });

  it("reports no confidence rather than inventing one", async () => {
    const result = await extract("Revenue 1,000 p.40");
    // A string comparison dressed up as a judgement would be worse than silence.
    expect(result.figures[0].confidence).toBeNull();
  });

  it("skips blank lines and prose without a figure", async () => {
    const result = await extract("\n  \nNotes to the financial statements\nRevenue 1,000 p.40\n");
    expect(result.figures).toHaveLength(1);
    expect(result.unmatched).toEqual(["Notes to the financial statements"]);
  });

  /**
   * A table row is a label, a figure and a page. A paste that lost its newlines
   * is not one, and the figure match walks each line more than once — the first
   * version of that pattern took 17 seconds to fail on a 20,000-character line
   * and about two minutes on 100,000. Set aside before matching now, and the
   * pattern's repeats are bounded as well, so neither half depends on the other.
   */
  it("sets aside a line too long to be one row, quickly", async () => {
    const long = `Revenue ${"1 ".repeat(60_000)}x`;
    const started = Date.now();
    const result = await extract(long);
    const elapsed = Date.now() - started;

    expect(result.figures).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]).toMatch(/\(too long to read as one figure\)$/);
    // Generous enough not to be flaky on a loaded machine, and still three
    // orders of magnitude under what the unbounded pattern took.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("still reads a long but reasonable line", async () => {
    const label = "Revenue";
    const padded = `${label}${" ".repeat(200)}1,234,567 p.40`;
    const result = await extract(padded);
    expect(result.figures).toHaveLength(1);
    expect(result.figures[0]).toMatchObject({ lineItem: "revenue", valueReported: 1234567, sourcePage: 40 });
  });

  it("does not take a page number as the figure", async () => {
    const result = await extract("Revenue p.40 1,000");
    expect(result.figures[0]).toMatchObject({ valueReported: 1000, sourcePage: 40 });
  });
});

describe("the kill switch", () => {
  it("is on by default and turns the feature off without a deployment", () => {
    expect(extractionEnabled()).toBe(true);
    expect(availableExtractors().map((e) => e.id)).toEqual(["manual_paste"]);
    expect(getExtractor("manual_paste")).not.toBeNull();

    process.env.SFI_EXTRACTION_DISABLED = "1";
    expect(extractionEnabled()).toBe(false);
    expect(availableExtractors()).toEqual([]);
    // The lookup refuses too, so an action holding an id cannot route around it.
    expect(getExtractor("manual_paste")).toBeNull();
  });

  it("knows no extractor it was not given", () => {
    expect(getExtractor("some_model_we_never_bought")).toBeNull();
  });

  /**
   * A bare object index answers `__proto__` with something truthy that is not an
   * extractor, and the caller then throws instead of saying the id is unknown.
   */
  it("is not fooled by a name from the prototype chain", () => {
    for (const id of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect(getExtractor(id), id).toBeNull();
    }
  });
});
