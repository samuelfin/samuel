import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createSourceRecord, createTestDatabase, createUser, expectSqlError, migrationFiles } from "./db";
import { DATASETS, PROVIDERS } from "@/lib/providers/registry";
import { INDICATORS } from "@/lib/catalog/indicators";
import { NGX_SECTORS } from "@/lib/catalog/markets";

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

async function addEconomicObservation(opts: { period: [string, string]; value: string; version?: number; supersedes?: number; reason?: string; source?: string }) {
  const source = opts.source ?? (await createSourceRecord(db, "economy.observations"));
  const { rows } = await db.query<{ id: number }>(
    `insert into public.economic_observations
       (series_id, period_start, period_end, value, published_at, source_record_id, version, supersedes_id, correction_reason)
     values ('cpi-headline-yoy', $1, $2, $3, now(), $4, $5, $6, $7) returning id`,
    [opts.period[0], opts.period[1], opts.value, source, opts.version ?? 1, opts.supersedes ?? null, opts.reason ?? null],
  );
  return Number(rows[0].id);
}

async function setReview(table: string, id: number | string, status: string) {
  await db.query(`update public.${table} set review_status = $1, reviewed_at = now() where id = $2`, [status, id]);
}

async function createActiveLicence(provider: string) {
  const { rows } = await db.query<{ id: string }>(
    "insert into public.data_licences (provider_id, product, status, allows_display) values ($1, 'Test terms', 'active', true) returning id",
    [provider],
  );
  return rows[0].id;
}

describe("migrations", () => {
  it("apply cleanly in order", () => {
    expect(migrationFiles()).toEqual([
      "202611170001_initial_access_control.sql",
      "202611180001_data_foundation.sql",
      "202611180002_storage_object_policies.sql",
      "202611180003_retire_sfi_editorial_datasets.sql",
      "202611180004_platform_staff.sql",
      "202611180005_document_review.sql",
      "202611180006_record_uploaded_document.sql",
      "202611180007_review_self_approval.sql",
      "202611180008_review_hardening.sql",
      "202611190001_announcements.sql",
      "202611200001_editorial.sql",
      "202611200002_editorial_hardening.sql",
      "202611200003_company_profiles.sql",
      "202611200004_announcement_self_review_polarity.sql",
      "202611210001_company_slug_redirect.sql",
    ]);
  });
});

describe("seeded registry stays in sync with the application", () => {
  it("providers match lib/providers/registry.ts", async () => {
    const { rows } = await db.query<{ id: string; short_name: string; access_model: string; rights_status: string }>(
      "select id, short_name, access_model, rights_status from public.data_providers order by id",
    );
    const expected = Object.values(PROVIDERS)
      .map((p) => ({ id: p.id, short_name: p.shortName, access_model: p.access, rights_status: p.rights }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(rows).toEqual(expected);
  });

  it("datasets match the registry and all start inactive", async () => {
    const { rows } = await db.query<{ id: string; provider_id: string; is_active: boolean }>("select id, provider_id, is_active from public.datasets");
    expect(Object.fromEntries(rows.map((r) => [r.id, r.provider_id]))).toEqual(DATASETS);
    expect(rows.every((r) => !r.is_active)).toBe(true);
  });

  it("economic series match lib/catalog/indicators.ts", async () => {
    const { rows } = await db.query<{ id: string; provider_id: string; unit: string; magnitude: string; frequency: string; name: string }>(
      "select id, provider_id, unit, magnitude, frequency, name from public.economic_series order by id",
    );
    const expected = INDICATORS.map((i) => ({ id: i.id, provider_id: i.source, unit: i.unit, magnitude: i.magnitude ?? "units", frequency: i.frequency, name: i.name })).sort((a, b) => a.id.localeCompare(b.id));
    expect(rows).toEqual(expected);
  });

  it("sectors match the NGX classification", async () => {
    const { rows } = await db.query<{ name: string }>("select name from public.sectors order by name");
    expect(rows.map((r) => r.name)).toEqual([...NGX_SECTORS].sort((a, b) => a.localeCompare(b)));
  });
});

describe("dataset activation requires a licence basis", () => {
  it("refuses to activate a provider dataset without an active display licence", async () => {
    const error = await expectSqlError(db.query("update public.datasets set is_active = true where id = 'equities.prices'"));
    expect(error.message).toMatch(/cannot be activated without an active licence/);
  });

  it("refuses a licence that does not permit display, or has expired", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.data_licences (provider_id, product, status, allows_display) values ('ngx', 'Internal-only EOD', 'active', false) returning id",
    );
    await expectSqlError(db.query("update public.datasets set licence_id = $1, is_active = true where id = 'equities.prices'", [rows[0].id]));

    const expired = await db.query<{ id: string }>(
      "insert into public.data_licences (provider_id, product, status, allows_display, valid_from, valid_to) values ('ngx', 'Old EOD', 'active', true, '2024-01-01', '2024-12-31') returning id",
    );
    await expectSqlError(db.query("update public.datasets set licence_id = $1, is_active = true where id = 'equities.prices'", [expired.rows[0].id]));
  });

  it("refuses a licence that belongs to a different provider", async () => {
    const fmdqLicence = await createActiveLicence("fmdq");
    await expectSqlError(db.query("update public.datasets set licence_id = $1, is_active = true where id = 'equities.prices'", [fmdqLicence]));
  });

  it("allows SFI-owned datasets without a licence", async () => {
    // No SFI dataset is seeded any more: editorial sits beside this machinery.
    // The rule still has to hold for SFI-derived data such as calculated metrics,
    // so the test creates its own rather than relying on the seed.
    await db.query(
      "insert into public.datasets (id, provider_id, description, frequency) values ('sfi.derived_metrics', 'sfi', 'Test-only SFI-owned dataset', 'daily')",
    );
    await db.query("update public.datasets set is_active = true where id = 'sfi.derived_metrics'");
    const { rows } = await db.query<{ is_active: boolean }>(
      "select is_active from public.datasets where id = 'sfi.derived_metrics'",
    );
    expect(rows[0].is_active).toBe(true);
    await db.query("delete from public.datasets where id = 'sfi.derived_metrics'");
  });

  it("no longer carries the retired SFI editorial datasets", async () => {
    const { rows } = await db.query("select id from public.datasets where id in ('news.items', 'research.reports')");
    expect(rows).toEqual([]);
  });
});

describe("provenance and duplicate detection", () => {
  it("rejects the same content twice for one dataset", async () => {
    await createSourceRecord(db, "economy.observations", "release-2026-10");
    const error = await expectSqlError(createSourceRecord(db, "economy.observations", "release-2026-10"));
    expect(error.code).toBe("23505");
  });

  it("requires every observation to reference a source record", async () => {
    await expectSqlError(
      db.query("insert into public.economic_observations (series_id, period_start, period_end, value, published_at, source_record_id) values ('mpr', '2026-09-01', '2026-09-30', '27.50', now(), null)"),
    );
  });

  it("rejects a reference period that ends before it starts", async () => {
    await expectSqlError(addEconomicObservation({ period: ["2026-10-31", "2026-10-01"], value: "1" }));
  });
});

describe("historical database: append-only versions", () => {
  it("keeps every version and exactly one approved value per period", async () => {
    const v1 = await addEconomicObservation({ period: ["2026-08-01", "2026-08-31"], value: "20.12" });
    await setReview("economic_observations", v1, "approved");

    const v2 = await addEconomicObservation({ period: ["2026-08-01", "2026-08-31"], value: "20.15", version: 2, supersedes: v1, reason: "Publisher revision" });
    await setReview("economic_observations", v2, "approved");

    const { rows } = await db.query<{ version: number; value: string; review_status: string }>(
      "select version, value::text as value, review_status from public.economic_observations where series_id = 'cpi-headline-yoy' and period_start = '2026-08-01' order by version",
    );
    expect(rows).toEqual([
      { version: 1, value: "20.12", review_status: "superseded" },
      { version: 2, value: "20.15", review_status: "approved" },
    ]);
  });

  it("stores values exactly as numeric, without float rounding", async () => {
    const id = await addEconomicObservation({ period: ["2026-07-01", "2026-07-31"], value: "12345678901234567.891" });
    const { rows } = await db.query<{ value: string }>("select value::text as value from public.economic_observations where id = $1", [id]);
    expect(rows[0].value).toBe("12345678901234567.891");
  });

  it("refuses to edit a stored value in place", async () => {
    const id = await addEconomicObservation({ period: ["2026-06-01", "2026-06-30"], value: "22.00" });
    const error = await expectSqlError(db.query("update public.economic_observations set value = 21.00 where id = $1", [id]));
    expect(error.message).toMatch(/immutable/);
  });

  it("refuses to delete history", async () => {
    const id = await addEconomicObservation({ period: ["2026-05-01", "2026-05-31"], value: "23.00" });
    const error = await expectSqlError(db.query("delete from public.economic_observations where id = $1", [id]));
    expect(error.message).toMatch(/append-only/);
  });

  it("refuses invalid review transitions", async () => {
    const id = await addEconomicObservation({ period: ["2026-04-01", "2026-04-30"], value: "24.00" });
    await setReview("economic_observations", id, "rejected");
    const error = await expectSqlError(setReview("economic_observations", id, "approved"));
    expect(error.message).toMatch(/Invalid review transition/);
  });

  it("requires a reason and a predecessor for corrections", async () => {
    await expectSqlError(addEconomicObservation({ period: ["2026-03-01", "2026-03-31"], value: "1", version: 2 }));
  });
});

describe("market observations", () => {
  let instrumentId: string;

  beforeAll(async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into public.instruments (asset_class, name, review_status) values ('index', 'Test index', 'approved') returning id",
    );
    instrumentId = rows[0].id;
  });

  it("never accepts demo data", async () => {
    const source = await createSourceRecord(db, "equities.indices");
    const error = await expectSqlError(
      db.query("insert into public.market_observations (instrument_id, field, observed_at, value, unit, status, source_record_id) values ($1, 'index_level', now(), 100, 'index_points', 'demo', $2)", [instrumentId, source]),
    );
    expect(error.code).toBe("23514");
  });

  it("requires a rate concept for yields", async () => {
    const source = await createSourceRecord(db, "fixed_income.yields");
    await expectSqlError(
      db.query("insert into public.market_observations (instrument_id, field, observed_at, value, unit, status, source_record_id) values ($1, 'yield', now(), 18.5, 'percent_per_annum', 'end_of_day', $2)", [instrumentId, source]),
    );
  });

  it("validates NGX symbols and ISINs", async () => {
    await expectSqlError(db.query("insert into public.instrument_identifiers (instrument_id, scheme, value) values ($1, 'ngx_symbol', 'bad symbol')", [instrumentId]));
    await expectSqlError(db.query("insert into public.instrument_identifiers (instrument_id, scheme, value) values ($1, 'isin', 'NG123')", [instrumentId]));
  });
});

describe("financial statements", () => {
  it("only accepts lines while a statement is pending", async () => {
    // A company carries a web address, so every insert names one. Production
    // writes go through upsert_company_profile, which derives it from the name.
    const company = await db.query<{ id: string }>(
      "insert into public.companies (name, slug) values ('Test Plc', 'test-plc') returning id",
    );
    const source = await createSourceRecord(db, "companies.financials");
    const statement = await db.query<{ id: string }>(
      "insert into public.financial_statements (company_id, statement_type, period_type, period_start, period_end, audited, source_record_id) values ($1, 'income', 'FY', '2025-01-01', '2025-12-31', true, $2) returning id",
      [company.rows[0].id, source],
    );
    const statementId = statement.rows[0].id;
    await db.query("insert into public.financial_statement_lines (statement_id, line_item, value) values ($1, 'revenue', 1000)", [statementId]);
    await setReview("financial_statements", statementId, "approved");
    const error = await expectSqlError(db.query("insert into public.financial_statement_lines (statement_id, line_item, value) values ($1, 'profit_after_tax', 100)", [statementId]));
    expect(error.message).toMatch(/pending statement/);
  });
});

describe("row-level security", () => {
  let user: string;
  let admin: string;
  let approvedId: number;
  let pendingId: number;

  beforeAll(async () => {
    user = await createUser(db);
    admin = await createUser(db, { admin: true });
    approvedId = await addEconomicObservation({ period: ["2025-12-01", "2025-12-31"], value: "15.00" });
    await setReview("economic_observations", approvedId, "approved");
    pendingId = await addEconomicObservation({ period: ["2025-11-01", "2025-11-30"], value: "16.00" });
  });

  async function visibleIds(as: string) {
    return asUser(db, as, async () => {
      const { rows } = await db.query<{ id: number }>("select id from public.economic_observations where id = any($1::bigint[])", [[approvedId, pendingId]]);
      return rows.map((r) => Number(r.id)).sort((a, b) => a - b);
    });
  }

  it("hides approved data while its dataset is not licensed for display", async () => {
    expect(await visibleIds(user)).toEqual([]);
  });

  it("shows approved data once the dataset is active, but never pending rows", async () => {
    const licence = await createActiveLicence("nbs");
    await db.query("update public.datasets set licence_id = $1, is_active = true where id = 'economy.observations'", [licence]);
    expect(await visibleIds(user)).toEqual([approvedId]);
    await db.query("update public.datasets set is_active = false where id = 'economy.observations'");
  });

  it("lets administrators see the review queue", async () => {
    expect(await visibleIds(admin)).toEqual([approvedId, pendingId].sort((a, b) => a - b));
  });

  it("keeps licence terms and pipeline internals away from regular users", async () => {
    const counts = await asUser(db, user, async () => {
      const licences = await db.query<{ n: number }>("select count(*)::int as n from public.data_licences");
      const sources = await db.query<{ n: number }>("select count(*)::int as n from public.source_records");
      const providers = await db.query<{ n: number }>("select count(*)::int as n from public.data_providers");
      return { licences: licences.rows[0].n, sources: sources.rows[0].n, providers: providers.rows[0].n };
    });
    expect(counts).toEqual({ licences: 0, sources: 0, providers: 9 });
  });

  it("does not allow clients to write data, even administrators", async () => {
    await asUser(db, admin, async () => {
      await expectSqlError(db.query("insert into public.sectors (id, name) values ('test_sector', 'Test')"));
      await expectSqlError(db.query("update public.datasets set is_active = true where id = 'equities.prices'"));
    });
  });
});
