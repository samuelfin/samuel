import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, sha256 } from "./db";

/**
 * The calculation, and the things it refuses to do.
 *
 * A ratio is arithmetic over figures somebody checked against a page. That makes
 * three questions load-bearing, and they are the ones these tests ask.
 *
 * Which figures may it read? Exactly the ones the caller may read. The views are
 * security_invoker, so the licence gate on financial_statements reaches the
 * ratios: switch a dataset off and the ratios go with the figures, in the same
 * instant. A definer view would have left return on equity standing after the
 * right to show its inputs had gone.
 *
 * What may it mix? Nothing. One basis, one currency, one company, annual periods
 * only — and a series that changes basis starts again rather than measuring
 * across the change.
 *
 * And what does it say when it cannot answer? A reason, never a zero. "No prior
 * period" and "pending verification" are different statements about a company.
 */

let db: PGlite;
let financial: string;
let admin: string;
let analyst: string;
let reader: string;

let generic: string;
let bank: string;
let averages: string;
let averagesDocument: string;
let pendingCompany: string;
let genericDocument: string;
let bankDocument: string;
let licenceId: string;

beforeAll(async () => {
  db = await createTestDatabase();
  financial = await createUser(db, { staff: ["financial_analyst"] });
  admin = await createUser(db, { admin: true });
  analyst = await createUser(db, { staff: ["analyst"] });
  reader = await createUser(db);

  generic = await makeCompany("Ratio Industries Plc", "ratio-industries", "RATI");
  bank = await makeCompany("Ratio Bank Plc", "ratio-bank", "RATB");
  pendingCompany = await makeCompany("Unreviewed Ratios Plc", "unreviewed-ratios", "URAT", false);

  await db.query("select public.assign_company_template($1, $2, 'bank', '2000-01-01', null)", [financial, bank]);

  const { rows: licence } = await db.query<{ id: string }>(
    `insert into public.data_licences (provider_id, product, status, allows_display)
     values ('issuer_ir', 'Issuer-published filings', 'active', true) returning id`,
  );
  licenceId = licence[0].id;
  await db.query("update public.datasets set licence_id = $1, is_active = true where id = 'companies.documents'", [
    licenceId,
  ]);

  genericDocument = await makeDocument(generic);
  bankDocument = await makeDocument(bank);
}, 180_000);

let counter = 0;

async function makeCompany(name: string, slug: string, symbol: string, approve = true): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_profile(
       $1, $2, $3, 'listed', null, null, null, null, null, null, null, $4, null
     ) as id`,
    [analyst, name, slug, symbol],
  );
  const id = rows[0].id;
  if (approve) await db.query("select public.review_company($1, $2, 'approved')", [id, admin]);
  return id;
}

async function makeDocument(companyId: string | null): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 4096, 'issuer_document', $5, $6
     ) as id`,
    [
      analyst,
      `Annual report ${counter}`,
      `ratio/doc-${counter}.pdf`,
      sha256(`ratio-${counter}`),
      companyId,
      `https://issuer.test/annual-${counter}.pdf`,
    ],
  );
  await db.query("select public.review_document($1, $2, 'approved')", [rows[0].id, admin]);
  return rows[0].id;
}

interface LineInput {
  line_item: string;
  value_reported: number;
  presentation?: string;
  magnitude?: string | null;
  source_page?: number;
}

interface StatementInput {
  companyId?: string;
  documentId?: string;
  statementType?: string;
  periodType?: string;
  periodEnd: string;
  periodStart?: string;
  audited?: boolean;
  consolidated?: boolean;
  currency?: string;
  magnitude?: string;
  lines: LineInput[];
  approve?: boolean;
}

/** Enter a statement and, unless told otherwise, check it — which is what publishes it. */
async function enter(opts: StatementInput): Promise<string> {
  const end = opts.periodEnd;
  const start = opts.periodStart ?? `${Number(end.slice(0, 4))}-01-01`;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_statement(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
     ) as id`,
    [
      financial,
      opts.companyId ?? generic,
      opts.statementType ?? "income",
      opts.periodType ?? "FY",
      start,
      end,
      opts.audited ?? true,
      opts.consolidated ?? true,
      opts.currency ?? "NGN",
      opts.magnitude ?? "units",
      opts.documentId ?? genericDocument,
      JSON.stringify(opts.lines),
    ],
  );
  const id = rows[0].id;
  if (opts.approve !== false) {
    await db.query("select public.review_statement($1, $2, 'approved')", [id, admin]);
  }
  return id;
}

interface MetricRow {
  status: string;
  reason: string | null;
  value: string | null;
  missing_inputs: string[];
  disclosed_page: number | null;
  prior_period_end: Date | null;
  all_audited: boolean;
}

/** PGlite hands back a Date for a date column; the filings speak in days. */
function day(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

async function metric(companyId: string, year: number, code: string, as = reader): Promise<MetricRow | undefined> {
  return asUser(db, as, async () => {
    const { rows } = await db.query<MetricRow>(
      `select status, reason, value, missing_inputs, disclosed_page, prior_period_end, all_audited
         from public.company_metric_values
        where company_id = $1 and financial_year = $2 and code = $3`,
      [companyId, year, code],
    );
    return rows[0];
  });
}

/** A full core income statement and balance sheet for one year, in plain units. */
function income(revenue: number, pat: number, page = 40): LineInput[] {
  return [
    { line_item: "revenue", value_reported: revenue, source_page: page },
    { line_item: "profit_before_tax", value_reported: Math.round(pat * 1.4), source_page: page },
    { line_item: "profit_after_tax", value_reported: pat, source_page: page },
  ];
}

function balance(assets: number, equity: number, page = 60): LineInput[] {
  return [
    { line_item: "total_assets", value_reported: assets, source_page: page },
    { line_item: "total_liabilities", value_reported: assets - equity, source_page: page },
    { line_item: "shareholders_equity", value_reported: equity, source_page: page },
  ];
}

describe("the views themselves", () => {
  it("are security invoker, so a ratio cannot outlive the right to show its inputs", async () => {
    const { rows } = await db.query<{ relname: string; reloptions: string[] | null }>(
      `select relname, reloptions from pg_class
        where relkind = 'v'
          and relname in ('approved_fy_figures', 'company_fy_basis', 'company_fy_periods',
                          'company_metric_inputs', 'company_metric_values')
        order by relname`,
    );
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.reloptions ?? []).toContain("security_invoker=true");
    }
  });

  it("are readable by a signed-in user and by nobody else", async () => {
    for (const view of ["company_metric_values", "company_metric_inputs"]) {
      const { rows } = await db.query<{ privilege_type: string; grantee: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_name = $1 and grantee in ('anon', 'authenticated')`,
        [view],
      );
      const grantees = rows.map((r) => r.grantee);
      expect(grantees).toContain("authenticated");
      expect(grantees).not.toContain("anon");
    }
  });
});

describe("a figure a reader may not see produces no ratio", () => {
  const company = () => generic;

  it("ignores a statement that has not been checked", async () => {
    await enter({ periodEnd: "2001-12-31", lines: income(1000, 200), approve: false });
    expect(await metric(company(), 2001, "net_margin")).toBeUndefined();
    // Not even for the desk, whose row-level security is wider. The view means
    // "the figures we publish", and the figures desk has its own queue for the
    // ones it has not published yet.
    expect(await metric(company(), 2001, "net_margin", financial)).toBeUndefined();
    expect(await metric(company(), 2001, "net_margin", admin)).toBeUndefined();
  });

  it("ignores an approved statement of a company nobody has reviewed", async () => {
    const document = await makeDocument(pendingCompany);
    await enter({ companyId: pendingCompany, documentId: document, periodEnd: "2002-12-31", lines: income(1000, 200) });
    expect(await metric(pendingCompany, 2002, "net_margin")).toBeUndefined();
  });

  it("disappears with the licence that permits its inputs", async () => {
    await enter({ periodEnd: "2003-12-31", lines: income(1000, 250) });
    expect((await metric(generic, 2003, "net_margin"))?.value).toBe("25.000000");

    // Licences before display. Switching the dataset off hides the figures, and
    // the ratios built from them have to go in the same instant — which is the
    // point of gating on the licence rather than on a copy of its terms.
    await db.query("update public.datasets set is_active = false where id = 'companies.documents'");
    expect(await metric(generic, 2003, "net_margin")).toBeUndefined();
    await db.query("update public.datasets set is_active = true where id = 'companies.documents'");
    expect((await metric(generic, 2003, "net_margin"))?.value).toBe("25.000000");
  });

  it("ignores an interim period", async () => {
    await enter({ periodEnd: "2004-06-30", periodStart: "2004-01-01", periodType: "H1", lines: income(500, 100) });
    expect(await metric(generic, 2004, "net_margin")).toBeUndefined();
  });

  it("reads the newest version of a corrected period", async () => {
    const first = await enter({ periodEnd: "2005-12-31", lines: income(1000, 100) });
    expect((await metric(generic, 2005, "net_margin"))?.value).toBe("10.000000");
    const { rows } = await db.query<{ id: string }>(
      `select public.record_statement(
         $1, $2, 'income', 'FY', '2005-01-01', '2005-12-31', true, true, 'NGN', 'units', $3, $4::jsonb,
         null, $5, 'sfi_correction', 'The profit line was transcribed from the wrong column.'
       ) as id`,
      [financial, generic, genericDocument, JSON.stringify(income(1000, 150)), first],
    );
    await db.query("select public.review_statement($1, $2, 'approved')", [rows[0].id, admin]);
    expect((await metric(generic, 2005, "net_margin"))?.value).toBe("15.000000");
  });
});

describe("what a calculation will not mix", () => {
  it("has no prior year for an average ratio in a company's first year", async () => {
    averages = await makeCompany("Average Returns Plc", "average-returns", "AVRT");
    averagesDocument = await makeDocument(averages);
    await enter({ companyId: averages, documentId: averagesDocument, periodEnd: "2010-12-31", lines: income(1000, 200) });
    await enter({
      companyId: averages,
      documentId: averagesDocument,
      periodEnd: "2010-12-31",
      statementType: "balance_sheet",
      lines: balance(5000, 2000),
    });

    const roe = await metric(averages, 2010, "roe");
    expect(roe?.status).toBe("not_available");
    expect(roe?.reason).toBe("no_prior_period");
    expect(roe?.value).toBeNull();
  });

  it("averages once the previous year's balance sheet is entered, even with nothing else in that year", async () => {
    // The optional path: a balance sheet alone for the year before the window
    // makes the first year's averages work. Nothing else about 2009 is claimed.
    await enter({
      companyId: averages,
      documentId: averagesDocument,
      periodEnd: "2009-12-31",
      statementType: "balance_sheet",
      lines: balance(3000, 1000),
    });

    const roe = await metric(averages, 2010, "roe");
    expect(roe?.status).toBe("available");
    // 200 ÷ ((1000 + 2000) / 2) = 13.333…%
    expect(Number(roe?.value)).toBeCloseTo(13.333333, 5);
    expect(day(roe?.prior_period_end ?? null)).toBe("2009-12-31");
  });

  it("starts a new series when the basis changes, rather than measuring across it", async () => {
    const other = await makeCompany("Basis Change Plc", "basis-change", "BCHG");
    const document = await makeDocument(other);
    await enter({ companyId: other, documentId: document, periodEnd: "2011-12-31", consolidated: false, lines: income(800, 100) });
    await enter({ companyId: other, documentId: document, periodEnd: "2012-12-31", consolidated: true, lines: income(1000, 200) });

    // 2012 is read consolidated; 2011 is company-only. Growth across the two
    // would be a number about the group measured against the parent alone.
    const growth = await metric(other, 2012, "revenue_growth");
    expect(growth?.status).toBe("not_available");
    expect(growth?.reason).toBe("no_prior_period");
  });

  it("names a figure entered only on the other basis rather than calling it missing", async () => {
    const other = await makeCompany("Mixed Basis Plc", "mixed-basis", "MBAS");
    const document = await makeDocument(other);
    // The group's income statement, and the parent's balance sheet. The balance
    // sheet exists for the period, but not on the basis this calculation reads.
    await enter({ companyId: other, documentId: document, periodEnd: "2013-12-31", lines: income(1000, 200) });
    await enter({
      companyId: other,
      documentId: document,
      periodEnd: "2013-12-31",
      statementType: "balance_sheet",
      consolidated: false,
      lines: balance(5000, 2000),
    });

    const equity = await metric(other, 2013, "equity_ratio");
    expect(equity?.status).toBe("not_available");
    expect(equity?.reason).toBe("basis_mismatch");
  });

  it("names a figure entered only in another currency", async () => {
    const other = await makeCompany("Two Currency Plc", "two-currency", "TWOC");
    const document = await makeDocument(other);
    await enter({ companyId: other, documentId: document, periodEnd: "2014-12-31", currency: "USD", lines: income(1000, 200) });
    await enter({
      companyId: other,
      documentId: document,
      periodEnd: "2014-12-31",
      statementType: "balance_sheet",
      currency: "NGN",
      lines: balance(5000, 2000),
    });

    // The income statement carries three figures and the balance sheet three, so
    // the basis is decided by the tie-break on currency code: NGN. The dollar
    // income statement is then a figure in another currency, not a missing one.
    const margin = await metric(other, 2014, "net_margin");
    expect(margin?.status).toBe("not_available");
    expect(margin?.reason).toBe("currency_mismatch");
  });

  it("keeps a predecessor's figures out of its successor's ratios", async () => {
    const predecessor = await makeCompany("Ratio Bank (old) Plc", "ratio-bank-old", "RATO");
    const successor = await makeCompany("Ratio Holdings Plc", "ratio-holdings", "RATH");
    const oldDocument = await makeDocument(predecessor);
    const newDocument = await makeDocument(successor);

    await enter({ companyId: predecessor, documentId: oldDocument, periodEnd: "2015-12-31", lines: income(1000, 100) });
    await enter({ companyId: successor, documentId: newDocument, periodEnd: "2016-12-31", lines: income(2000, 400) });
    await db.query(
      `select public.record_company_succession(
         $1, $2, $3, 'holdco_reorganisation', '2016-01-01', 'day', $4, 12, null, null
       )`,
      [financial, predecessor, successor, newDocument],
    );

    // The link is a link. The successor's first year still has no prior year of
    // its own, and the predecessor's revenue is not its 2015.
    const growth = await metric(successor, 2016, "revenue_growth");
    expect(growth?.status).toBe("not_available");
    expect(growth?.reason).toBe("no_prior_period");
  });
});

describe("when it cannot answer, it says why", () => {
  it("names the figures it is waiting for", async () => {
    await enter({ periodEnd: "2020-12-31", lines: income(1000, 200) });
    const cover = await metric(generic, 2020, "interest_cover");
    expect(cover?.status).toBe("not_available");
    expect(cover?.reason).toBe("input_missing");
    expect(cover?.missing_inputs).toEqual(["finance_costs", "operating_profit"]);
  });

  it("refuses to divide by zero", async () => {
    const other = await makeCompany("Zero Base Plc", "zero-base", "ZBAS");
    const document = await makeDocument(other);
    await enter({
      companyId: other,
      documentId: document,
      periodEnd: "2021-12-31",
      lines: [
        { line_item: "revenue", value_reported: 0, source_page: 40 },
        { line_item: "profit_before_tax", value_reported: 0, source_page: 40 },
        { line_item: "profit_after_tax", value_reported: 0, source_page: 40 },
      ],
    });
    const margin = await metric(other, 2021, "net_margin");
    expect(margin?.status).toBe("not_available");
    expect(margin?.reason).toBe("denominator_zero");
  });

  it("refuses to divide by a loss, because the answer would read like a ratio and mean nothing", async () => {
    const other = await makeCompany("Loss Making Plc", "loss-making", "LOSS");
    const document = await makeDocument(other);
    await enter({
      companyId: other,
      documentId: document,
      periodEnd: "2022-12-31",
      lines: [
        { line_item: "revenue", value_reported: 1000, source_page: 40 },
        { line_item: "profit_before_tax", value_reported: 300, presentation: "bracketed", source_page: 40 },
        { line_item: "profit_after_tax", value_reported: 200, presentation: "bracketed", source_page: 40 },
        { line_item: "earnings_per_share", value_reported: 0.4, presentation: "bracketed", source_page: 41 },
        { line_item: "dividend_per_share", value_reported: 0.1, source_page: 41 },
      ],
    });
    // A margin on a loss is meaningful and is shown; a payout ratio of a loss
    // per share is not.
    expect(Number((await metric(other, 2022, "net_margin"))?.value)).toBe(-20);
    const payout = await metric(other, 2022, "payout_ratio");
    expect(payout?.status).toBe("not_available");
    expect(payout?.reason).toBe("not_applicable");
  });

  it("will not measure growth from a loss", async () => {
    const other = await makeCompany("Recovering Plc", "recovering", "RECV");
    const document = await makeDocument(other);
    await enter({
      companyId: other,
      documentId: document,
      periodEnd: "2023-12-31",
      lines: [
        { line_item: "revenue", value_reported: 1000, source_page: 40 },
        { line_item: "profit_before_tax", value_reported: 100, presentation: "bracketed", source_page: 40 },
        { line_item: "profit_after_tax", value_reported: 100, presentation: "bracketed", source_page: 40 },
      ],
    });
    await enter({ companyId: other, documentId: document, periodEnd: "2024-12-31", lines: income(1200, 150) });

    expect(Number((await metric(other, 2024, "revenue_growth"))?.value)).toBe(20);
    const profitGrowth = await metric(other, 2024, "pat_growth");
    expect(profitGrowth?.status).toBe("not_available");
    expect(profitGrowth?.reason).toBe("not_applicable");
  });

  it("will not compound a rate over a window it does not have", async () => {
    const other = await makeCompany("Short History Plc", "short-history", "SHRT");
    const document = await makeDocument(other);
    await enter({ companyId: other, documentId: document, periodEnd: "2025-12-31", lines: income(1000, 200) });
    const cagr = await metric(other, 2025, "revenue_cagr_5y");
    expect(cagr?.status).toBe("not_available");
    expect(cagr?.reason).toBe("insufficient_history");
  });
});

describe("a disclosed figure wins", () => {
  it("stands aside where the issuer published the ratio itself", async () => {
    const other = await makeCompany("Discloser Plc", "discloser", "DISC");
    const document = await makeDocument(other);
    const calculatedStatement = await enter({
      companyId: other,
      documentId: document,
      periodEnd: "2024-12-31",
      statementType: "cash_flow",
      lines: [
        { line_item: "operating_cash_flow", value_reported: 500, source_page: 70 },
        { line_item: "capital_expenditure", value_reported: 200, presentation: "bracketed", source_page: 70 },
      ],
    });

    // Without a disclosure, SFI's own figure: 500 − 200.
    const calculated = await metric(other, 2024, "free_cash_flow_calculated");
    expect(calculated?.status).toBe("available");
    expect(Number(calculated?.value)).toBe(300);

    // The issuer states free cash flow itself, on page 71, under its own
    // definition — which is not the same subtraction. Theirs is the citable
    // number, and SFI's arithmetic stands aside.
    const { rows } = await db.query<{ id: string }>(
      `select public.record_statement(
         $1, $2, 'cash_flow', 'FY', '2024-01-01', '2024-12-31', true, true, 'NGN', 'units', $3, $4::jsonb,
         null, $5, 'sfi_correction', 'The filing states free cash flow on the following page; it is entered rather than divided out.'
       ) as id`,
      [
        financial,
        other,
        document,
        JSON.stringify([
          { line_item: "operating_cash_flow", value_reported: 500, source_page: 70 },
          { line_item: "capital_expenditure", value_reported: 200, presentation: "bracketed", source_page: 70 },
          { line_item: "free_cash_flow", value_reported: 284, source_page: 71 },
        ]),
        calculatedStatement,
      ],
    );
    await db.query("select public.review_statement($1, $2, 'approved')", [rows[0].id, admin]);

    const disclosed = await metric(other, 2024, "free_cash_flow_calculated");
    expect(disclosed?.status).toBe("disclosed");
    expect(Number(disclosed?.value)).toBe(284);
    expect(disclosed?.disclosed_page).toBe(71);
  });
});

describe("which metrics a company is offered", () => {
  it("keeps the bank ratios to the companies entered under the bank template", async () => {
    await enter({
      companyId: bank,
      documentId: bankDocument,
      periodEnd: "2024-12-31",
      lines: [
        ...income(1000, 200),
        { line_item: "interest_income", value_reported: 800, source_page: 40 },
        { line_item: "interest_expense", value_reported: 300, presentation: "bracketed", source_page: 40 },
        { line_item: "net_interest_income", value_reported: 500, source_page: 40 },
      ],
    });
    await enter({
      companyId: bank,
      documentId: bankDocument,
      periodEnd: "2024-12-31",
      statementType: "balance_sheet",
      lines: [
        ...balance(10000, 2000),
        { line_item: "gross_loans", value_reported: 5000, source_page: 61 },
        { line_item: "net_loans_and_advances", value_reported: 4600, source_page: 61 },
        { line_item: "non_performing_loans", value_reported: 500, source_page: 61 },
        { line_item: "customer_deposits", value_reported: 6000, source_page: 61 },
      ],
    });

    // (5000 − 4600) ÷ 500 = 80%
    expect(Number((await metric(bank, 2024, "npl_coverage"))?.value)).toBe(80);
    // 4600 ÷ 6000 = 76.666…%
    expect(Number((await metric(bank, 2024, "loan_to_deposit"))?.value)).toBeCloseTo(76.666667, 5);

    // The same metric is not offered to a company that does not lend.
    expect(await metric(generic, 2024, "loan_to_deposit")).toBeUndefined();
  });
});

describe("how calculated", () => {
  it("names every input figure, its document and its page", async () => {
    const rows = await asUser(db, reader, async () => {
      const result = await db.query<{
        role: string;
        line_item: string;
        period_role: string;
        source_page: number | null;
        document_id: string | null;
        figure_period_end: Date;
        contribution: string | null;
      }>(
        `select role, line_item, period_role, source_page, document_id, figure_period_end, contribution
           from public.company_metric_inputs
          where company_id = $1 and financial_year = 2010 and code = 'roe'
          order by role, period_role`,
        [averages],
      );
      return result.rows;
    });

    expect(rows.map((r) => `${r.role}/${r.period_role}/${r.line_item}`)).toEqual([
      "denominator/current/shareholders_equity",
      "denominator/prior/shareholders_equity",
      "numerator/current/profit_after_tax",
    ]);
    expect(rows.every((r) => r.source_page !== null && r.document_id !== null)).toBe(true);
    expect(day(rows.find((r) => r.period_role === "prior")?.figure_period_end ?? null)).toBe("2009-12-31");
  });
});
