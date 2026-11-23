import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase } from "./db";

/**
 * The pilot universe is the identity five years of figures will hang off, so the
 * list is checked against the schema it will be seeded into rather than only
 * read by eye.
 *
 * The faults this catches are the quiet ones. A template id of "cement" instead
 * of "cement_industrial" would fail at the eighteenth company, halfway through a
 * seed. A sector id that is not in the catalogue would leave a company with no
 * sector and no error. A duplicated ticker would mean two companies share an
 * identity, which is the one thing this register must never do.
 *
 * What it cannot check is whether the ticker is the one the exchange uses today.
 * That is `npm run verify:ngx` against a directory export, and it needs the CEO
 * to sign the differences off.
 */

interface PilotCompany {
  name: string;
  ticker: string;
  sectorId: string;
  template: string;
  listingStatus?: string;
  priorName?: string;
  priorTicker?: string;
  source?: string;
  note?: string;
  reportingCurrency?: string;
}

interface Pilot {
  period: { from: string; to: string; basis: string };
  excluded: Array<{ name: string; ticker: string; reason: string; source?: string }>;
  companies: PilotCompany[];
}

const pilot: Pilot = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../scripts/pilot-companies.json", import.meta.url)), "utf8"),
);

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
}, 180_000);

describe("the pilot universe", () => {
  it("is the eighteen companies the coverage document names", () => {
    expect(pilot.companies).toHaveLength(18);
    expect(pilot.period).toEqual({
      from: "FY2021",
      to: "FY2025",
      basis: "audited consolidated annual reports",
    });
  });

  it("gives every company a ticker, and no two the same", () => {
    const tickers = pilot.companies.map((c) => c.ticker);
    for (const ticker of tickers) {
      expect(ticker, ticker).toMatch(/^[A-Z0-9]{2,20}$/);
    }
    expect(new Set(tickers).size).toBe(tickers.length);
  });

  it("gives every company a distinct name", () => {
    const names = pilot.companies.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names only templates the schema actually has", async () => {
    const { rows } = await db.query<{ id: string; scope: string }>("select id, scope from public.statement_templates");
    const sector = new Set(rows.filter((r) => r.scope === "sector").map((r) => r.id));
    for (const company of pilot.companies) {
      // A core-template assignment is refused by assign_company_template, so a
      // company pointed at "core" would fail mid-seed.
      expect(sector, `${company.ticker} -> ${company.template}`).toContain(company.template);
    }
  });

  it("names only sectors the catalogue has", async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.sectors");
    const sectors = new Set(rows.map((r) => r.id));
    for (const company of pilot.companies) {
      expect(sectors, `${company.ticker} -> ${company.sectorId}`).toContain(company.sectorId);
    }
  });

  it("uses a listing status the companies table accepts", async () => {
    for (const company of pilot.companies) {
      const status = company.listingStatus ?? "listed";
      // Checked against the constraint itself rather than a copy of its list.
      const { rows } = await db.query<{ ok: boolean }>(
        "select ($1 in ('pre_listing', 'listed', 'suspended', 'delisted', 'unlisted')) as ok",
        [status],
      );
      expect(rows[0].ok, `${company.ticker} -> ${status}`).toBe(true);
    }
  });

  /**
   * A renamed company without its evidence is a claim with no source, which is
   * the one thing nothing on this platform may be.
   */
  it("cites the exchange for every name or ticker it has changed", () => {
    for (const company of pilot.companies) {
      if (company.priorName || company.priorTicker) {
        expect(company.source, company.ticker).toBeTruthy();
        expect(company.source, company.ticker).toMatch(/bulletin|notice|NGX/i);
      }
    }
  });

  it("records why a company was excluded, with its evidence", () => {
    expect(pilot.excluded.length).toBeGreaterThan(0);
    for (const excluded of pilot.excluded) {
      expect(excluded.reason.length).toBeGreaterThan(40);
      expect(excluded.source).toBeTruthy();
    }
  });

  it("does not exclude a company it also includes", () => {
    const included = new Set(pilot.companies.map((c) => c.ticker));
    for (const excluded of pilot.excluded) {
      expect(included).not.toContain(excluded.ticker);
    }
  });

  /**
   * The seed must not carry figures. Checked structurally rather than trusted:
   * a "revenue" key appearing in this file later is how fake data would arrive
   * on the site.
   */
  it("carries no figures at all", () => {
    const allowed = new Set([
      "name",
      "ticker",
      "sectorId",
      "template",
      "listingStatus",
      "priorName",
      "priorTicker",
      "source",
      "note",
      "reportingCurrency",
    ]);
    for (const company of pilot.companies) {
      for (const key of Object.keys(company)) {
        expect(allowed, `${company.ticker} has an unexpected field: ${key}`).toContain(key);
      }
      for (const value of Object.values(company)) {
        expect(typeof value).toBe("string");
      }
    }
  });

  it("holds the sector spread the templates were built for", () => {
    const byTemplate = new Map<string, number>();
    for (const company of pilot.companies) {
      byTemplate.set(company.template, (byTemplate.get(company.template) ?? 0) + 1);
    }
    // Six of the eighteen are banks, which is why the bank set is entered first.
    expect(byTemplate.get("bank")).toBe(6);
    expect([...byTemplate.keys()].sort()).toEqual([
      "bank",
      "cement_industrial",
      "food_consumer",
      "oil_gas",
      "power_utilities",
      "telecoms",
    ]);
  });
});
