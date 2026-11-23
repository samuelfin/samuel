import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The reader's projection must stay narrower than the desk's.
 *
 * Two different reasons, both easy to undo by accident. Selecting the review
 * columns would ship who entered a statement, who checked it and whether they
 * were the same person into the payload of every company page view — and
 * row-level security lets a reader see an approved row, so those columns would
 * come back populated rather than empty. And a wider projection is the cheapest
 * mistake in the data layer: one `*` and the page carries the desk's whole
 * working record.
 *
 * Scanning the source rather than the result because the fault is in the query,
 * and a query with no rows yet looks identical either way.
 */

const SOURCE = readFileSync(fileURLToPath(new URL("../data/financials.ts", import.meta.url)), "utf8");

function projection(name: string): string {
  const match = new RegExp(`const ${name} =([\\s\\S]*?);\\n`).exec(SOURCE);
  if (!match) throw new Error(`Could not find the ${name} projection`);
  // Concatenated string literals, as the module writes them.
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
}

describe("the reader's statement projection", () => {
  const reader = projection("READER_STATEMENT_COLUMNS");

  it("leaves the desk's working record to the desk", () => {
    for (const column of [
      "review_status",
      "review_self_approved",
      "reviewed_at",
      "reviewed_by",
      "entered_by",
      "template_id",
      "supersedes_id",
      "source_record_id",
    ]) {
      expect(reader, column).not.toContain(column);
    }
  });

  it("never selects everything", () => {
    expect(reader).not.toContain("*");
  });

  it("still carries what a reader needs to check a figure", () => {
    // The page citation is the whole point: a figure a reader cannot trace is
    // not publishable.
    for (const column of [
      "source_page",
      "value_reported",
      "value_standardised",
      "reported_magnitude",
      "currency",
      "audited",
      "consolidated",
      "period_end",
      "restatement_kind",
      "ai_assisted",
    ]) {
      expect(reader, column).toContain(column);
    }
  });

  it("links the issuer's own copy, not SFI's stored object", () => {
    // source_uri is the issuer's published URL. storage_path is the licensed
    // file behind a signed URL, and a reader page must never reference it.
    expect(reader).toContain("source_uri");
    expect(reader).not.toContain("storage_path");
  });

  it("is narrower than the desk's", () => {
    const desk = projection("STATEMENT_COLUMNS");
    expect(desk.length).toBeGreaterThan(reader.length);
    expect(desk).toContain("review_self_approved");
  });
});
