import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A download must not be a way around the page.
 *
 * Every figure on this platform displays only while a licence permits the
 * dataset it came through, and that gate lives in row-level security. A file
 * assembled with the service role would read straight past it and hand a reader
 * figures the screen refuses them — a licence breach in the shape of a feature.
 *
 * So the workbook and the printable page read through the reader's own loaders,
 * and these tests hold that shut by reading the source. The database half is
 * proved in supabase/tests/metric-calculation.test.ts, where switching the
 * dataset off empties the views these loaders select from.
 */

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const ASSEMBLER = source("../../app/(terminal)/companies/[slug]/five-year/data.ts");
const ROUTE = source("../../app/(terminal)/companies/[slug]/five-year.xlsx/route.ts");
const PRINT = source("../../app/(terminal)/companies/[slug]/five-year/page.tsx");

describe("what the download is allowed to read with", () => {
  it("never reaches for the service role", () => {
    for (const [name, text] of [
      ["the assembler", ASSEMBLER],
      ["the route", ROUTE],
      ["the printable page", PRINT],
    ] as const) {
      expect(text, name).not.toContain("createAdminClient");
      expect(text, name).not.toContain("SUPABASE_SECRET_KEY");
      expect(text, name).not.toContain("service_role");
    }
  });

  it("reads the same loaders the company page reads", () => {
    expect(ASSEMBLER).toContain("listFinancialsForCompany");
    expect(ASSEMBLER).toContain("listCompanyMetrics");
    expect(ASSEMBLER).toContain("listMetricDefinitions");
  });

  it("goes nowhere near the figures tables directly", () => {
    // A download that assembled its own query could forget the approved filter,
    // the company filter or the licence gate that the views apply for it.
    expect(ASSEMBLER).not.toContain("financial_statement_lines");
    expect(ASSEMBLER).not.toContain('from("financial_statements")');
    expect(ASSEMBLER).not.toContain("createClient");
  });

  it("resolves the company the way the tabs do, so an unapproved one 404s", () => {
    expect(ROUTE).toContain("companyForTab");
    expect(PRINT).toContain("companyForTab");
  });
});

describe("what the file tells the browser", () => {
  it("is sent as a workbook, with a filename, and is never cached", () => {
    expect(ROUTE).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(ROUTE).toContain("content-disposition");
    expect(ROUTE).toContain("fiveYearFilename");
    // A figure can be corrected and a licence withdrawn; a cached workbook
    // would outlive both.
    expect(ROUTE).toContain("no-store");
  });
});

describe("one assembler, two renderings", () => {
  it("builds the printable page from the same sheets as the workbook", () => {
    expect(PRINT).toContain("fiveYearWorkbook");
    expect(ROUTE).toContain("fiveYearWorkbook");
    expect(ASSEMBLER).toContain("fiveYearSheets");
    // Neither the page nor the route builds sheets of its own.
    expect(PRINT).not.toContain("fiveYearSheets");
    expect(ROUTE).not.toContain("fiveYearSheets");
  });
});
