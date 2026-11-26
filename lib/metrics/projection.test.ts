import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The ratios on a company page come from the database, and from nowhere else.
 *
 * This is the stage 3c lesson made structural. There, two pieces of code
 * computed the same figure and drifted. Here the arithmetic lives in one view,
 * so the only way to reintroduce the problem is for TypeScript to start doing
 * sums on the values it was handed — and that is what these tests watch for.
 *
 * Scanning the source rather than the output, because a page with no figures
 * yet looks identical either way, and the fault would be invisible until the
 * first company had five years of data.
 */

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const DATA = source("../data/metrics.ts");

describe("where a ratio comes from", () => {
  it("reads values from company_metric_values and inputs from company_metric_inputs", () => {
    expect(DATA).toContain('.from("company_metric_values")');
    expect(DATA).toContain('.from("company_metric_inputs")');
  });

  it("reads figures from no other table that could hold a second answer", () => {
    // financial_statement_lines is the figures desk's table. A ratio assembled
    // from it here would be a second implementation of the arithmetic, which is
    // exactly what the view exists to prevent.
    expect(DATA).not.toContain('.from("financial_statement_lines")');
    expect(DATA).not.toContain('.from("financial_statements")');
  });

  it("asks the status view, not the definitions table, for what a reader may see of a proposal", () => {
    expect(DATA).toContain('.from("metric_definition_status")');
  });
});

describe("no arithmetic in TypeScript", () => {
  const modules = [
    ["lib/data/metrics.ts", DATA],
    ["lib/metrics/definitions.ts", source("./definitions.ts")],
  ] as const;

  it("never divides, multiplies or sums a value it was handed", () => {
    // Deliberately crude: any operator applied to something named like a figure
    // is a finding, and a false positive is cheap to rename around. The rule it
    // protects is worth more than the elegance of the check.
    const arithmetic =
      /\b(value|values|valueStandardised|valueReported|numerator|denominator|contribution)\b\s*[*/+-]|[*/+-]\s*\b(value|valueStandardised|valueReported|numerator|denominator|contribution)\b/;
    for (const [name, text] of modules) {
      const offending = text
        .split("\n")
        .map((line, index) => [index + 1, line] as const)
        // Comments explain the rule; they are allowed to mention it.
        .filter(([, line]) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
        .filter(([, line]) => arithmetic.test(line));
      expect(offending, `${name} does arithmetic on a figure`).toEqual([]);
    }
  });

  it("formats values without rescaling them", () => {
    // toFixed and Intl both round for display and change nothing else. A
    // division by 100 or 1,000 here would silently restate a figure.
    const definitions = source("./definitions.ts");
    expect(definitions).toContain("toFixed(decimals)");
    expect(definitions).not.toMatch(/\/\s*100\b/);
    expect(definitions).not.toMatch(/\/\s*1000\b/);
  });
});
