import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError } from "./db";
import { formulaText, type MetricInput, type MetricKind } from "../../lib/metrics/definitions";

/**
 * The metric register, and the approval it waits for.
 *
 * A calculated figure cannot be checked against a page; it can only be checked
 * against its definition. So the definition is the thing made hard to change —
 * append-only, one published version per metric, inputs sealed the moment
 * somebody decides on it — and hard to publish: a formula computes nothing
 * until a person approves it, and the seeded library is twenty-four proposals,
 * not a working ratio set.
 *
 * Self-approval is judged by comparing the recorder with the approver, and an
 * unknown recorder counts as self-approval. The seeded rows were recorded by a
 * migration, which is nobody, so approving them is self-approval — flagged
 * always, and refused outright where review.require_two_person is on.
 */

let db: PGlite;
let admin: string;
let otherAdmin: string;
let financial: string;
let reader: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, { admin: true });
  otherAdmin = await createUser(db, { admin: true });
  financial = await createUser(db, { staff: ["financial_analyst"] });
  reader = await createUser(db);
}, 180_000);

/** The newest version of a metric, which is the only one that can be decided. */
async function latestId(code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select id from public.metric_definitions
      where code = $1 order by version desc limit 1`,
    [code],
  );
  return rows[0].id;
}

async function versionId(code: string, version: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select id from public.metric_definitions where code = $1 and version = $2",
    [code, version],
  );
  return rows[0].id;
}

async function approve(
  id: string,
  actor = admin,
  reason = "Checked against the filing's own wording.",
): Promise<void> {
  await db.query("select public.decide_metric_definition($1, $2, 'approved', $3)", [id, actor, reason]);
}

describe("the seeded library", () => {
  it("covers the approved ratio list", async () => {
    const { rows } = await db.query<{ code: string }>(
      "select distinct code from public.metric_definitions order by code",
    );
    const codes = rows.map((r) => r.code);

    // The list approved for stage 3d, plus the current ratio recorded with the
    // liquidity lines. A metric dropped from the seed silently disappears from
    // every company page, so the set is asserted rather than counted.
    expect(codes).toEqual([
      "capex_intensity",
      "cash_conversion",
      "cost_to_income_calculated",
      "current_ratio",
      "debt_to_equity",
      "ebitda_margin_calculated",
      "eps_growth",
      "equity_ratio",
      "free_cash_flow_calculated",
      "gross_margin",
      "interest_cover",
      "loan_to_deposit",
      "net_debt_to_equity",
      "net_interest_margin_calculated",
      "net_margin",
      "npl_coverage",
      "operating_margin",
      "pat_cagr_5y",
      "pat_growth",
      "payout_ratio",
      "revenue_cagr_5y",
      "revenue_growth",
      "roa",
      "roe",
    ]);
  });

  it("publishes nothing until a person approves it", async () => {
    const { rows } = await db.query<{ active: number; approved: number; rejected: number }>(
      `select
         count(*) filter (where is_active)::int as active,
         count(*) filter (where approved_at is not null)::int as approved,
         count(*) filter (where rejected_at is not null)::int as rejected
       from public.metric_definitions`,
    );
    expect(rows[0]).toEqual({ active: 0, approved: 0, rejected: 0 });
  });

  it("gives every proposal a plain-language definition, an owner and a reason for existing", async () => {
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.metric_definitions
        where coalesce(owner_name, '') = ''
           or coalesce(record_reason, '') = ''
           or char_length(btrim(definition)) < 20`,
    );
    expect(rows[0].count).toBe(0);
  });

  it("declares every input against a catalogue line that exists", async () => {
    // The foreign key enforces this; the test states it because a formula
    // pointing at a line nobody enters is a permanent "Not available" that no
    // amount of data entry would fix.
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.metric_definition_inputs i
        where not exists (
          select 1 from public.statement_line_catalogue c where c.line_item = i.line_item
        )`,
    );
    expect(rows[0].count).toBe(0);
  });

  it("gives every definition the inputs its shape needs", async () => {
    const { rows } = await db.query<{ code: string; kind: string; roles: string }>(
      `select d.code, d.kind, string_agg(distinct i.role, ',' order by i.role) as roles
         from public.metric_definitions d
         left join public.metric_definition_inputs i on i.definition_id = d.id
        where d.version = (select max(o.version) from public.metric_definitions o where o.code = d.code)
        group by d.code, d.kind`,
    );
    for (const row of rows) {
      if (row.kind === "growth" || row.kind === "cagr") expect(row.roles).toBe("base");
      else if (row.kind === "sum") expect(row.roles).toBe("numerator");
      else expect(row.roles).toBe("denominator,numerator");
    }
    expect(rows).toHaveLength(24);
  });

  it("names the disclosed line wherever a derived figure would collide with one", async () => {
    const { rows } = await db.query<{ code: string; disclosed: string }>(
      `select distinct code, disclosed_line_item as disclosed from public.metric_definitions
        where disclosed_line_item is not null order by code`,
    );
    expect(rows).toEqual([
      { code: "cost_to_income_calculated", disclosed: "cost_to_income_ratio" },
      { code: "ebitda_margin_calculated", disclosed: "ebitda_margin" },
      { code: "free_cash_flow_calculated", disclosed: "free_cash_flow" },
      { code: "net_interest_margin_calculated", disclosed: "net_interest_margin" },
    ]);
  });

  it("adds the reported lines the later versions divide", async () => {
    const { rows } = await db.query<{ line_item: string; unit_kind: string; standard_sign: string }>(
      `select line_item, unit_kind, standard_sign from public.statement_line_catalogue
        where line_item in ('operating_expenses', 'profit_attributable_to_parent',
                            'current_assets', 'current_liabilities', 'depreciation')
        order by line_item`,
    );
    expect(rows).toEqual([
      { line_item: "current_assets", unit_kind: "currency", standard_sign: "positive" },
      { line_item: "current_liabilities", unit_kind: "currency", standard_sign: "positive" },
      { line_item: "depreciation", unit_kind: "currency", standard_sign: "negative" },
      { line_item: "operating_expenses", unit_kind: "currency", standard_sign: "negative" },
      { line_item: "profit_attributable_to_parent", unit_kind: "currency", standard_sign: "signed" },
    ]);

    // No amortisation line, and so no derived EBITDA: the reported EBITDA line
    // carries what the filing states, and a derived one is deferred rather than
    // half-built.
    const absent = await db.query<{ count: number }>(
      `select count(*)::int as count from public.statement_line_catalogue
        where line_item = 'amortisation'`,
    );
    expect(absent.rows[0].count).toBe(0);
  });
});

describe("the library reads as its formulas", () => {
  async function render(code: string): Promise<string> {
    const { rows } = await db.query<{
      kind: MetricKind;
      window_years: number | null;
      role: MetricInput["role"];
      label: string;
      line_item: string;
      sign: number;
      use_absolute: boolean;
      sort_order: number;
    }>(
      `select d.kind, d.window_years, i.role, c.label, i.line_item, i.sign, i.use_absolute, i.sort_order
         from public.metric_definitions d
         join public.metric_definition_inputs i on i.definition_id = d.id
         join public.statement_line_catalogue c on c.line_item = i.line_item
        where d.code = $1
          and d.version = (select max(o.version) from public.metric_definitions o where o.code = d.code)
        order by i.role, i.sort_order`,
      [code],
    );
    return formulaText({
      kind: rows[0].kind,
      windowYears: rows[0].window_years,
      inputs: rows.map((row) => ({
        role: row.role,
        lineItem: row.line_item,
        label: row.label,
        sign: (row.sign < 0 ? -1 : 1) as 1 | -1,
        useAbsolute: row.use_absolute,
        sortOrder: row.sort_order,
      })),
    });
  }

  // The seed and the rendering are two descriptions of one formula. Pinning them
  // together is the 3c lesson applied before there is anything to disagree
  // about: a reader is shown this sentence beside the number the database
  // divided, and the two must describe the same arithmetic.
  it("renders what the seed declares", async () => {
    expect(await render("net_margin")).toBe("Profit after tax ÷ Revenue");
    expect(await render("roe")).toBe(
      "Profit attributable to the parent ÷ average shareholders' equity, opening and closing",
    );
    expect(await render("revenue_growth")).toBe(
      "(Revenue this year − Revenue last year) ÷ Revenue last year",
    );
    expect(await render("revenue_cagr_5y")).toBe(
      "Revenue now against revenue 4 financial years earlier, as an annual compound rate",
    );
    expect(await render("free_cash_flow_calculated")).toBe(
      "Net cash from operations + Capital expenditure",
    );
    expect(await render("interest_cover")).toBe("Operating profit ÷ the size of finance costs");
    expect(await render("npl_coverage")).toBe(
      "Gross loans and advances − Loans and advances (net) ÷ Non-performing loans",
    );
    expect(await render("cost_to_income_calculated")).toBe(
      "the size of operating expenses ÷ Total operating income",
    );
    expect(await render("current_ratio")).toBe("Current assets ÷ Current liabilities");
  });
});

describe("a definition is fixed once recorded", () => {
  it("refuses to be edited", async () => {
    const error = await expectSqlError(
      db.query("update public.metric_definitions set definition = definition || ' and also' where code = 'roe'"),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/record a new version/i);
  });

  it("refuses to be deleted", async () => {
    const error = await expectSqlError(
      db.query("delete from public.metric_definitions where code = 'roe'"),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses to be published without an approval", async () => {
    const error = await expectSqlError(
      db.query("update public.metric_definitions set is_active = true where code = 'net_margin'"),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/unapproved definition cannot be published/i);
  });

  it("refuses a first version that supersedes something, or a later one that supersedes nothing", async () => {
    const first = await expectSqlError(
      db.query(
        `insert into public.metric_definitions
           (code, version, label, definition, kind, result_unit, decimals, metric_group,
            owner_name, record_reason, supersedes_id)
         values ('orphan_metric', 1, 'Orphan',
           'A first version cannot replace anything, because nothing came before it.',
           'margin', 'percent', 1, 'profitability',
           'Interim: Technical Lead', 'A test of the version chain.', $1)`,
        [await latestId("roe")],
      ),
    );
    expect(first.code).toBe("23514");

    const later = await expectSqlError(
      db.query(
        `insert into public.metric_definitions
           (code, version, label, definition, kind, result_unit, decimals, metric_group,
            owner_name, record_reason)
         values ('orphan_metric', 2, 'Orphan',
           'A later version must name the version it replaces, or the chain is broken.',
           'margin', 'percent', 1, 'profitability',
           'Interim: Technical Lead', 'A test of the version chain.')`,
      ),
    );
    expect(later.code).toBe("23514");
  });

  it("holds its inputs as fixed as itself", async () => {
    const update = await expectSqlError(
      db.query("update public.metric_definition_inputs set sign = -1 where line_item = 'revenue'"),
    );
    expect(update.code).toBe("42501");
    const remove = await expectSqlError(
      db.query("delete from public.metric_definition_inputs where line_item = 'revenue'"),
    );
    expect(remove.code).toBe("42501");
  });
});

describe("the shapes", () => {
  async function scratch(kind: string, unit = "percent", window: number | null = null): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.metric_definitions
         (code, version, label, definition, kind, result_unit, decimals, metric_group,
          window_years, owner_name, record_reason)
       values ($1, 1, 'Scratch',
         'A definition recorded inside a transaction so the shape guard can be tested against it.',
         $2, $3, 1, 'profitability', $4,
         'Interim: Technical Lead', 'A test of the shape guard.')
       returning id`,
      [`scratch_${kind}_${Math.random().toString(36).slice(2, 8)}`, kind, unit, window],
    );
    return rows[0].id;
  }

  it("refuses a growth with a numerator", async () => {
    await db.query("begin");
    const id = await scratch("growth");
    const error = await expectSqlError(
      db.query(
        "insert into public.metric_definition_inputs (definition_id, role, line_item) values ($1, 'numerator', 'revenue')",
        [id],
      ),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/one base quantity/i);
    await db.query("rollback");
  });

  it("refuses a margin with a base", async () => {
    await db.query("begin");
    const id = await scratch("margin");
    const error = await expectSqlError(
      db.query(
        "insert into public.metric_definition_inputs (definition_id, role, line_item) values ($1, 'base', 'revenue')",
        [id],
      ),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/has no base/i);
    await db.query("rollback");
  });

  it("refuses a sum with a denominator", async () => {
    await db.query("begin");
    const id = await scratch("sum", "currency");
    const error = await expectSqlError(
      db.query(
        "insert into public.metric_definition_inputs (definition_id, role, line_item) values ($1, 'denominator', 'revenue')",
        [id],
      ),
    );
    expect(error.code).toBe("23514");
    await db.query("rollback");
  });

  it("refuses a disclosed ratio as an input to a calculation", async () => {
    await db.query("begin");
    const id = await scratch("margin");
    const error = await expectSqlError(
      db.query(
        "insert into public.metric_definition_inputs (definition_id, role, line_item) values ($1, 'numerator', 'npl_ratio')",
        [id],
      ),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/disclosed ratio, not an input/i);
    await db.query("rollback");
  });

  it("ties the window to the shape that uses one", async () => {
    await db.query("begin");
    const missing = await expectSqlError(scratch("cagr"));
    expect(missing.code).toBe("23514");
    await db.query("rollback");

    await db.query("begin");
    const spurious = await expectSqlError(scratch("margin", "percent", 5));
    expect(spurious.code).toBe("23514");
    await db.query("rollback");
  });

  it("keeps a currency result for sums and only for sums", async () => {
    await db.query("begin");
    const error = await expectSqlError(scratch("margin", "currency"));
    expect(error.code).toBe("23514");
    await db.query("rollback");
  });
});

describe("approval is a human act", () => {
  it("is refused to everyone but a platform administrator", async () => {
    const id = await latestId("gross_margin");
    for (const who of [financial, reader]) {
      const error = await expectSqlError(
        db.query("select public.decide_metric_definition($1, $2, 'approved', 'Looks right to me.')", [id, who]),
      );
      expect(error.code).toBe("42501");
    }
  });

  it("publishes the version, and flags the seeded library as self-approved", async () => {
    await db.query("begin");
    const id = await latestId("gross_margin");
    await approve(id);
    const { rows } = await db.query<{
      is_active: boolean;
      review_self_approved: boolean;
      approved_by: string;
      decision_reason: string;
    }>(
      "select is_active, review_self_approved, approved_by, decision_reason from public.metric_definitions where id = $1",
      [id],
    );
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].approved_by).toBe(admin);
    expect(rows[0].decision_reason).toMatch(/filing/i);
    // Recorded by a migration, which is nobody. An unknown recorder cannot be
    // shown to be a second pair of eyes, so this is self-approval and says so.
    expect(rows[0].review_self_approved).toBe(true);
    await db.query("rollback");
  });

  it("is refused outright for a self-approval where two people are required", async () => {
    await db.query("begin");
    await db.query(
      "update public.platform_settings set value = 'true'::jsonb where key = 'review.require_two_person'",
    );
    const error = await expectSqlError(approve(await latestId("net_margin")));
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/other than the person who recorded/i);
    await db.query("rollback");
  });

  it("lets a second administrator approve what the first recorded, and does not flag it", async () => {
    await db.query("begin");
    await db.query(
      "update public.platform_settings set value = 'true'::jsonb where key = 'review.require_two_person'",
    );
    const { rows } = await db.query<{ id: string }>(
      `select public.record_metric_definition(
         $1, 'test_margin', 'Test margin',
         'A margin recorded by one administrator so that another can approve it, which is the point of the setting.',
         'margin', 'percent', 'profitability', 'Interim: Technical Lead',
         'Testing the two-person rule.',
         '[{"role":"numerator","line_item":"gross_profit"},{"role":"denominator","line_item":"revenue"}]'::jsonb
       ) as id`,
      [admin],
    );
    await approve(rows[0].id, otherAdmin);
    const check = await db.query<{ review_self_approved: boolean; is_active: boolean }>(
      "select review_self_approved, is_active from public.metric_definitions where id = $1",
      [rows[0].id],
    );
    expect(check.rows[0]).toEqual({ review_self_approved: false, is_active: true });
    await db.query("rollback");
  });

  it("records a rejection as a decision of its own, with its reason", async () => {
    await db.query("begin");
    const id = await latestId("payout_ratio");
    await db.query("select public.decide_metric_definition($1, $2, 'rejected', $3)", [
      id,
      admin,
      "The payout should be measured against the parent's earnings, not the group's.",
    ]);
    const { rows } = await db.query<{
      rejected_by: string;
      is_active: boolean;
      approved_at: string | null;
      decision_reason: string;
    }>(
      "select rejected_by, is_active, approved_at, decision_reason from public.metric_definitions where id = $1",
      [id],
    );
    expect(rows[0].rejected_by).toBe(admin);
    expect(rows[0].approved_at).toBeNull();
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].decision_reason).toMatch(/parent/i);

    // And it is not pending any more: the desk must not offer it again as
    // though nobody had looked.
    const second = await expectSqlError(approve(id));
    expect(second.code).toBe("23514");
    expect(second.message).toMatch(/already been decided/i);
    await db.query("rollback");
  });

  it("refuses a rejection with no reason", async () => {
    const error = await expectSqlError(
      db.query("select public.decide_metric_definition($1, $2, 'rejected', null)", [
        await latestId("roa"),
        admin,
      ]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/why the formula is being rejected/i);
  });

  it("seals the inputs once a decision is taken", async () => {
    await db.query("begin");
    const id = await latestId("roa");
    await approve(id);
    const error = await expectSqlError(
      db.query(
        "insert into public.metric_definition_inputs (definition_id, role, line_item) values ($1, 'numerator', 'revenue')",
        [id],
      ),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/inputs are sealed/i);
    await db.query("rollback");
  });

  it("cannot be withdrawn once given", async () => {
    await db.query("begin");
    const id = await latestId("operating_margin");
    await approve(id);
    const error = await expectSqlError(
      db.query("update public.metric_definitions set approved_at = null where id = $1", [id]),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/approval cannot be withdrawn/i);
    await db.query("rollback");
  });

  it("only approves a version that supersedes the latest one", async () => {
    // Version 1 of return on equity is the wrong formula and version 2 exists.
    // Approving version 1 would publish a numerator and a denominator belonging
    // to different sets of owners, so it is refused — not by a special case, but
    // because it no longer supersedes the latest version.
    const stale = await versionId("roe", 1);
    const error = await expectSqlError(approve(stale));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/newer version of roe has been recorded/i);

    await db.query("begin");
    await approve(await versionId("roe", 2));
    const { rows } = await db.query<{ version: number }>(
      "select version from public.metric_definitions where code = 'roe' and is_active",
    );
    expect(rows[0].version).toBe(2);
    await db.query("rollback");
  });

  it("keeps one published version per metric", async () => {
    await db.query("begin");
    const first = await latestId("equity_ratio");
    await approve(first);
    const error = await expectSqlError(
      db.query(
        `insert into public.metric_definitions
           (code, version, label, definition, kind, result_unit, decimals, metric_group,
            owner_name, record_reason, approved_by_name, approved_at, is_active, supersedes_id)
         values ('equity_ratio', 2, 'Equity ratio',
           'A second published version of the same metric, which must not be possible to record.',
           'margin', 'percent', 1, 'leverage',
           'Interim: Technical Lead', 'A test of the single-publication rule.',
           'Interim: Technical Lead', now(), true, $1)`,
        [first],
      ),
    );
    expect(error.code).toBe("23505");
    await db.query("rollback");
  });
});

describe("recording and retiring a formula", () => {
  it("is refused to everyone but a platform administrator, and needs a reason", async () => {
    const error = await expectSqlError(
      db.query(
        `select public.record_metric_definition(
           $1, 'sneaky_margin', 'Sneaky margin',
           'A formula recorded by somebody who may not record formulas, which must fail.',
           'margin', 'percent', 'profitability', 'Nobody', 'Because I can.',
           '[{"role":"numerator","line_item":"revenue"},{"role":"denominator","line_item":"total_assets"}]'::jsonb
         )`,
        [financial],
      ),
    );
    expect(error.code).toBe("42501");

    const reasonless = await expectSqlError(
      db.query(
        `select public.record_metric_definition(
           $1, 'reasonless_margin', 'Reasonless margin',
           'A formula recorded without saying why, which is a methodology nobody can review.',
           'margin', 'percent', 'profitability', 'Interim: Technical Lead', null,
           '[{"role":"numerator","line_item":"revenue"},{"role":"denominator","line_item":"total_assets"}]'::jsonb
         )`,
        [admin],
      ),
    );
    expect(reasonless.code).toBe("23514");
  });

  it("retires a correction's predecessor at once, so nothing goes on publishing a disputed number", async () => {
    await db.query("begin");
    const first = await latestId("cash_conversion");
    await approve(first);

    const { rows } = await db.query<{ id: string }>(
      `select public.record_metric_definition(
         $1, 'cash_conversion', 'Cash conversion',
         'Operating cash flow against the parent''s share of profit, recorded to test that a correction takes its predecessor out of service while it waits.',
         'margin', 'percent', 'cash_flow', 'Interim: Technical Lead',
         'Correcting the numerator to the parent''s share.',
         '[{"role":"numerator","line_item":"operating_cash_flow"},{"role":"denominator","line_item":"profit_attributable_to_parent"}]'::jsonb
       ) as id`,
      [admin],
    );

    const state = await db.query<{ version: number; is_active: boolean; approved_at: string | null }>(
      "select version, is_active, approved_at from public.metric_definitions where code = 'cash_conversion' order by version",
    );
    // Nothing published: the old version is out of service and the new one is
    // not approved. A reader sees the metric awaiting approval, which is true.
    expect(state.rows.map((r) => r.is_active)).toEqual([false, false]);
    expect(state.rows[1].approved_at).toBeNull();

    // And a rejection does not put the old one back. The way back is deliberate,
    // named and audited.
    await db.query("select public.decide_metric_definition($1, $2, 'rejected', $3)", [
      rows[0].id,
      otherAdmin,
      "The group figure is the right numerator for cash conversion after all.",
    ]);
    const after = await db.query<{ count: number }>(
      "select count(*) filter (where is_active)::int as count from public.metric_definitions where code = 'cash_conversion'",
    );
    expect(after.rows[0].count).toBe(0);

    await db.query("select public.reinstate_metric_definition($1, $2, $3)", [
      first,
      otherAdmin,
      "Putting the previous definition back into service after the correction was rejected.",
    ]);
    const reinstated = await db.query<{ version: number }>(
      "select version from public.metric_definitions where code = 'cash_conversion' and is_active",
    );
    expect(reinstated.rows[0].version).toBe(1);
    await db.query("rollback");
  });

  it("leaves the current version published for a new metric that disputes nothing", async () => {
    await db.query("begin");
    await approve(await latestId("capex_intensity"));
    await db.query(
      `select public.record_metric_definition(
         $1, 'capex_intensity', 'Capital expenditure intensity',
         'A refinement recorded without taking the published version out of service, which is right where nobody is disputing it.',
         'margin', 'percent', 'cash_flow', 'Interim: Technical Lead',
         'A wording improvement, not a correction.',
         '[{"role":"numerator","line_item":"capital_expenditure","use_absolute":true},{"role":"denominator","line_item":"revenue"}]'::jsonb,
         1, null, null, null, false
       )`,
      [admin],
    );
    const { rows } = await db.query<{ version: number }>(
      "select version from public.metric_definitions where code = 'capex_intensity' and is_active",
    );
    expect(rows[0].version).toBe(1);
    await db.query("rollback");
  });

  it("refuses to retire what is not published, or to retire without a reason", async () => {
    const unpublished = await expectSqlError(
      db.query("select public.retire_metric_definition($1, $2, 'Not wanted.')", [
        await latestId("loan_to_deposit"),
        admin,
      ]),
    );
    expect(unpublished.code).toBe("23514");

    await db.query("begin");
    const id = await latestId("loan_to_deposit");
    await approve(id);
    const reasonless = await expectSqlError(
      db.query("select public.retire_metric_definition($1, $2, null)", [id, admin]),
    );
    expect(reasonless.code).toBe("23514");
    await db.query("rollback");
  });
});

describe("who may read the methodology", () => {
  it("shows a published definition and its inputs to any signed-in reader", async () => {
    await db.query("begin");
    const id = await latestId("debt_to_equity");
    await approve(id);
    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ count: number }>(
        "select count(*)::int as count from public.metric_definitions where id = $1",
        [id],
      );
      expect(rows[0].count).toBe(1);
      const inputs = await db.query<{ count: number }>(
        "select count(*)::int as count from public.metric_definition_inputs where definition_id = $1",
        [id],
      );
      expect(inputs.rows[0].count).toBe(2);
    });
    await db.query("rollback");
  });

  it("keeps an undecided formula to the desk", async () => {
    const id = await latestId("gross_margin");
    for (const [who, visible] of [
      [reader, 0],
      [financial, 1],
      [admin, 1],
    ] as const) {
      await asUser(db, who, async () => {
        const seen = await db.query<{ count: number }>(
          "select count(*)::int as count from public.metric_definitions where id = $1",
          [id],
        );
        expect(seen.rows[0].count).toBe(visible);
        const inputs = await db.query<{ count: number }>(
          "select count(*)::int as count from public.metric_definition_inputs where definition_id = $1",
          [id],
        );
        expect(inputs.rows[0].count).toBe(visible === 0 ? 0 : 2);
      });
    }
  });

  it("tells a reader that a metric exists and is waiting, and nothing more", async () => {
    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ code: string; label: string; status: string }>(
        `select code, label, status from public.metric_definition_status
          where code = 'gross_margin' and version = 1`,
      );
      expect(rows[0]).toEqual({
        code: "gross_margin",
        label: "Gross margin",
        status: "awaiting_approval",
      });

      // The status view carries no formula, no inputs and no reasons. A reader
      // learns that a ratio is coming, not what it would have said.
      const columns = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'metric_definition_status'
          order by column_name`,
      );
      expect(columns.rows.map((c) => c.column_name)).toEqual([
        "code",
        "id",
        "label",
        "metric_group",
        "sort_order",
        "status",
        "template_id",
        "version",
      ]);
    });
  });

  it("lets nobody write a definition through the table", async () => {
    for (const who of [reader, financial, admin]) {
      await asUser(db, who, async () => {
        const error = await expectSqlError(
          db.query(
            `insert into public.metric_definitions
               (code, version, label, definition, kind, result_unit, decimals, metric_group, owner_name, record_reason)
             values ('smuggled', 1, 'Smuggled',
               'A definition inserted straight into the table, which no role may do.',
               'margin', 'percent', 1, 'profitability', 'Nobody', 'Because I can.')`,
          ),
        );
        expect(error.code).toBe("42501");
      });
    }
  });
});
