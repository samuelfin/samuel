import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";
import {
  type Magnitude,
  type Presentation,
  type StandardSign,
  type UnitKind,
  STANDARD_SIGNS,
  STATEMENT_TYPES,
  UNIT_KINDS,
  magnitudeApplies,
  standardisePreview,
} from "@/lib/financials/validation";

/**
 * Stage 3c is the first place this platform publishes a number rather than a
 * description, and three guarantees carry most of the weight.
 *
 * The reported figure and the standardised figure are both kept, and the
 * standardised one is computed by the database rather than supplied — a value
 * the caller calculated is a value the caller could get wrong, and the two
 * columns would then disagree with nothing to say which was true.
 *
 * Standardisation means exactly three things: the canonical line item, the
 * magnitude, and the sign. Filings do not share a sign convention — a cement
 * company brackets its cost of sales, a bank prints interest expense plain — so
 * the convention lives in the catalogue and is applied on the way in.
 *
 * And a figure is entered whole or not at all. A statement missing a line its
 * template requires is a filing read in part, and a reviewer approving one would
 * publish a figure set nobody read in full.
 */

let db: PGlite;
let financial: string;
let checker: string;
let admin: string;
let analyst: string;
let editor: string;
let reader: string;

let generic: string;
let bank: string;
let cement: string;
let pendingCompany: string;
let genericDocument: string;
let bankDocument: string;
let cementDocument: string;

beforeAll(async () => {
  db = await createTestDatabase();
  financial = await createUser(db, { staff: ["financial_analyst"] });
  checker = await createUser(db, { staff: ["financial_analyst"] });
  admin = await createUser(db, { admin: true });
  analyst = await createUser(db, { staff: ["analyst"] });
  editor = await createUser(db, { staff: ["editor"] });
  reader = await createUser(db);

  // The default company for tests about figures themselves: approved, with no
  // sector template, so a statement needs only the core lines.
  generic = await makeCompany("Figures Industries Plc", "figures-industries", "FIGI");
  bank = await makeCompany("Figures Bank Plc", "figures-bank", "FIGB");
  cement = await makeCompany("Figures Cement Plc", "figures-cement", "FIGC");
  pendingCompany = await makeCompany("Unreviewed Issuer Plc", "unreviewed-issuer", "UNRV", false);

  await db.query("select public.assign_company_template($1, $2, 'bank', '2000-01-01', null)", [financial, bank]);
  await db.query("select public.assign_company_template($1, $2, 'cement_industrial', '2000-01-01', null)", [
    financial,
    cement,
  ]);

  // Licences before display, and it applies to figures too. The statements
  // policy tests is_displayable_source, so an issuer's own filings only become
  // readable once someone has recorded the terms under which SFI may show them
  // and switched the dataset on. The real project needs this row as much as the
  // test does.
  const { rows: licence } = await db.query<{ id: string }>(
    `insert into public.data_licences (provider_id, product, status, allows_display)
     values ('issuer_ir', 'Issuer-published filings', 'active', true) returning id`,
  );
  await db.query("update public.datasets set licence_id = $1, is_active = true where id = 'companies.documents'", [
    licence[0].id,
  ]);

  genericDocument = await makeDocument(generic);
  bankDocument = await makeDocument(bank);
  cementDocument = await makeDocument(cement);
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

async function makeDocument(
  companyId: string | null,
  opts: { approve?: boolean; licence?: string } = {},
): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 4096, $5, $6, $7
     ) as id`,
    [
      analyst,
      `Annual report ${counter}`,
      `fin/doc-${counter}.pdf`,
      sha256(`financials-${counter}`),
      opts.licence ?? "issuer_document",
      companyId,
      `https://issuer.test/annual-${counter}.pdf`,
    ],
  );
  const id = rows[0].id;
  if (opts.approve !== false) {
    await db.query("select public.review_document($1, $2, 'approved')", [id, admin]);
  }
  return id;
}

interface LineInput {
  line_item: string;
  value_reported: number;
  presentation?: string;
  magnitude?: string | null;
  source_page?: number;
  as_restated?: boolean;
  ai_assisted?: boolean;
  note?: string | null;
}

interface StatementInput {
  actor?: string;
  companyId?: string;
  statementType?: string;
  periodType?: string;
  periodStart?: string;
  periodEnd?: string;
  audited?: boolean;
  consolidated?: boolean;
  currency?: string;
  magnitude?: string;
  documentId?: string;
  lines?: LineInput[];
  publishedAt?: string | null;
  supersedes?: string | null;
  restatementKind?: string | null;
  reason?: string | null;
}

/** The full income statement the core template requires, so a test can change one thing. */
function coreIncomeLines(page = 40): LineInput[] {
  return [
    { line_item: "revenue", value_reported: 1000, source_page: page },
    { line_item: "profit_before_tax", value_reported: 300, source_page: page },
    { line_item: "profit_after_tax", value_reported: 200, source_page: page },
  ];
}

/**
 * A bank's income statement. The bank template requires interest income,
 * interest expense and net interest income, which is the point of having
 * templates at all: a filing read without them has not been read.
 */
function bankIncomeLines(page = 40): LineInput[] {
  return [
    ...coreIncomeLines(page),
    { line_item: "interest_income", value_reported: 800, source_page: page },
    { line_item: "interest_expense", value_reported: 300, presentation: "bracketed", source_page: page },
    { line_item: "net_interest_income", value_reported: 500, source_page: page },
  ];
}

function coreBalanceLines(page = 60): LineInput[] {
  return [
    { line_item: "total_assets", value_reported: 9000, source_page: page },
    { line_item: "total_liabilities", value_reported: 7000, source_page: page },
    { line_item: "shareholders_equity", value_reported: 2000, source_page: page },
  ];
}

async function recordStatement(opts: StatementInput = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.record_statement(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16
     ) as id`,
    [
      opts.actor ?? financial,
      opts.companyId ?? generic,
      opts.statementType ?? "income",
      opts.periodType ?? "FY",
      opts.periodStart ?? "2024-01-01",
      opts.periodEnd ?? "2024-12-31",
      opts.audited === undefined ? true : opts.audited,
      opts.consolidated === undefined ? true : opts.consolidated,
      opts.currency ?? "NGN",
      opts.magnitude ?? "thousands",
      opts.documentId === undefined ? genericDocument : opts.documentId,
      JSON.stringify(opts.lines ?? coreIncomeLines()),
      opts.publishedAt ?? null,
      opts.supersedes ?? null,
      opts.restatementKind ?? null,
      opts.reason ?? null,
    ],
  );
  return rows[0].id;
}

async function lineOf(statementId: string, lineItem: string) {
  const { rows } = await db.query<{
    value_standardised: string;
    value_reported: string;
    reported_magnitude: string;
    reported_presentation: string;
    source_page: number;
    ai_assisted: boolean;
    as_restated: boolean;
  }>(
    `select value_standardised, value_reported, reported_magnitude, reported_presentation,
            source_page, ai_assisted, as_restated
       from public.financial_statement_lines where statement_id = $1 and line_item = $2`,
    [statementId, lineItem],
  );
  return rows[0];
}

/** A distinct period per test, so one test's statement never supersedes another's. */
let year = 2000;
function nextYear(): { periodStart: string; periodEnd: string } {
  year += 1;
  return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
}

describe("the catalogue and the templates", () => {
  it("define every line once, with its own unit and sign convention", async () => {
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.statement_line_catalogue",
    );
    expect(rows[0].n).toBeGreaterThan(50);

    const { rows: revenue } = await db.query<{ unit_kind: string; standard_sign: string; statement_type: string }>(
      "select unit_kind, standard_sign, statement_type from public.statement_line_catalogue where line_item = 'revenue'",
    );
    expect(revenue[0]).toEqual({ unit_kind: "currency", standard_sign: "positive", statement_type: "income" });

    const { rows: cost } = await db.query<{ standard_sign: string }>(
      "select standard_sign from public.statement_line_catalogue where line_item = 'cost_of_sales'",
    );
    expect(cost[0].standard_sign).toBe("negative");
  });

  it("holds the six sector sets plus the core set", async () => {
    const { rows } = await db.query<{ id: string; scope: string }>(
      "select id, scope from public.statement_templates order by sort_order",
    );
    expect(rows.map((r) => r.id)).toEqual([
      "core",
      "bank",
      "telecoms",
      "cement_industrial",
      "food_consumer",
      "oil_gas",
      "power_utilities",
    ]);
    expect(rows.filter((r) => r.scope === "core").map((r) => r.id)).toEqual(["core"]);
  });

  /**
   * The rule that separates a disclosure from a calculation. A bank's NPL ratio
   * is in the catalogue because the bank publishes it under its regulator's
   * definition and it cites a page. Revenue growth and ROE are not, because they
   * are arithmetic over other lines — entering one here would let a calculation
   * claim a page reference it does not have.
   */
  it("catalogues disclosed ratios and excludes computed ones", async () => {
    const { rows } = await db.query<{ line_item: string }>(
      `select line_item from public.statement_line_catalogue
        where line_item in ('npl_ratio', 'capital_adequacy_ratio', 'cost_to_income_ratio', 'net_interest_margin',
                            'revenue_growth', 'return_on_equity', 'return_on_assets', 'net_profit_margin',
                            'dividend_yield', 'price_to_earnings')
        order by line_item`,
    );
    expect(rows.map((r) => r.line_item)).toEqual([
      "capital_adequacy_ratio",
      "cost_to_income_ratio",
      "net_interest_margin",
      "npl_ratio",
    ]);
  });

  it("puts a bank's lines on the bank template and not on the core one", async () => {
    const { rows } = await db.query<{ template_id: string }>(
      "select template_id from public.statement_template_lines where line_item = 'net_interest_income'",
    );
    expect(rows.map((r) => r.template_id)).toEqual(["bank"]);
  });
});

describe("recording a statement", () => {
  it("stores the reported figure and the standardised figure side by side", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    const revenue = await lineOf(statement, "revenue");

    expect(Number(revenue.value_reported)).toBe(1000);
    // ₦'000 as printed, absolute units once standardised.
    expect(Number(revenue.value_standardised)).toBe(1_000_000);
    expect(revenue.reported_magnitude).toBe("thousands");
    expect(revenue.source_page).toBe(40);
  });

  it("records who entered it, the template and the original reading", async () => {
    const period = nextYear();
    const statement = await recordStatement({
      ...period,
      companyId: bank,
      documentId: bankDocument,
      lines: bankIncomeLines(),
    });
    const { rows } = await db.query<{
      entered_by: string;
      template_id: string;
      version: number;
      restatement_kind: string;
      review_status: string;
      ai_assisted: boolean;
    }>(
      `select entered_by, template_id, version, restatement_kind, review_status, ai_assisted
         from public.financial_statements where id = $1`,
      [statement],
    );
    expect(rows[0]).toEqual({
      entered_by: financial,
      template_id: "bank",
      version: 1,
      restatement_kind: "original",
      review_status: "pending",
      ai_assisted: false,
    });
  });

  it("reads a bracketed figure as negative", async () => {
    const period = nextYear();
    const statement = await recordStatement({
      ...period,
      companyId: cement,
      documentId: cementDocument,
      lines: [
        ...coreIncomeLines(),
        { line_item: "cost_of_sales", value_reported: 400, presentation: "bracketed", source_page: 41 },
      ],
    });
    const cost = await lineOf(statement, "cost_of_sales");
    expect(Number(cost.value_reported)).toBe(400);
    expect(Number(cost.value_standardised)).toBe(-400_000);
    expect(cost.reported_presentation).toBe("bracketed");
  });

  /**
   * The point of the sign convention. Two filings present the same fact two
   * ways; both must land on the same standardised value, or a sum over an income
   * statement depends on whose typesetter was involved.
   */
  it("normalises a cost line typed plain to the same value as one typed bracketed", async () => {
    const plainPeriod = nextYear();
    const plain = await recordStatement({
      ...plainPeriod,
      companyId: cement,
      documentId: cementDocument,
      lines: [...coreIncomeLines(), { line_item: "cost_of_sales", value_reported: 400, source_page: 41 }],
    });
    const bracketPeriod = nextYear();
    const bracketed = await recordStatement({
      ...bracketPeriod,
      companyId: cement,
      documentId: cementDocument,
      lines: [
        ...coreIncomeLines(),
        { line_item: "cost_of_sales", value_reported: 400, presentation: "bracketed", source_page: 41 },
      ],
    });
    const a = await lineOf(plain, "cost_of_sales");
    const b = await lineOf(bracketed, "cost_of_sales");
    expect(Number(a.value_standardised)).toBe(Number(b.value_standardised));
    expect(Number(a.value_standardised)).toBeLessThan(0);
    // The reported column still distinguishes them, which is how a reviewer
    // tells a sign error from a transcription error.
    expect(a.reported_presentation).toBe("plain");
    expect(b.reported_presentation).toBe("bracketed");
  });

  it("refuses a negative figure on a line that cannot be negative", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        lines: [{ line_item: "revenue", value_reported: 1000, presentation: "bracketed", source_page: 40 }],
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/cannot be negative/);
  });

  it("keeps a loss negative, because profit is genuinely either", async () => {
    const period = nextYear();
    const statement = await recordStatement({
      ...period,
      lines: [
        { line_item: "revenue", value_reported: 1000, source_page: 40 },
        { line_item: "profit_before_tax", value_reported: 150, presentation: "bracketed", source_page: 40 },
        { line_item: "profit_after_tax", value_reported: 150, presentation: "bracketed", source_page: 40 },
      ],
    });
    expect(Number((await lineOf(statement, "profit_after_tax")).value_standardised)).toBe(-150_000);
  });

  /**
   * The error this separation exists to prevent: a statement headed ₦'000 does
   * not make earnings per share a thousand naira, and it does not make a
   * disclosed percentage 20,000%.
   */
  it("applies the statement's magnitude to money and not to a ratio or a per-share figure", async () => {
    const period = nextYear();
    const income = await recordStatement({
      ...period,
      lines: [...coreIncomeLines(), { line_item: "earnings_per_share", value_reported: 4.25, source_page: 42 }],
    });
    expect(Number((await lineOf(income, "earnings_per_share")).value_standardised)).toBe(4.25);
    expect((await lineOf(income, "earnings_per_share")).reported_magnitude).toBe("units");

    const operating = await recordStatement({
      ...period,
      companyId: bank,
      documentId: bankDocument,
      statementType: "operating",
      lines: [{ line_item: "npl_ratio", value_reported: 4.3, source_page: 90 }],
    });
    expect(Number((await lineOf(operating, "npl_ratio")).value_standardised)).toBe(4.3);
  });

  it("takes a per-line magnitude where a filing states subscribers in millions", async () => {
    const period = nextYear();
    const telecom = await makeCompany("Figures Telecom Plc", "figures-telecom", "FIGT");
    await db.query("select public.assign_company_template($1, $2, 'telecoms', '2000-01-01', null)", [
      financial,
      telecom,
    ]);
    const document = await makeDocument(telecom);
    const statement = await recordStatement({
      ...period,
      companyId: telecom,
      documentId: document,
      statementType: "operating",
      lines: [
        { line_item: "total_subscribers", value_reported: 77.5, magnitude: "millions", source_page: 12 },
      ],
    });
    const subscribers = await lineOf(statement, "total_subscribers");
    expect(Number(subscribers.value_reported)).toBe(77.5);
    expect(Number(subscribers.value_standardised)).toBe(77_500_000);
    expect(subscribers.reported_magnitude).toBe("millions");
  });

  /**
   * A balance sheet that does not foot is still what the filing says. The desk
   * warns about it, because a reviewer should look; the database accepts it,
   * because refusing it would make the stored figures disagree with the page.
   */
  it("accepts a balance sheet whose figures do not add up", async () => {
    const period = nextYear();
    const statement = await recordStatement({
      ...period,
      statementType: "balance_sheet",
      lines: [
        ...coreBalanceLines(),
        // 9000 ≠ 7000 + 2500, and this is the filing's arithmetic, not ours.
        { line_item: "total_borrowings", value_reported: 2500, source_page: 61 },
      ],
    });
    expect(Number((await lineOf(statement, "total_assets")).value_standardised)).toBe(9_000_000);
    expect(Number((await lineOf(statement, "total_borrowings")).value_standardised)).toBe(2_500_000);
  });

  /**
   * The fault the security review found. A percentage carries no scale -- an NPL
   * ratio of 5 is five per cent whatever heading sits above the column -- and
   * storing it as billions put 5,000,000,000 in the register while the desk
   * showed 5. Refused now, rather than ignored, because a silently dropped value
   * is how a preview and what is stored come to disagree.
   */
  it("refuses a scale on a percentage or a per-share figure", async () => {
    const ratio = nextYear();
    const percentError = await expectSqlError(
      recordStatement({
        ...ratio,
        companyId: bank,
        documentId: bankDocument,
        statementType: "operating",
        lines: [{ line_item: "npl_ratio", value_reported: 5, magnitude: "billions", source_page: 90 }],
      }),
    );
    expect(percentError.code).toBe("23514");
    expect(percentError.message).toMatch(/carries no scale/);

    const perShare = nextYear();
    const shareError = await expectSqlError(
      recordStatement({
        ...perShare,
        lines: [
          ...coreIncomeLines(),
          { line_item: "earnings_per_share", value_reported: 4.25, magnitude: "thousands", source_page: 42 },
        ],
      }),
    );
    expect(shareError.code).toBe("23514");
    expect(shareError.message).toMatch(/carries no scale/);
  });

  it("still lets a count or a quantity carry the scale the filing printed", async () => {
    const period = nextYear();
    const statement = await recordStatement({
      ...period,
      statementType: "operating",
      lines: [{ line_item: "shares_outstanding", value_reported: 31.4, magnitude: "billions", source_page: 44 }],
    });
    const shares = await lineOf(statement, "shares_outstanding");
    expect(Number(shares.value_standardised)).toBe(31_400_000_000);
    expect(shares.reported_magnitude).toBe("billions");
  });

  it("accepts an explicit units scale on a percentage, which changes nothing", async () => {
    const period = nextYear();
    const statement = await recordStatement({
      ...period,
      companyId: bank,
      documentId: bankDocument,
      statementType: "operating",
      lines: [{ line_item: "npl_ratio", value_reported: 4.3, magnitude: "units", source_page: 90 }],
    });
    expect(Number((await lineOf(statement, "npl_ratio")).value_standardised)).toBe(4.3);
  });

  it("flags the statement as AI-assisted when any single figure was", async () => {
    const period = nextYear();
    const statement = await recordStatement({
      ...period,
      lines: [
        { line_item: "revenue", value_reported: 1000, source_page: 40 },
        { line_item: "profit_before_tax", value_reported: 300, source_page: 40 },
        { line_item: "profit_after_tax", value_reported: 200, source_page: 40, ai_assisted: true },
      ],
    });
    const { rows } = await db.query<{ ai_assisted: boolean }>(
      "select ai_assisted from public.financial_statements where id = $1",
      [statement],
    );
    expect(rows[0].ai_assisted).toBe(true);
    expect((await lineOf(statement, "revenue")).ai_assisted).toBe(false);
    expect((await lineOf(statement, "profit_after_tax")).ai_assisted).toBe(true);
  });
});

/**
 * The desk shows the analyst the figure that is about to be stored, which means
 * the standardisation rule exists twice — once in record_statement and once in
 * lib/financials/validation.ts. Two implementations of one rule drift, so this
 * runs the same cases through both and requires them to agree. A preview that
 * disagrees with what is stored is worse than no preview.
 */
describe("the desk's preview agrees with what the database stores", () => {
  const cases: Array<{ item: string; raw: number; presentation?: string; magnitude?: string; sign: StandardSign }> = [
    { item: "revenue", raw: 1000, sign: "positive" },
    { item: "revenue", raw: 1234.56, sign: "positive" },
    { item: "cost_of_sales", raw: 400, sign: "negative" },
    { item: "cost_of_sales", raw: 400, presentation: "bracketed", sign: "negative" },
    { item: "cost_of_sales", raw: -400, presentation: "negative", sign: "negative" },
    { item: "profit_after_tax", raw: 200, sign: "signed" },
    { item: "profit_after_tax", raw: 150, presentation: "bracketed", sign: "signed" },
    { item: "earnings_per_share", raw: 4.25, sign: "signed" },
    { item: "earnings_per_share", raw: 1.5, presentation: "bracketed", sign: "signed" },
    { item: "total_assets", raw: 9000, magnitude: "billions", sign: "positive" },
    { item: "shareholders_equity", raw: 2000, presentation: "bracketed", sign: "signed" },
  ];

  it.each(cases)("$item $raw $presentation $magnitude", async ({ item, raw, presentation, magnitude, sign }) => {
    const period = nextYear();
    const statementType = ["total_assets", "shareholders_equity"].includes(item) ? "balance_sheet" : "income";
    const lines: LineInput[] =
      statementType === "balance_sheet"
        ? [
            ...coreBalanceLines().filter((l) => l.line_item !== item),
            { line_item: item, value_reported: raw, presentation, magnitude, source_page: 60 },
          ]
        : [
            ...coreIncomeLines().filter((l) => l.line_item !== item),
            { line_item: item, value_reported: raw, presentation, magnitude, source_page: 40 },
          ];

    const statement = await recordStatement({ ...period, statementType, lines });
    const stored = await lineOf(statement, item);

    const preview = standardisePreview({
      value: raw,
      presentation: (presentation ?? "plain") as Presentation,
      magnitude: (stored.reported_magnitude ?? "units") as Magnitude,
      standardSign: sign,
    });
    expect(preview).not.toBeNull();
    expect(Number(stored.value_standardised)).toBe(preview);
  });

  it("refuses in both places where a figure cannot be negative", async () => {
    expect(
      standardisePreview({
        value: 1000,
        presentation: "bracketed",
        magnitude: "thousands",
        standardSign: "positive",
      }),
    ).toBeNull();

    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        lines: [{ line_item: "revenue", value_reported: 1000, presentation: "bracketed", source_page: 40 }],
      }),
    );
    expect(error.code).toBe("23514");
  });

  it("agrees about which lines the scale applies to", async () => {
    const { rows } = await db.query<{ line_item: string; unit_kind: string }>(
      "select line_item, unit_kind from public.statement_line_catalogue order by line_item",
    );
    for (const row of rows) {
      const applies = magnitudeApplies(row.unit_kind as UnitKind);
      expect(applies, row.line_item).toBe(row.unit_kind === "currency" || row.unit_kind === "currency_per_unit");
    }
  });

  /**
   * The catalogue's vocabulary and the module's must be the same vocabulary. A
   * seventh unit kind added as a row would otherwise reach a client that cannot
   * describe it, and the desk would silently treat it as a quantity.
   */
  it("shares its vocabulary with the catalogue", async () => {
    const { rows: kinds } = await db.query<{ unit_kind: string }>(
      "select distinct unit_kind from public.statement_line_catalogue",
    );
    for (const row of kinds) {
      expect(UNIT_KINDS as readonly string[], row.unit_kind).toContain(row.unit_kind);
    }
    const { rows: signs } = await db.query<{ standard_sign: string }>(
      "select distinct standard_sign from public.statement_line_catalogue",
    );
    for (const row of signs) {
      expect(STANDARD_SIGNS as readonly string[], row.standard_sign).toContain(row.standard_sign);
    }
    const { rows: types } = await db.query<{ statement_type: string }>(
      "select distinct statement_type from public.statement_line_catalogue",
    );
    for (const row of types) {
      expect(STATEMENT_TYPES as readonly string[], row.statement_type).toContain(row.statement_type);
    }
  });
});

describe("what a statement will not accept", () => {
  it("needs the page of the filing for every figure", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        lines: [{ line_item: "revenue", value_reported: 1000 }],
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/needs the page/);
  });

  it("needs a reported value, and will not read one from a string", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      db.query(
        `select public.record_statement(
           $1, $2, 'income', 'FY', $3, $4, true, true, 'NGN', 'thousands', $5,
           '[{"line_item": "revenue", "value_reported": "1000", "source_page": 40}]'::jsonb,
           null, null, null, null
         )`,
        [financial, bank, period.periodStart, period.periodEnd, bankDocument],
      ),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/needs a reported value/);
  });

  it("refuses a figure that is not in the catalogue", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        lines: [...coreIncomeLines(), { line_item: "adjusted_underlying_profit", value_reported: 1, source_page: 4 }],
      }),
    );
    expect(error.code).toBe("23503");
    expect(error.message).toMatch(/no figure called/);
  });

  it("refuses a balance-sheet line inside an income statement", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        lines: [...coreIncomeLines(), { line_item: "total_assets", value_reported: 10, source_page: 60 }],
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/belongs to the balance_sheet statement/);
  });

  it("refuses a bank's figure on a cement company", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        companyId: cement,
        documentId: cementDocument,
        lines: [...coreIncomeLines(), { line_item: "interest_income", value_reported: 10, source_page: 40 }],
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/not part of this company's template \(cement_industrial\)/);
  });

  it("refuses a sector figure when the company has no template for that period", async () => {
    const period = nextYear();
    const unassigned = await makeCompany("No Template Plc", "no-template", "NOTM");
    const document = await makeDocument(unassigned);
    const error = await expectSqlError(
      recordStatement({
        ...period,
        companyId: unassigned,
        documentId: document,
        lines: [...coreIncomeLines(), { line_item: "interest_income", value_reported: 10, source_page: 40 }],
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/no template assigned/);
  });

  it("still accepts core figures for a company with no sector template", async () => {
    const period = nextYear();
    const unassigned = await makeCompany("Core Only Plc", "core-only", "CORO");
    const document = await makeDocument(unassigned);
    const statement = await recordStatement({
      ...period,
      companyId: unassigned,
      documentId: document,
    });
    const { rows } = await db.query<{ template_id: string | null }>(
      "select template_id from public.financial_statements where id = $1",
      [statement],
    );
    expect(rows[0].template_id).toBeNull();
  });

  it("refuses the same figure twice in one statement", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        lines: [...coreIncomeLines(), { line_item: "revenue", value_reported: 2000, source_page: 41 }],
      }),
    );
    expect(error.code).toBe("23505");
    expect(error.message).toMatch(/appears twice/);
  });

  /**
   * A filing read in part must not become a statement at all. The function
   * raises after the rows are inserted, so this also pins that the whole call is
   * one transaction — a partial statement left behind would be approvable.
   */
  it("refuses a statement missing a required line, and leaves nothing behind", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...period,
        lines: [{ line_item: "revenue", value_reported: 1000, source_page: 40 }],
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/missing figures the template requires/);
    expect(error.message).toMatch(/Profit before tax/);

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.financial_statements where company_id = $1 and period_end = $2",
      [generic, period.periodEnd],
    );
    expect(rows[0].n).toBe(0);
  });

  it("requires an approved document with a verifiable licence", async () => {
    const period = nextYear();
    const unapproved = await makeDocument(bank, { approve: false });
    const unapprovedError = await expectSqlError(
      recordStatement({ ...period, documentId: unapproved }),
    );
    expect(unapprovedError.code).toBe("23514");
    expect(unapprovedError.message).toMatch(/approved document/);

    const unverified = await makeDocument(bank, { licence: "unverified" });
    const licenceError = await expectSqlError(recordStatement({ ...period, documentId: unverified }));
    expect(licenceError.code).toBe("23514");
    expect(licenceError.message).toMatch(/licence is unverified/);
  });

  it("will not take a figure with no document at all", async () => {
    const period = nextYear();
    const error = await expectSqlError(recordStatement({ ...period, documentId: null as unknown as string }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/resolves to a document and a page/);
  });

  it("needs a period with a later end than its start", async () => {
    const error = await expectSqlError(
      recordStatement({ periodStart: "2024-12-31", periodEnd: "2024-01-01" }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/needs a start and a later end/);
  });

  it("needs at least one figure", async () => {
    const period = nextYear();
    const error = await expectSqlError(recordStatement({ ...period, lines: [] }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/at least one figure/);
  });
});

describe("corrections and restatements", () => {
  it("separates the issuer restating its figures from this desk correcting its own", async () => {
    const period = nextYear();
    const original = await recordStatement({ ...period });
    await db.query("select public.review_statement($1, $2, 'approved')", [original, checker]);

    const restated = await recordStatement({
      ...period,
      lines: coreIncomeLines(),
      supersedes: original,
      restatementKind: "issuer_restated",
      reason: "The 2024 annual report restates the prior year after a change in accounting policy.",
    });
    const { rows } = await db.query<{ version: number; restatement_kind: string; correction_reason: string }>(
      "select version, restatement_kind, correction_reason from public.financial_statements where id = $1",
      [restated],
    );
    expect(rows[0].version).toBe(2);
    expect(rows[0].restatement_kind).toBe("issuer_restated");
    expect(rows[0].correction_reason).toMatch(/accounting policy/);
  });

  it("insists a new version says which kind it is, and why", async () => {
    const period = nextYear();
    const original = await recordStatement({ ...period });

    const unnamed = await expectSqlError(recordStatement({ ...period, supersedes: original }));
    expect(unnamed.code).toBe("23514");
    expect(unnamed.message).toMatch(/the issuer restated its figures, or this desk is correcting/);

    const unexplained = await expectSqlError(
      recordStatement({ ...period, supersedes: original, restatementKind: "sfi_correction" }),
    );
    expect(unexplained.code).toBe("23514");
    expect(unexplained.message).toMatch(/Say why the figures are changing/);
  });

  it("refuses a first entry that claims to be a restatement", async () => {
    const period = nextYear();
    const error = await expectSqlError(
      recordStatement({ ...period, restatementKind: "issuer_restated", reason: "Because." }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/original reading of the filing/);
  });

  it("refuses a new version that describes a different period or company", async () => {
    const period = nextYear();
    const original = await recordStatement({ ...period });
    const other = nextYear();
    const error = await expectSqlError(
      recordStatement({
        ...other,
        supersedes: original,
        restatementKind: "sfi_correction",
        reason: "Typed the wrong year.",
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/same company, statement, period and basis/);
  });

  it("supersedes the previous approved version when the new one is approved", async () => {
    const period = nextYear();
    const original = await recordStatement({ ...period });
    await db.query("select public.review_statement($1, $2, 'approved')", [original, checker]);
    const corrected = await recordStatement({
      ...period,
      supersedes: original,
      restatementKind: "sfi_correction",
      reason: "Revenue was read from the wrong column.",
    });
    await db.query("select public.review_statement($1, $2, 'approved')", [corrected, checker]);

    const { rows } = await db.query<{ id: string; review_status: string; version: number }>(
      "select id, review_status, version from public.financial_statements where company_id = $1 and period_end = $2 order by version",
      [generic, period.periodEnd],
    );
    expect(rows.map((r) => [r.version, r.review_status])).toEqual([
      [1, "superseded"],
      [2, "approved"],
    ]);
  });
});

describe("maker and checker", () => {
  it("flags a statement the entering analyst approved themselves", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    await db.query("select public.review_statement($1, $2, 'approved')", [statement, financial]);
    const { rows } = await db.query<{ review_self_approved: boolean; reviewed_by: string }>(
      "select review_self_approved, reviewed_by from public.financial_statements where id = $1",
      [statement],
    );
    expect(rows[0]).toEqual({ review_self_approved: true, reviewed_by: financial });
  });

  it("does not flag one a second person checked", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    await db.query("select public.review_statement($1, $2, 'approved')", [statement, checker]);
    const { rows } = await db.query<{ review_self_approved: boolean }>(
      "select review_self_approved from public.financial_statements where id = $1",
      [statement],
    );
    expect(rows[0].review_self_approved).toBe(false);
  });

  it("blocks self-approval once two-person review is switched on", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    await db.query(
      "update public.platform_settings set value = 'true'::jsonb where key = 'review.require_two_person'",
    );
    try {
      const error = await expectSqlError(
        db.query("select public.review_statement($1, $2, 'approved')", [statement, financial]),
      );
      expect(error.code).toBe("42501");
      expect(error.message).toMatch(/Someone other than the person who entered these figures/);
      // The switch is a setting, not a code change: the second pair of eyes works.
      await db.query("select public.review_statement($1, $2, 'approved')", [statement, checker]);
    } finally {
      await db.query(
        "update public.platform_settings set value = 'false'::jsonb where key = 'review.require_two_person'",
      );
    }
  });

  it("needs a reason to reject, and will not review the same statement twice", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    const noReason = await expectSqlError(
      db.query("select public.review_statement($1, $2, 'rejected')", [statement, checker]),
    );
    expect(noReason.code).toBe("23514");
    expect(noReason.message).toMatch(/Say why the figures are being rejected/);

    await db.query("select public.review_statement($1, $2, 'rejected', 'Figures do not match the filing.')", [
      statement,
      checker,
    ]);
    const again = await expectSqlError(
      db.query("select public.review_statement($1, $2, 'approved')", [statement, checker]),
    );
    expect(again.code).toBe("23514");
    expect(again.message).toMatch(/already been rejected/);
  });
});

describe("who may enter figures", () => {
  it("admits platform admins and the financial_analyst role only", async () => {
    const period = nextYear();
    const asAdmin = await recordStatement({ ...period, actor: admin });
    expect(asAdmin).toBeTruthy();

    for (const [label, actor] of [
      ["an analyst", analyst],
      ["an editor", editor],
      ["a reader", reader],
    ] as const) {
      const other = nextYear();
      const error = await expectSqlError(recordStatement({ ...other, actor }));
      expect(error.code, label).toBe("42501");
      expect(error.message).toMatch(/may not enter financial figures/);
    }
  });

  it("will not let the register's analyst review figures either", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    const error = await expectSqlError(
      db.query("select public.review_statement($1, $2, 'approved')", [statement, analyst]),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/may not review financial figures/);
  });
});

describe("what a reader may see", () => {
  it("shows an approved statement of an approved company, with its lines", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    await db.query("select public.review_statement($1, $2, 'approved')", [statement, checker]);

    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ id: string }>(
        "select id from public.financial_statements where id = $1",
        [statement],
      );
      expect(rows).toHaveLength(1);
      const { rows: lines } = await db.query<{ line_item: string }>(
        "select line_item from public.financial_statement_lines where statement_id = $1 order by line_item",
        [statement],
      );
      expect(lines.map((l) => l.line_item)).toEqual(["profit_after_tax", "profit_before_tax", "revenue"]);
    });
  });

  it("hides a pending statement from a reader and shows it to the figures desk", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });

    await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.financial_statements where id = $1", [statement]);
      expect(rows).toHaveLength(0);
      const { rows: lines } = await db.query(
        "select line_item from public.financial_statement_lines where statement_id = $1",
        [statement],
      );
      expect(lines).toHaveLength(0);
    });

    await asUser(db, financial, async () => {
      const { rows } = await db.query("select id from public.financial_statements where id = $1", [statement]);
      expect(rows).toHaveLength(1);
    });
  });

  /**
   * The fault the foundation's policy had: it tested the statement and the
   * licence but never the company, so the figures of a company nobody had
   * reviewed were readable by any signed-in user. The company page would not
   * show them; the table handed them over.
   */
  it("hides the figures of a company nobody has approved, even once approved themselves", async () => {
    const period = nextYear();
    const document = await makeDocument(pendingCompany);
    const statement = await recordStatement({
      ...period,
      companyId: pendingCompany,
      documentId: document,
    });
    await db.query("select public.review_statement($1, $2, 'approved')", [statement, checker]);

    await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.financial_statements where id = $1", [statement]);
      expect(rows).toHaveLength(0);
      const { rows: lines } = await db.query(
        "select line_item from public.financial_statement_lines where statement_id = $1",
        [statement],
      );
      expect(lines).toHaveLength(0);
    });
  });

  it("hides figures from staff who do not keep them", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    for (const staff of [analyst, editor]) {
      await asUser(db, staff, async () => {
        const { rows } = await db.query("select id from public.financial_statements where id = $1", [statement]);
        expect(rows).toHaveLength(0);
      });
    }
  });

  /**
   * The predicate must answer exactly what the policy answers. A definer
   * function that says "true" about a row the policy hides is an oracle, which
   * is the defect /code-review high found in stage 3b's first fix.
   */
  it("answers no more through statement_is_published than a select would", async () => {
    const period = nextYear();
    const hidden = await recordStatement({ ...period });
    const visiblePeriod = nextYear();
    const visible = await recordStatement({ ...visiblePeriod });
    await db.query("select public.review_statement($1, $2, 'approved')", [visible, checker]);

    await asUser(db, reader, async () => {
      for (const [id, expected] of [
        [hidden, false],
        [visible, true],
      ] as const) {
        const { rows } = await db.query<{ answer: boolean }>("select public.statement_is_published($1) as answer", [
          id,
        ]);
        const { rows: selected } = await db.query("select id from public.financial_statements where id = $1", [id]);
        expect(rows[0].answer).toBe(expected);
        expect(selected.length > 0).toBe(expected);
      }
    });
  });

  /**
   * The kill switch. Deactivating a dataset has to hide what came through it at
   * once — that is the whole value of gating display on the licence rather than
   * on a copy of its terms taken at entry time.
   */
  it("hides approved figures the moment their dataset is switched off", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    await db.query("select public.review_statement($1, $2, 'approved')", [statement, checker]);

    await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.financial_statements where id = $1", [statement]);
      expect(rows).toHaveLength(1);
    });

    await db.query("update public.datasets set is_active = false where id = 'companies.documents'");
    try {
      await asUser(db, reader, async () => {
        const { rows } = await db.query("select id from public.financial_statements where id = $1", [statement]);
        expect(rows).toHaveLength(0);
        const { rows: lines } = await db.query(
          "select line_item from public.financial_statement_lines where statement_id = $1",
          [statement],
        );
        expect(lines).toHaveLength(0);
      });
    } finally {
      await db.query("update public.datasets set is_active = true where id = 'companies.documents'");
    }
  });

  it("lets a reader read the catalogue and the templates", async () => {
    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.statement_line_catalogue",
      );
      expect(rows[0].n).toBeGreaterThan(50);
      const { rows: templates } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.statement_template_lines",
      );
      expect(templates[0].n).toBeGreaterThan(50);
    });
  });
});

describe("nothing is edited in place", () => {
  it("refuses to change a figure, and refuses to delete one", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });

    const update = await expectSqlError(
      db.query("update public.financial_statement_lines set value_standardised = 1 where statement_id = $1", [
        statement,
      ]),
    );
    expect(update.code).toBe("42501");
    expect(update.message).toMatch(/immutable/);

    const remove = await expectSqlError(
      db.query("delete from public.financial_statement_lines where statement_id = $1", [statement]),
    );
    expect(remove.code).toBe("42501");

    const edit = await expectSqlError(
      db.query("update public.financial_statements set period_end = '2030-12-31' where id = $1", [statement]),
    );
    expect(edit.code).toBe("42501");
    expect(edit.message).toMatch(/immutable/);
  });

  it("will not add a line to a statement that has already been reviewed", async () => {
    const period = nextYear();
    const statement = await recordStatement({ ...period });
    await db.query("select public.review_statement($1, $2, 'approved')", [statement, checker]);
    const error = await expectSqlError(
      db.query(
        "insert into public.financial_statement_lines (statement_id, line_item, value_standardised, value_reported, source_page) values ($1, 'ebitda', 1, 1, 9)",
        [statement],
      ),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/pending statement/);
  });

  it("fixes a line's unit and sign once figures have been entered against it", async () => {
    const period = nextYear();
    await recordStatement({ ...period });

    const error = await expectSqlError(
      db.query(
        "select public.upsert_statement_line($1, 'revenue', 'Revenue', 'income', 'percent', '%', 'positive', null)",
        [financial],
      ),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/unit and sign are fixed/);

    // The label and the definition are not history, so those still move.
    await db.query(
      "select public.upsert_statement_line($1, 'revenue', 'Revenue (turnover)', 'income', 'currency', 'currency', 'positive', 'Clarified.')",
      [financial],
    );
    const { rows } = await db.query<{ label: string }>(
      "select label from public.statement_line_catalogue where line_item = 'revenue'",
    );
    expect(rows[0].label).toBe("Revenue (turnover)");
  });
});

describe("template assignment", () => {
  it("closes the previous assignment rather than editing it", async () => {
    const company = await makeCompany("Re-sectored Plc", "re-sectored", "RSEC");
    await db.query("select public.assign_company_template($1, $2, 'food_consumer', '2015-01-01', null)", [
      financial,
      company,
    ]);
    await db.query(
      "select public.assign_company_template($1, $2, 'cement_industrial', '2023-01-01', 'Reclassified after the demerger.')",
      [financial, company],
    );

    const { rows } = await db.query<{ template_id: string; valid_from: string; valid_to: string | null }>(
      "select template_id, valid_from::text, valid_to::text from public.company_statement_templates where company_id = $1 order by valid_from",
      [company],
    );
    expect(rows).toEqual([
      { template_id: "food_consumer", valid_from: "2015-01-01", valid_to: "2023-01-01" },
      { template_id: "cement_industrial", valid_from: "2023-01-01", valid_to: null },
    ]);
  });

  /**
   * The reason assignment is effective-dated rather than a column on the
   * company: a year already entered keeps reading under the template it was
   * entered against.
   */
  it("reads an earlier period under the template that was in force then", async () => {
    const company = await makeCompany("Historic Template Plc", "historic-template", "HTPL");
    const document = await makeDocument(company);
    await db.query("select public.assign_company_template($1, $2, 'food_consumer', '2015-01-01', null)", [
      financial,
      company,
    ]);
    await db.query("select public.assign_company_template($1, $2, 'cement_industrial', '2023-01-01', null)", [
      financial,
      company,
    ]);

    const old = await recordStatement({
      companyId: company,
      documentId: document,
      periodStart: "2019-01-01",
      periodEnd: "2019-12-31",
      lines: [...coreIncomeLines(), { line_item: "raw_material_costs", value_reported: 50, source_page: 44 }],
    });
    const { rows } = await db.query<{ template_id: string }>(
      "select template_id from public.financial_statements where id = $1",
      [old],
    );
    expect(rows[0].template_id).toBe("food_consumer");

    // And the newer template's figure is refused for that old period.
    const error = await expectSqlError(
      recordStatement({
        companyId: company,
        documentId: document,
        periodStart: "2019-01-01",
        periodEnd: "2019-12-31",
        statementType: "operating",
        lines: [{ line_item: "sales_volume_tonnes", value_reported: 10, source_page: 44 }],
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/not part of this company's template \(food_consumer\)/);
  });

  it("will not assign the core template, which applies to everyone", async () => {
    const error = await expectSqlError(
      db.query("select public.assign_company_template($1, $2, 'core', '2020-01-01', null)", [financial, bank]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/applies to every company/);
  });

  it("will not start a new assignment before the one it replaces", async () => {
    const company = await makeCompany("Backdated Plc", "backdated", "BKDT");
    await db.query("select public.assign_company_template($1, $2, 'oil_gas', '2020-01-01', null)", [
      financial,
      company,
    ]);
    const error = await expectSqlError(
      db.query("select public.assign_company_template($1, $2, 'power_utilities', '2019-01-01', null)", [
        financial,
        company,
      ]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/starts after the one it replaces/);
  });

  it("keeps one current assignment per company", async () => {
    const company = await makeCompany("Single Template Plc", "single-template", "SGTM");
    await db.query("select public.assign_company_template($1, $2, 'oil_gas', '2020-01-01', null)", [
      financial,
      company,
    ]);
    const error = await expectSqlError(
      db.query(
        "insert into public.company_statement_templates (company_id, template_id, valid_from) values ($1, 'telecoms', '2021-01-01')",
        [company],
      ),
    );
    expect(error.code).toBe("23505");
  });
});

describe("succession", () => {
  async function makePredecessor(name: string, slug: string, symbol: string, status = "delisted"): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.upsert_company_profile(
         $1, $2, $3, $4, null, null, null, null, null, null, null, $5, null
       ) as id`,
      [analyst, name, slug, status, symbol],
    );
    const id = rows[0].id;
    await db.query("select public.review_company($1, $2, 'approved')", [id, admin]);
    return id;
  }

  it("links a former entity to its successor, with the date and the source", async () => {
    const predecessor = await makePredecessor("Former Bank Plc", "former-bank", "FRMB");
    const document = await makeDocument(bank);
    const { rows } = await db.query<{ id: string }>(
      `select public.record_company_succession(
         $1, $2, $3, 'holdco_reorganisation', '2022-01-01', 'year', $4, 7, null,
         'The holding company was established in 2022.'
       ) as id`,
      [financial, predecessor, bank, document],
    );
    const succession = rows[0].id;
    const { rows: stored } = await db.query<{
      relationship: string;
      effective_precision: string;
      review_status: string;
      source_page: number;
    }>(
      "select relationship, effective_precision, review_status, source_page from public.company_successions where id = $1",
      [succession],
    );
    expect(stored[0]).toEqual({
      relationship: "holdco_reorganisation",
      effective_precision: "year",
      review_status: "pending",
      source_page: 7,
    });
  });

  /**
   * pre_listing means a company with an offer under way and no listing yet. A
   * predecessor is the opposite — an entity that is gone — and letting the flag
   * stand here would publish the old Access Bank as a forthcoming IPO.
   */
  it("refuses a predecessor still marked as awaiting listing", async () => {
    const predecessor = await makePredecessor("Awaiting Listing Plc", "awaiting-listing", "AWLT", "pre_listing");
    const document = await makeDocument(bank);
    const error = await expectSqlError(
      db.query(
        `select public.record_company_succession(
           $1, $2, $3, 'renaming', '2022-01-01', 'year', $4, 7, null, null
         )`,
        [financial, predecessor, bank, document],
      ),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/former entity, not one awaiting listing/);
  });

  /**
   * The arm of the source guard that was written, reviewed and never executed.
   * It read `review_status` from announcements, which call that column `status`,
   * so the first succession to cite one would have failed with 42703 — and every
   * other succession test cites a document, so the suite stayed green. A guard
   * with two arms needs a test down each one.
   */
  it("accepts a succession resting on a published announcement", async () => {
    const predecessor = await makePredecessor("Announced Merger Plc", "announced-merger", "ANMR");
    const source = await makeDocument(bank);
    const { rows: announcement } = await db.query<{ id: string }>(
      `select public.publish_announcement(
         $1, $2, 'corporate_action', 'Scheme of arrangement completed', now() - interval '1 day',
         null, false, $3, null, null
       ) as id`,
      [analyst, source, bank],
    );

    const { rows } = await db.query<{ id: string }>(
      `select public.record_company_succession(
         $1, $2, $3, 'merger', '2021-06-01', 'month', null, null, $4, null
       ) as id`,
      [financial, predecessor, bank, announcement[0].id],
    );
    const { rows: stored } = await db.query<{ announcement_id: string; source_page: number | null }>(
      "select announcement_id, source_page from public.company_successions where id = $1",
      [rows[0].id],
    );
    expect(stored[0].announcement_id).toBe(announcement[0].id);
    // An announcement has no page, and the constraint says so.
    expect(stored[0].source_page).toBeNull();
  });

  it("refuses a succession citing an announcement that is not published", async () => {
    const predecessor = await makePredecessor("Withdrawn Notice Plc", "withdrawn-notice", "WDNT");
    const source = await makeDocument(bank);
    const { rows: announcement } = await db.query<{ id: string }>(
      `select public.publish_announcement(
         $1, $2, 'corporate_action', 'Scheme later withdrawn', now() - interval '2 days',
         null, false, $3, null, null
       ) as id`,
      [analyst, source, bank],
    );
    await db.query(
      "select public.withdraw_announcement($1, $2, 'The scheme did not complete.')",
      [announcement[0].id, analyst],
    );

    const error = await expectSqlError(
      db.query(
        `select public.record_company_succession(
           $1, $2, $3, 'merger', '2021-06-01', 'month', null, null, $4, null
         )`,
        [financial, predecessor, bank, announcement[0].id],
      ),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/published announcement/);
  });

  it("insists on exactly one source", async () => {
    const predecessor = await makePredecessor("Two Sources Plc", "two-sources", "TWSR");
    const document = await makeDocument(bank);
    const none = await expectSqlError(
      db.query(
        "select public.record_company_succession($1, $2, $3, 'merger', '2022-01-01', 'day', null, null, null, null)",
        [financial, predecessor, bank],
      ),
    );
    expect(none.code).toBe("23514");

    const pageless = await expectSqlError(
      db.query(
        "select public.record_company_succession($1, $2, $3, 'merger', '2022-01-01', 'day', $4, null, null, null)",
        [financial, predecessor, bank, document],
      ),
    );
    expect(pageless.code).toBe("23514");
  });

  it("cannot name a company as its own predecessor", async () => {
    const document = await makeDocument(bank);
    const error = await expectSqlError(
      db.query(
        "select public.record_company_succession($1, $2, $2, 'renaming', '2022-01-01', 'day', $3, 2, null, null)",
        [financial, bank, document],
      ),
    );
    expect(error.code).toBe("23514");
  });

  it("flags a self-reviewed succession and fixes the claim once recorded", async () => {
    const predecessor = await makePredecessor("Self Reviewed Plc", "self-reviewed", "SLFR");
    const document = await makeDocument(bank);
    const { rows } = await db.query<{ id: string }>(
      `select public.record_company_succession(
         $1, $2, $3, 'acquisition', '2021-06-01', 'month', $4, 3, null, null
       ) as id`,
      [financial, predecessor, bank, document],
    );
    const succession = rows[0].id;

    const edit = await expectSqlError(
      db.query("update public.company_successions set relationship = 'merger' where id = $1", [succession]),
    );
    expect(edit.code).toBe("42501");
    expect(edit.message).toMatch(/fixed once recorded/);

    const remove = await expectSqlError(
      db.query("delete from public.company_successions where id = $1", [succession]),
    );
    expect(remove.code).toBe("42501");

    await db.query("select public.review_company_succession($1, $2, 'approved')", [succession, financial]);
    const { rows: reviewed } = await db.query<{ review_self_approved: boolean }>(
      "select review_self_approved from public.company_successions where id = $1",
      [succession],
    );
    expect(reviewed[0].review_self_approved).toBe(true);
  });

  it("publishes a succession only when the claim and both companies are approved", async () => {
    const approvedPredecessor = await makePredecessor("Published Predecessor Plc", "published-predecessor", "PBPR");
    const document = await makeDocument(bank);
    const { rows } = await db.query<{ id: string }>(
      `select public.record_company_succession(
         $1, $2, $3, 'renaming', '2020-03-02', 'day', $4, 5, null, null
       ) as id`,
      [financial, approvedPredecessor, bank, document],
    );
    const published = rows[0].id;

    await asUser(db, reader, async () => {
      const { rows: beforeReview } = await db.query("select id from public.company_successions where id = $1", [
        published,
      ]);
      expect(beforeReview).toHaveLength(0);
    });

    await db.query("select public.review_company_succession($1, $2, 'approved')", [published, checker]);

    await asUser(db, reader, async () => {
      const { rows: afterReview } = await db.query("select id from public.company_successions where id = $1", [
        published,
      ]);
      expect(afterReview).toHaveLength(1);
    });

    // A predecessor nobody has approved is not published through the succession.
    const { rows: pendingRows } = await db.query<{ id: string }>(
      `select public.upsert_company_profile(
         $1, 'Hidden Predecessor Plc', 'hidden-predecessor', 'delisted',
         null, null, null, null, null, null, null, 'HDPR', null
       ) as id`,
      [analyst],
    );
    const hidden = pendingRows[0].id;
    const secondDocument = await makeDocument(bank);
    const { rows: hiddenSuccession } = await db.query<{ id: string }>(
      `select public.record_company_succession(
         $1, $2, $3, 'merger', '2019-01-01', 'year', $4, 11, null, null
       ) as id`,
      [financial, hidden, bank, secondDocument],
    );
    await db.query("select public.review_company_succession($1, $2, 'approved')", [
      hiddenSuccession[0].id,
      checker,
    ]);

    await asUser(db, reader, async () => {
      const { rows: visible } = await db.query("select id from public.company_successions where id = $1", [
        hiddenSuccession[0].id,
      ]);
      expect(visible).toHaveLength(0);
    });
  });
});
