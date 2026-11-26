import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError } from "./db";
import { formulaText, type MetricInput, type MetricKind } from "../../lib/metrics/definitions";

/**
 * The metric register.
 *
 * A calculated figure cannot be checked against a page; it can only be checked
 * against its definition. So the definition has to be the thing that is hard to
 * change: append-only, one live version per metric, inputs fixed to the version
 * that declared them, and every row naming an owner and an approver. These tests
 * hold that shut, and hold shut the two ways a formula could quietly become
 * nonsense — a shape given a role it never evaluates, and a disclosed ratio
 * dragged in as an input to a calculation.
 */

let db: PGlite;
let admin: string;
let financial: string;
let reader: string;

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, { admin: true });
  financial = await createUser(db, { staff: ["financial_analyst"] });
  reader = await createUser(db);
}, 180_000);

async function definitionId(code: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select id from public.metric_definitions where code = $1 and version = 1",
    [code],
  );
  return rows[0].id;
}

describe("the seeded library", () => {
  it("covers the approved ratio list", async () => {
    const { rows } = await db.query<{ code: string }>(
      "select code from public.metric_definitions where is_active order by code",
    );
    const codes = rows.map((r) => r.code);

    // The list approved for stage 3d, in full. A metric dropped from the seed
    // silently disappears from every company page, so the set is asserted
    // rather than counted.
    expect(codes).toEqual([
      "capex_intensity",
      "cash_conversion",
      "cost_to_income_calculated",
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

  it("gives every definition a plain-language definition, an owner and an approver", async () => {
    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from public.metric_definitions
        where approved_at is null
           or coalesce(approved_by_name, '') = ''
           or coalesce(owner_name, '') = ''
           or char_length(btrim(definition)) < 20`,
    );
    expect(rows[0].count).toBe(0);
  });

  it("flags the whole library as self-approved, because no economist has reviewed it", async () => {
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.metric_definitions where not review_self_approved",
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
        group by d.code, d.kind`,
    );
    for (const row of rows) {
      if (row.kind === "growth" || row.kind === "cagr") expect(row.roles).toBe("base");
      else if (row.kind === "sum") expect(row.roles).toBe("numerator");
      else expect(row.roles).toBe("denominator,numerator");
    }
    expect(rows).toHaveLength(23);
  });

  it("names the disclosed line wherever a derived figure would collide with one", async () => {
    const { rows } = await db.query<{ code: string; disclosed: string }>(
      `select code, disclosed_line_item as disclosed from public.metric_definitions
        where disclosed_line_item is not null order by code`,
    );
    expect(rows).toEqual([
      { code: "cost_to_income_calculated", disclosed: "cost_to_income_ratio" },
      { code: "ebitda_margin_calculated", disclosed: "ebitda_margin" },
      { code: "free_cash_flow_calculated", disclosed: "free_cash_flow" },
      { code: "net_interest_margin_calculated", disclosed: "net_interest_margin" },
    ]);
  });

  it("adds the operating expenses line the bank cost-to-income ratio divides", async () => {
    const { rows } = await db.query<{ unit_kind: string; standard_sign: string; templates: string }>(
      `select c.unit_kind, c.standard_sign, string_agg(tl.template_id, ',') as templates
         from public.statement_line_catalogue c
         left join public.statement_template_lines tl on tl.line_item = c.line_item
        where c.line_item = 'operating_expenses'
        group by c.unit_kind, c.standard_sign`,
    );
    expect(rows[0]).toEqual({ unit_kind: "currency", standard_sign: "negative", templates: "bank" });
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
        where d.code = $1 and d.is_active
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
  // together here is the 3c lesson applied before there is anything to disagree
  // about: a reader is shown this sentence beside the number the database
  // divided, and the two must describe the same arithmetic.
  it("renders what the seed declares", async () => {
    expect(await render("net_margin")).toBe("Profit after tax ÷ Revenue");
    expect(await render("roe")).toBe("Profit after tax ÷ average shareholders' equity, opening and closing");
    expect(await render("revenue_growth")).toBe(
      "(Revenue this year − Revenue last year) ÷ Revenue last year",
    );
    expect(await render("revenue_cagr_5y")).toBe("Revenue, compounded over 5 years");
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

  it("lets a version be retired, which is how a new one takes over", async () => {
    const previous = await definitionId("gross_margin");
    await db.query("begin");
    await db.query("update public.metric_definitions set is_active = false where id = $1", [previous]);
    await db.query(
      `insert into public.metric_definitions
         (code, version, label, definition, kind, result_unit, decimals, metric_group,
          owner_name, approved_by_name, approved_at, review_self_approved, supersedes_id)
       values ('gross_margin', 2, 'Gross margin',
         'Gross profit as a percentage of revenue, restated to make the sector basis explicit for the purposes of this test.',
         'margin', 'percent', 1, 'profitability',
         'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, $1)`,
      [previous],
    );
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.metric_definitions where code = 'gross_margin'",
    );
    expect(rows[0].count).toBe(2);
    await db.query("rollback");
  });

  it("refuses two live versions of the same metric", async () => {
    const previous = await definitionId("net_margin");
    const error = await expectSqlError(
      db.query(
        `insert into public.metric_definitions
           (code, version, label, definition, kind, result_unit, decimals, metric_group,
            owner_name, approved_by_name, approved_at, review_self_approved, supersedes_id)
         values ('net_margin', 2, 'Net profit margin',
           'A second live definition of the same metric, which must not be possible to record.',
           'margin', 'percent', 1, 'profitability',
           'Interim: Technical Lead', 'Interim: Technical Lead', now(), true, $1)`,
        [previous],
      ),
    );
    expect(error.code).toBe("23505");
  });

  it("refuses a first version that supersedes something, or a later one that supersedes nothing", async () => {
    const first = await expectSqlError(
      db.query(
        `insert into public.metric_definitions
           (code, version, label, definition, kind, result_unit, decimals, metric_group,
            owner_name, approved_by_name, approved_at, supersedes_id)
         values ('orphan_metric', 1, 'Orphan',
           'A first version cannot replace anything, because nothing came before it.',
           'margin', 'percent', 1, 'profitability',
           'Interim: Technical Lead', 'Interim: Technical Lead', now(), $1)`,
        [await definitionId("roe")],
      ),
    );
    expect(first.code).toBe("23514");

    const later = await expectSqlError(
      db.query(
        `insert into public.metric_definitions
           (code, version, label, definition, kind, result_unit, decimals, metric_group,
            owner_name, approved_by_name, approved_at)
         values ('orphan_metric', 2, 'Orphan',
           'A later version must name the version it replaces, or the chain is broken.',
           'margin', 'percent', 1, 'profitability',
           'Interim: Technical Lead', 'Interim: Technical Lead', now())`,
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
          window_years, owner_name, approved_by_name, approved_at)
       values ($1, 1, 'Scratch',
         'A definition recorded inside a transaction so the shape guard can be tested against it.',
         $2, $3, 1, 'profitability', $4,
         'Interim: Technical Lead', 'Interim: Technical Lead', now())
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

describe("who may read the methodology", () => {
  it("shows an approved definition and its inputs to any signed-in reader", async () => {
    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ count: number }>(
        "select count(*)::int as count from public.metric_definitions where code = 'roe'",
      );
      expect(rows[0].count).toBe(1);
      const inputs = await db.query<{ count: number }>(
        `select count(*)::int as count from public.metric_definition_inputs i
           join public.metric_definitions d on d.id = i.definition_id
          where d.code = 'roe'`,
      );
      expect(inputs.rows[0].count).toBe(2);
    });
  });

  it("keeps an unapproved draft to the desk", async () => {
    await db.query("begin");
    const { rows } = await db.query<{ id: string }>(
      `insert into public.metric_definitions
         (code, version, label, definition, kind, result_unit, decimals, metric_group, owner_name)
       values ('draft_metric', 1, 'Draft',
         'A definition nobody has approved yet, which is the desk''s working note and not methodology.',
         'margin', 'percent', 1, 'profitability', 'Interim: Technical Lead')
       returning id`,
    );
    await db.query(
      "insert into public.metric_definition_inputs (definition_id, role, line_item) values ($1, 'numerator', 'revenue'), ($1, 'denominator', 'total_assets')",
      [rows[0].id],
    );

    for (const [who, visible] of [
      [reader, 0],
      [financial, 1],
      [admin, 1],
    ] as const) {
      await asUser(db, who, async () => {
        const seen = await db.query<{ count: number }>(
          "select count(*)::int as count from public.metric_definitions where code = 'draft_metric'",
        );
        expect(seen.rows[0].count).toBe(visible);
        const inputs = await db.query<{ count: number }>(
          "select count(*)::int as count from public.metric_definition_inputs where definition_id = $1",
          [rows[0].id],
        );
        expect(inputs.rows[0].count).toBe(visible === 0 ? 0 : 2);
      });
    }
    await db.query("rollback");
  });

  it("lets nobody write a definition through the table", async () => {
    for (const who of [reader, financial, admin]) {
      await asUser(db, who, async () => {
        const error = await expectSqlError(
          db.query(
            `insert into public.metric_definitions
               (code, version, label, definition, kind, result_unit, decimals, metric_group, owner_name)
             values ('smuggled', 1, 'Smuggled',
               'A definition inserted straight into the table, which no role may do.',
               'margin', 'percent', 1, 'profitability', 'Nobody')`,
          ),
        );
        expect(error.code).toBe("42501");
      });
    }
  });
});
