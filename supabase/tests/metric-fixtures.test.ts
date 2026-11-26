import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, sha256 } from "./db";

/**
 * The arithmetic, against answers worked out by hand.
 *
 * Two layers, deliberately different in kind.
 *
 * The first is invented: round numbers for a company that does not exist, chosen
 * so every expected answer can be checked in your head — a quarter of a
 * thousand, an average of eight hundred and twelve hundred, four years of ten
 * per cent compounding to 1.4641. Invented figures are safe here because they
 * are about no real company and never leave the test file. They are the only way
 * to test the awkward cases on purpose: a zero denominator, a loss, a figure
 * printed in thousands beside one printed in millions.
 *
 * The second is real: Zenith Bank Plc's audited consolidated figures for FY2021
 * to FY2023, each line cited to the page of the filing it is printed on. Nothing
 * is invented for a real company, and nothing is taken from a secondary source.
 * The expected ratios were computed from those figures with a calculator rather
 * than by running this code, and the filing's own five-year summary — a
 * different page, prepared independently of the primary statements — is used as
 * a cross-check on the figures that went in.
 *
 * Source: Zenith Bank Plc, Consolidated and Separate Financial Statements for
 * the year ended 31 December 2023, filed with the Nigerian Exchange
 * (doclib.ngxgroup.com, "ZENITH BANK PLC - QUARTER 5 - FINANCIAL STATEMENT FOR
 * 2023", April 2024). Printed page numbers, as the document numbers them:
 *   39  Consolidated and Separate Statements of Profit or Loss
 *   40  Consolidated and Separate Statements of Financial Position
 *   214 Five-Year Financial Summary — statement of financial position
 *   215 Five-Year Financial Summary — statement of profit or loss
 */

let db: PGlite;
let financial: string;
let admin: string;
let analyst: string;
let reader: string;

let invented: string;
let inventedDocument: string;
let zenith: string;
let zenithDocument: string;

beforeAll(async () => {
  db = await createTestDatabase();
  financial = await createUser(db, { staff: ["financial_analyst"] });
  admin = await createUser(db, { admin: true });
  analyst = await createUser(db, { staff: ["analyst"] });
  reader = await createUser(db);

  const { rows: licence } = await db.query<{ id: string }>(
    `insert into public.data_licences (provider_id, product, status, allows_display)
     values ('issuer_ir', 'Issuer-published filings', 'active', true) returning id`,
  );
  await db.query("update public.datasets set licence_id = $1, is_active = true where id = 'companies.documents'", [
    licence[0].id,
  ]);

  invented = await makeCompany("Worked Example Plc", "worked-example", "WRKD");
  inventedDocument = await makeDocument(invented, "Worked Example Plc annual report");

  zenith = await makeCompany("Zenith Bank Plc", "zenith-bank", "ZENITHBANK");
  zenithDocument = await makeDocument(
    zenith,
    "Zenith Bank Plc — Consolidated and Separate Financial Statements, 31 December 2023",
  );
  await db.query("select public.assign_company_template($1, $2, 'bank', '2000-01-01', null)", [financial, zenith]);
}, 180_000);

let counter = 0;

async function makeCompany(name: string, slug: string, symbol: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_profile(
       $1, $2, $3, 'listed', null, null, null, null, null, null, null, $4, null
     ) as id`,
    [analyst, name, slug, symbol],
  );
  await db.query("select public.review_company($1, $2, 'approved')", [rows[0].id, admin]);
  return rows[0].id;
}

async function makeDocument(companyId: string, title: string): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 4096, 'issuer_document', $5, $6
     ) as id`,
    [
      analyst,
      title,
      `fixtures/doc-${counter}.pdf`,
      sha256(`fixture-${counter}`),
      companyId,
      `https://issuer.test/filing-${counter}.pdf`,
    ],
  );
  await db.query("select public.review_document($1, $2, 'approved')", [rows[0].id, admin]);
  return rows[0].id;
}

interface Line {
  line_item: string;
  value_reported: number;
  presentation?: string;
  magnitude?: string;
  source_page: number;
}

async function enter(opts: {
  companyId: string;
  documentId: string;
  statementType: string;
  year: number;
  lines: Line[];
  magnitude?: string;
  currency?: string;
}): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `select public.record_statement(
       $1, $2, $3, 'FY', $4, $5, true, true, $6, $7, $8, $9::jsonb
     ) as id`,
    [
      financial,
      opts.companyId,
      opts.statementType,
      `${opts.year}-01-01`,
      `${opts.year}-12-31`,
      opts.currency ?? "NGN",
      opts.magnitude ?? "units",
      opts.documentId,
      JSON.stringify(opts.lines),
    ],
  );
  await db.query("select public.review_statement($1, $2, 'approved')", [rows[0].id, admin]);
}

interface Answer {
  status: string;
  reason: string | null;
  value: string | null;
  window_span: number | null;
}

async function answer(companyId: string, year: number, code: string): Promise<Answer | undefined> {
  return asUser(db, reader, async () => {
    const { rows } = await db.query<Answer>(
      `select status, reason, value, window_span
         from public.company_metric_values
        where company_id = $1 and financial_year = $2 and code = $3`,
      [companyId, year, code],
    );
    return rows[0];
  });
}

/** The value, to the decimals the metric is published at. */
async function value(companyId: string, year: number, code: string): Promise<number> {
  const row = await answer(companyId, year, code);
  expect(row?.status, `${code} ${year} should have a value: ${row?.reason ?? "no row"}`).toBe("available");
  return Number(row?.value);
}

describe("worked examples, invented on purpose", () => {
  beforeAll(async () => {
    // FY2020: the opening year. Revenue 1,000 so that four years of compounding
            // at ten per cent reaches 1.1^4 = 1.4641 exactly.
    await enter({
      companyId: invented,
      documentId: inventedDocument,
      statementType: "income",
      year: 2020,
      lines: [
        { line_item: "revenue", value_reported: 1000, source_page: 10 },
        { line_item: "profit_before_tax", value_reported: 150, source_page: 10 },
        { line_item: "profit_after_tax", value_reported: 100, source_page: 10 },
        { line_item: "profit_attributable_to_parent", value_reported: 100, source_page: 10 },
      ],
    });
    await enter({
      companyId: invented,
      documentId: inventedDocument,
      statementType: "balance_sheet",
      year: 2020,
      lines: [
        { line_item: "total_assets", value_reported: 4000, source_page: 11 },
        { line_item: "total_liabilities", value_reported: 3200, source_page: 11 },
        { line_item: "shareholders_equity", value_reported: 800, source_page: 11 },
      ],
    });

    // FY2021. Revenue 1,200 — twenty per cent up on 1,000. Profit after tax 250
    // on revenue of 1,200. Equity closes at 1,200, so the average of the
    // opening 800 and the closing 1,200 is exactly 1,000.
    await enter({
      companyId: invented,
      documentId: inventedDocument,
      statementType: "income",
      year: 2021,
      lines: [
        { line_item: "revenue", value_reported: 1200, source_page: 20 },
        { line_item: "operating_profit", value_reported: 300, source_page: 20 },
        { line_item: "finance_costs", value_reported: 120, presentation: "bracketed", source_page: 20 },
        { line_item: "profit_before_tax", value_reported: 300, source_page: 20 },
        { line_item: "profit_after_tax", value_reported: 240, source_page: 20 },
        { line_item: "profit_attributable_to_parent", value_reported: 240, source_page: 20 },
        { line_item: "earnings_per_share", value_reported: 2.4, source_page: 21 },
        { line_item: "dividend_per_share", value_reported: 0.6, source_page: 21 },
      ],
    });
    await enter({
      companyId: invented,
      documentId: inventedDocument,
      statementType: "balance_sheet",
      year: 2021,
      lines: [
        { line_item: "total_assets", value_reported: 6000, source_page: 30 },
        { line_item: "total_liabilities", value_reported: 4800, source_page: 30 },
        { line_item: "total_borrowings", value_reported: 1800, source_page: 30 },
        { line_item: "shareholders_equity", value_reported: 1200, source_page: 30 },
      ],
    });
    await enter({
      companyId: invented,
      documentId: inventedDocument,
      statementType: "cash_flow",
      year: 2021,
      lines: [
        { line_item: "operating_cash_flow", value_reported: 500, source_page: 40 },
        { line_item: "capital_expenditure", value_reported: 200, presentation: "bracketed", source_page: 40 },
      ],
    });

    // FY2024, four years after 2020: revenue 1,464.1, which is 1,000 × 1.1⁴.
    await enter({
      companyId: invented,
      documentId: inventedDocument,
      statementType: "income",
      year: 2024,
      lines: [
        { line_item: "revenue", value_reported: 1464.1, source_page: 50 },
        { line_item: "profit_before_tax", value_reported: 200, source_page: 50 },
        { line_item: "profit_after_tax", value_reported: 150, source_page: 50 },
      ],
    });
  }, 120_000);

  it("takes a margin: 240 of 1,200 is twenty per cent", async () => {
    expect(await value(invented, 2021, "net_margin")).toBe(20);
  });

  it("averages a balance: 240 over the mean of 800 and 1,200 is twenty-four per cent", async () => {
    // The invented company has no minority interest, so the profit attributable
    // to the parent and the group's profit after tax are the same figure. That
    // makes this a clean test of the averaging rather than of the numerator,
    // which the real filing tests separately.
    expect(await value(invented, 2021, "roe")).toBe(24);
  });

  it("has no return on equity where the profit attributable to the parent was not entered", async () => {
    // Never a fallback to the group's profit after tax. The two differ by the
    // non-controlling interest, and substituting one for the other would publish
    // a ratio whose numerator and denominator belong to different sets of owners.
    const noParentLine = await makeCompany("No Parent Line Plc", "no-parent-line", "NOPL");
    const document = await makeDocument(noParentLine, "No Parent Line Plc annual report");
    for (const year of [2022, 2023]) {
      await enter({
        companyId: noParentLine,
        documentId: document,
        statementType: "balance_sheet",
        year,
        lines: [
          { line_item: "total_assets", value_reported: 5000, source_page: 11 },
          { line_item: "total_liabilities", value_reported: 3000, source_page: 11 },
          { line_item: "shareholders_equity", value_reported: 2000, source_page: 11 },
        ],
      });
    }
    await enter({
      companyId: noParentLine,
      documentId: document,
      statementType: "income",
      year: 2023,
      lines: [
        { line_item: "revenue", value_reported: 1200, source_page: 10 },
        { line_item: "profit_before_tax", value_reported: 300, source_page: 10 },
        { line_item: "profit_after_tax", value_reported: 240, source_page: 10 },
      ],
    });

    const roe = await answer(noParentLine, 2023, "roe");
    expect(roe?.status).toBe("not_available");
    expect(roe?.reason).toBe("input_missing");

    // Return on assets is unaffected: it divides the group's profit by the
    // group's assets, which belong to the same set of owners.
    expect(await value(noParentLine, 2023, "roa")).toBe(4.8);
  });

  it("averages total assets the same way: 240 over the mean of 4,000 and 6,000 is 4.8 per cent", async () => {
    expect(await value(invented, 2021, "roa")).toBe(4.8);
  });

  it("measures growth against last year, not against the earliest year held", async () => {
    // 1,200 against 1,000 is twenty per cent.
    expect(await value(invented, 2021, "revenue_growth")).toBe(20);
    // 2024's nearest earlier year held is 2020, four years back. A four-year
    // change published as an annual one would be a false statement about the
    // company, so there is no answer and the reason says so.
    const gap = await answer(invented, 2024, "revenue_growth");
    expect(gap?.status).toBe("not_available");
    expect(gap?.reason).toBe("no_prior_period");
  });

  it("compounds: 1,000 to 1,464.1 over four years is ten per cent a year", async () => {
    // FY2020 and FY2024 are both held, which is the whole requirement: a
    // five-year rate spans four years of compounding, and the years between the
    // endpoints are not used.
    const cagr = await answer(invented, 2024, "revenue_cagr_5y");
    expect(cagr?.status).toBe("available");
    expect(cagr?.window_span).toBe(4);
    expect(Number(cagr?.value)).toBeCloseTo(10, 6);
  });

  it("refuses a five-year rate measured over fewer than five years", async () => {
    // Two years of revenue is a one-year change. Publishing it as a five-year
    // compound rate would be a false statement about the company, whatever the
    // arithmetic says.
    const young = await makeCompany("Two Years Plc", "two-years", "TWOY");
    const document = await makeDocument(young, "Two Years Plc annual report");
    for (const [year, revenue] of [
      [2022, 1000],
      [2023, 1500],
    ] as const) {
      await enter({
        companyId: young,
        documentId: document,
        statementType: "income",
        year,
        lines: [
          { line_item: "revenue", value_reported: revenue, source_page: 10 },
          { line_item: "profit_before_tax", value_reported: 100, source_page: 10 },
          { line_item: "profit_after_tax", value_reported: 80, source_page: 10 },
        ],
      });
    }
    const cagr = await answer(young, 2023, "revenue_cagr_5y");
    expect(cagr?.status).toBe("not_available");
    expect(cagr?.reason).toBe("insufficient_history");
  });

  it("allows a gap between the endpoints, because only the endpoints are used", async () => {
    const gappy = await makeCompany("Gap Years Plc", "gap-years", "GAPY");
    const document = await makeDocument(gappy, "Gap Years Plc annual report");
    for (const [year, revenue] of [
      [2019, 1000],
      [2023, 1464.1],
    ] as const) {
      await enter({
        companyId: gappy,
        documentId: document,
        statementType: "income",
        year,
        lines: [
          { line_item: "revenue", value_reported: revenue, source_page: 10 },
          { line_item: "profit_before_tax", value_reported: 100, source_page: 10 },
          { line_item: "profit_after_tax", value_reported: 80, source_page: 10 },
        ],
      });
    }
    const cagr = await answer(gappy, 2023, "revenue_cagr_5y");
    expect(cagr?.status).toBe("available");
    expect(cagr?.window_span).toBe(4);
    expect(Number(cagr?.value)).toBeCloseTo(10, 6);
  });

  it("adds a sum, with the outflow stored negative: 500 less 200 is 300", async () => {
    expect(await value(invented, 2021, "free_cash_flow_calculated")).toBe(300);
  });

  it("divides by the size of a cost, not by its sign: 300 over 120 is 2.5 times", async () => {
    expect(await value(invented, 2021, "interest_cover")).toBe(2.5);
  });

  it("takes a multiple: 1,800 of borrowings over 1,200 of equity is 1.5 times", async () => {
    expect(await value(invented, 2021, "debt_to_equity")).toBe(1.5);
  });

  it("takes equity as a share of the balance sheet: 1,200 of 6,000 is twenty per cent", async () => {
    expect(await value(invented, 2021, "equity_ratio")).toBe(20);
  });

  it("takes a payout: 0.60 of 2.40 a share is twenty-five per cent", async () => {
    expect(await value(invented, 2021, "payout_ratio")).toBe(25);
  });

  it("converts cash: 500 of operating cash against 240 of profit is 208 per cent", async () => {
    // 500 ÷ 240 = 2.08333…, published at no decimals but stored in full.
    expect(await value(invented, 2021, "cash_conversion")).toBeCloseTo(208.333333, 5);
  });

  it("reinvests: 200 of capital spending on 1,200 of revenue is 16.7 per cent", async () => {
    expect(await value(invented, 2021, "capex_intensity")).toBeCloseTo(16.666667, 5);
  });

  it("divides the standardised figures, not the printed ones", async () => {
    // The awkward case that standardisation exists for: a filing whose income
            // statement is headed in millions and whose per-share figures are not.
    // 250,000 thousand over 1,000 million is a quarter, and a calculation over
    // the printed figures would make it 250.
    const mixed = await makeCompany("Mixed Scale Plc", "mixed-scale", "MXSC");
    const document = await makeDocument(mixed, "Mixed Scale Plc annual report");
    await enter({
      companyId: mixed,
      documentId: document,
      statementType: "income",
      year: 2023,
      magnitude: "millions",
      lines: [
        { line_item: "revenue", value_reported: 1000, source_page: 10 },
        { line_item: "profit_before_tax", value_reported: 300000, magnitude: "thousands", source_page: 10 },
        { line_item: "profit_after_tax", value_reported: 250000, magnitude: "thousands", source_page: 10 },
      ],
    });
    expect(await value(mixed, 2023, "net_margin")).toBe(25);
  });

  it("subtracts to reach a figure nobody reported: (5,000 − 4,600) of 500 is eighty per cent", async () => {
    const lender = await makeCompany("Worked Lender Plc", "worked-lender", "WLND");
    const document = await makeDocument(lender, "Worked Lender Plc annual report");
    await db.query("select public.assign_company_template($1, $2, 'bank', '2000-01-01', null)", [financial, lender]);
    await enter({
      companyId: lender,
      documentId: document,
      statementType: "balance_sheet",
      year: 2023,
      lines: [
        { line_item: "total_assets", value_reported: 20000, source_page: 30 },
        { line_item: "total_liabilities", value_reported: 18000, source_page: 30 },
        { line_item: "shareholders_equity", value_reported: 2000, source_page: 30 },
        { line_item: "gross_loans", value_reported: 5000, source_page: 31 },
        { line_item: "net_loans_and_advances", value_reported: 4600, source_page: 31 },
        { line_item: "non_performing_loans", value_reported: 500, source_page: 31 },
        { line_item: "customer_deposits", value_reported: 12000, source_page: 31 },
      ],
    });
    expect(await value(lender, 2023, "npl_coverage")).toBe(80);
  });
});

describe("a real filing: Zenith Bank Plc, FY2021 to FY2023", () => {
  beforeAll(async () => {
    // FY2021, from the five-year summary on printed page 214. A balance sheet
    // alone: this year is held so that FY2022's averages have an opening
    // balance, which is the only reason it is entered, and nothing about
    // FY2021's income statement is claimed from this filing.
    await enter({
      companyId: zenith,
      documentId: zenithDocument,
      statementType: "balance_sheet",
      year: 2021,
      magnitude: "millions",
      lines: [
        { line_item: "total_assets", value_reported: 9447843, source_page: 214 },
        { line_item: "total_liabilities", value_reported: 8168181, source_page: 214 },
        { line_item: "shareholders_equity", value_reported: 1278518, source_page: 214 },
        { line_item: "total_borrowings", value_reported: 750469, source_page: 214 },
        { line_item: "net_loans_and_advances", value_reported: 3355728, source_page: 214 },
        { line_item: "customer_deposits", value_reported: 6472054, source_page: 214 },
      ],
    });

    // FY2022, the comparative column of the primary statements, with gross
    // earnings from the five-year summary — a bank does not report "revenue",
    // and gross earnings is the figure the filing presents as its turnover.
    await enter({
      companyId: zenith,
      documentId: zenithDocument,
      statementType: "income",
      year: 2022,
      magnitude: "millions",
      lines: [
        { line_item: "revenue", value_reported: 945554, source_page: 215 },
        { line_item: "interest_income", value_reported: 540166, source_page: 39 },
        { line_item: "interest_expense", value_reported: 173539, presentation: "bracketed", source_page: 39 },
        { line_item: "net_interest_income", value_reported: 366627, source_page: 39 },
        { line_item: "loan_loss_impairment", value_reported: 123252, presentation: "bracketed", source_page: 39 },
        { line_item: "profit_before_tax", value_reported: 284650, source_page: 39 },
        { line_item: "income_tax_expense", value_reported: 60739, presentation: "bracketed", source_page: 39 },
        { line_item: "profit_after_tax", value_reported: 223911, source_page: 39 },
        { line_item: "earnings_per_share", value_reported: 7.14, source_page: 39 },
      ],
    });
    await enter({
      companyId: zenith,
      documentId: zenithDocument,
      statementType: "balance_sheet",
      year: 2022,
      magnitude: "millions",
      lines: [
        { line_item: "total_assets", value_reported: 12285629, source_page: 40 },
        { line_item: "total_liabilities", value_reported: 10906689, source_page: 40 },
        { line_item: "shareholders_equity", value_reported: 1378127, source_page: 40 },
        { line_item: "total_borrowings", value_reported: 963450, source_page: 40 },
        { line_item: "net_loans_and_advances", value_reported: 4013705, source_page: 40 },
        { line_item: "customer_deposits", value_reported: 8975653, source_page: 40 },
      ],
    });

    // FY2023, the reporting year of this filing.
    await enter({
      companyId: zenith,
      documentId: zenithDocument,
      statementType: "income",
      year: 2023,
      magnitude: "millions",
      lines: [
        { line_item: "revenue", value_reported: 2131750, source_page: 215 },
        { line_item: "interest_income", value_reported: 1144674, source_page: 39 },
        { line_item: "interest_expense", value_reported: 408492, presentation: "bracketed", source_page: 39 },
        { line_item: "net_interest_income", value_reported: 736182, source_page: 39 },
        { line_item: "loan_loss_impairment", value_reported: 409616, presentation: "bracketed", source_page: 39 },
        { line_item: "profit_before_tax", value_reported: 795962, source_page: 39 },
        { line_item: "income_tax_expense", value_reported: 119053, presentation: "bracketed", source_page: 39 },
        { line_item: "profit_after_tax", value_reported: 676909, source_page: 39 },
        { line_item: "earnings_per_share", value_reported: 21.55, source_page: 39 },
      ],
    });
    await enter({
      companyId: zenith,
      documentId: zenithDocument,
      statementType: "balance_sheet",
      year: 2023,
      magnitude: "millions",
      lines: [
        { line_item: "total_assets", value_reported: 20368455, source_page: 40 },
        { line_item: "total_liabilities", value_reported: 18045075, source_page: 40 },
        { line_item: "shareholders_equity", value_reported: 2321752, source_page: 40 },
        { line_item: "total_borrowings", value_reported: 1410885, source_page: 40 },
        { line_item: "net_loans_and_advances", value_reported: 6556470, source_page: 40 },
        { line_item: "customer_deposits", value_reported: 15167740, source_page: 40 },
      ],
    });
  }, 120_000);

  it("agrees with the filing's own five-year summary, which was prepared separately", async () => {
    // The primary statements are on pages 39 and 40; the five-year summary is on
    // 214 and 215 and restates the same year. Two pages of one filing agreeing
    // is the closest thing to an independent check this document offers, and it
    // is the check an analyst would do.
    const figures = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ line_item: string; value_standardised: string }>(
        `select line_item, value_standardised from public.approved_fy_figures
          where company_id = $1 and financial_year = 2023
            and line_item in ('profit_before_tax', 'profit_after_tax', 'total_assets', 'shareholders_equity')
          order by line_item`,
        [zenith],
      );
      return new Map(rows.map((r) => [r.line_item, Number(r.value_standardised)]));
    });

    // Five-Year Financial Summary, printed page 215: profit before taxation
    // 795,962 and profit after tax 676,909, in millions of naira.
    expect(figures.get("profit_before_tax")).toBe(795_962e6);
    expect(figures.get("profit_after_tax")).toBe(676_909e6);
    // Printed page 214: total assets 20,368,455 and equity attributable to
    // holders of the parent 2,321,752.
    expect(figures.get("total_assets")).toBe(20_368_455e6);
    expect(figures.get("shareholders_equity")).toBe(2_321_752e6);
  });

  it("computes FY2023 as a hand calculation does", async () => {
    // 676,909 ÷ 2,131,750 = 31.753677%
    expect(await value(zenith, 2023, "net_margin")).toBeCloseTo(31.753677, 5);
    // (2,131,750 − 945,554) ÷ 945,554 = 125.449842%
    expect(await value(zenith, 2023, "revenue_growth")).toBeCloseTo(125.449842, 5);
    // (676,909 − 223,911) ÷ 223,911 = 202.311633%
    expect(await value(zenith, 2023, "pat_growth")).toBeCloseTo(202.311633, 5);
    // (21.55 − 7.14) ÷ 7.14 = 201.820728%
    expect(await value(zenith, 2023, "eps_growth")).toBeCloseTo(201.820728, 5);
    // 676,909 ÷ ((20,368,455 + 12,285,629) ÷ 2) = 4.145938%
    expect(await value(zenith, 2023, "roa")).toBeCloseTo(4.145938, 5);
    // 1,410,885 ÷ 2,321,752 = 0.607681 times
    expect(await value(zenith, 2023, "debt_to_equity")).toBeCloseTo(0.607681, 5);
    // 2,321,752 ÷ 20,368,455 = 11.398763%
    expect(await value(zenith, 2023, "equity_ratio")).toBeCloseTo(11.398763, 5);
    // 6,556,470 ÷ 15,167,740 = 43.226413%
    expect(await value(zenith, 2023, "loan_to_deposit")).toBeCloseTo(43.226413, 5);
    // 736,182 ÷ ((20,368,455 + 12,285,629) ÷ 2) = 4.508974%
    expect(await value(zenith, 2023, "net_interest_margin_calculated")).toBeCloseTo(4.508974, 5);
  });

  it("computes FY2022 too, because FY2021's balance sheet was entered", async () => {
    // 223,911 ÷ ((12,285,629 + 9,447,843) ÷ 2) = 2.060518%
    expect(await value(zenith, 2022, "roa")).toBeCloseTo(2.060518, 5);
  });

  it("waits for the profit attributable to the parent before reporting a return on equity", async () => {
    // The filing prints it on page 39, beside the group's profit after tax, and
    // until it is entered from that page there is no return on equity. The
    // group's profit after tax is not a substitute: it includes the
    // non-controlling interest, and the equity it would be divided by does not.
    for (const year of [2022, 2023]) {
      const roe = await answer(zenith, year, "roe");
      expect(roe?.status).toBe("not_available");
      expect(roe?.reason).toBe("input_missing");
    }
  });

  it("has no return on equity for FY2021, and says why", async () => {
    // FY2021 is held as a balance sheet alone, so it has no opening balance
    // before it. The prior-period reason comes first, because it is the one a
    // reader can act on.
    const roe = await answer(zenith, 2021, "roe");
    expect(roe?.status).toBe("not_available");
    expect(roe?.reason).toBe("no_prior_period");
  });

  it("says what it is waiting for rather than inventing it", async () => {
    // This filing does not present a single total operating expenses line, nor
    // total operating income, so the cost-to-income ratio has no honest derived
    // answer and reads as pending rather than as an estimate. The figures it
    // wants are reported lines somebody must enter from a page, which is
    // exactly what the reason is for.
    const cost = await answer(zenith, 2023, "cost_to_income_calculated");
    expect(cost?.status).toBe("not_available");
    expect(cost?.reason).toBe("input_missing");

    // Likewise the ratios that need figures from the notes rather than the face
    // of the statements.
    const coverage = await answer(zenith, 2023, "npl_coverage");
    expect(coverage?.status).toBe("not_available");
    expect(coverage?.reason).toBe("input_missing");

    // And the five-year compound rate, over a history that holds three years.
    // A five-year rate spans four years of compounding; this one would span two,
    // so there is no answer rather than a two-year change published under the
    // name of five.
    const cagr = await answer(zenith, 2023, "revenue_cagr_5y");
    expect(cagr?.status).toBe("not_available");
    expect(cagr?.reason).toBe("insufficient_history");
  });

  it("carries every figure it used back to a page of the filing", async () => {
    const inputs = await asUser(db, reader, async () => {
      const { rows } = await db.query<{
        line_item: string;
        period_role: string;
        source_page: number;
        title: string;
      }>(
        `select i.line_item, i.period_role, i.source_page, d.title
           from public.company_metric_inputs i
           join public.documents d on d.id = i.document_id
          where i.company_id = $1 and i.financial_year = 2023 and i.code = 'roa'
          order by i.role, i.period_role`,
        [zenith],
      );
      return rows;
    });

    expect(inputs).toHaveLength(3);
    expect(inputs.every((row) => row.title.startsWith("Zenith Bank Plc"))).toBe(true);
    // Profit after tax from the face of the income statement, printed page 39;
    // equity at both balance-sheet dates from page 40.
    expect(inputs.find((row) => row.line_item === "profit_after_tax")?.source_page).toBe(39);
    expect(
      inputs.filter((row) => row.line_item === "total_assets").map((row) => row.source_page),
    ).toEqual([40, 40]);
  });
});
