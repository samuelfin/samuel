import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * The suggestion queue, and the things it is built not to do.
 *
 * A suggestion is never a figure: nothing here writes to
 * financial_statement_lines, and the only route into the register is a person
 * confirming a number through record_statement. Decisions are one at a time,
 * because a button that accepts forty unexamined figures is this feature's whole
 * risk in one control. And a proposal is the desk's working queue, not something
 * a reader has any business seeing — a machine's guess at a company's results is
 * not a published fact.
 */

let db: PGlite;
let financial: string;
let checker: string;
let admin: string;
let analyst: string;
let reader: string;
let company: string;
let document: string;

beforeAll(async () => {
  db = await createTestDatabase();
  financial = await createUser(db, { staff: ["financial_analyst"] });
  checker = await createUser(db, { staff: ["financial_analyst"] });
  admin = await createUser(db, { admin: true });
  analyst = await createUser(db, { staff: ["analyst"] });
  reader = await createUser(db);

  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_profile(
       $1, 'Suggestion Industries Plc', 'suggestion-industries', 'listed',
       null, null, null, null, null, null, null, 'SGIN', null
     ) as id`,
    [analyst],
  );
  company = rows[0].id;
  await db.query("select public.review_company($1, $2, 'approved')", [company, admin]);
  document = await makeDocument();
}, 180_000);

let counter = 0;

async function makeDocument(opts: { approve?: boolean; licence?: string } = {}): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 4096, $5, $6, 'https://issuer.test/report.pdf'
     ) as id`,
    [
      analyst,
      `Suggestion source ${counter}`,
      `sg/doc-${counter}.pdf`,
      sha256(`suggestion-${counter}`),
      opts.licence ?? "issuer_document",
      company,
    ],
  );
  const id = rows[0].id;
  if (opts.approve !== false) {
    await db.query("select public.review_document($1, $2, 'approved')", [id, admin]);
  }
  return id;
}

interface SuggestionInput {
  line_item: string;
  value_reported: number;
  presentation?: string;
  magnitude?: string;
  source_page?: number;
  raw_label?: string;
  raw_value?: string;
  confidence?: number;
}

let year = 2010;
function nextPeriod(): { start: string; end: string } {
  year += 1;
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

async function queueBatch(
  opts: {
    actor?: string;
    documentId?: string;
    statementType?: string;
    suggestions?: SuggestionInput[];
    provider?: string;
    model?: string | null;
    promptVersion?: string | null;
    period?: { start: string; end: string };
  } = {},
): Promise<string> {
  const period = opts.period ?? nextPeriod();
  const { rows } = await db.query<{ id: string }>(
    `select public.record_figure_suggestions(
       $1, $2, $3, $4, 'FY', $5, $6, 'NGN', 'thousands', $7, $8::jsonb, $9, $10, null
     ) as id`,
    [
      opts.actor ?? financial,
      company,
      opts.documentId === undefined ? document : opts.documentId,
      opts.statementType ?? "income",
      period.start,
      period.end,
      opts.provider ?? "manual_paste",
      JSON.stringify(
        opts.suggestions ?? [
          { line_item: "revenue", value_reported: 1000, source_page: 40, raw_label: "Revenue", raw_value: "1,000" },
          { line_item: "profit_after_tax", value_reported: 200, source_page: 40 },
        ],
      ),
      opts.model === undefined ? null : opts.model,
      opts.promptVersion === undefined ? null : opts.promptVersion,
    ],
  );
  return rows[0].id;
}

async function suggestionsOf(batch: string) {
  const { rows } = await db.query<{
    id: string;
    line_item: string;
    value_reported: string;
    presentation: string;
    source_page: number;
    status: string;
    raw_label: string | null;
    raw_value: string | null;
    confidence: string | null;
    decision_reason: string | null;
  }>(
    `select id, line_item, value_reported, presentation, source_page, status,
            raw_label, raw_value, confidence, decision_reason
       from public.figure_suggestions where batch_id = $1 order by line_item`,
    [batch],
  );
  return rows;
}

describe("queueing a run", () => {
  it("records what proposed the figures, so a wrong one can be traced", async () => {
    const batch = await queueBatch({ provider: "manual_paste", model: null, promptVersion: null });
    const { rows } = await db.query<{
      provider: string;
      model: string | null;
      prompt_version: string | null;
      status: string;
      statement_id: string | null;
      created_by: string;
    }>(
      "select provider, model, prompt_version, status, statement_id, created_by from public.figure_suggestion_batches where id = $1",
      [batch],
    );
    expect(rows[0]).toEqual({
      provider: "manual_paste",
      model: null,
      prompt_version: null,
      status: "open",
      statement_id: null,
      created_by: financial,
    });
  });

  it("keeps what the extractor read, beside what it parsed", async () => {
    const batch = await queueBatch({
      suggestions: [
        {
          line_item: "cost_of_sales",
          value_reported: 400,
          presentation: "bracketed",
          source_page: 41,
          raw_label: "Cost of sales",
          raw_value: "(400)",
          confidence: 0.82,
        },
      ],
    });
    const [suggestion] = await suggestionsOf(batch);
    expect(suggestion).toMatchObject({
      line_item: "cost_of_sales",
      presentation: "bracketed",
      source_page: 41,
      raw_label: "Cost of sales",
      raw_value: "(400)",
      status: "pending",
    });
    expect(Number(suggestion.value_reported)).toBe(400);
    expect(Number(suggestion.confidence)).toBeCloseTo(0.82);
  });

  it("refuses a proposal the register could not accept anyway", async () => {
    const unknown = await expectSqlError(
      queueBatch({ suggestions: [{ line_item: "adjusted_profit", value_reported: 1, source_page: 4 }] }),
    );
    expect(unknown.code).toBe("23503");

    const wrongStatement = await expectSqlError(
      queueBatch({ suggestions: [{ line_item: "total_assets", value_reported: 1, source_page: 60 }] }),
    );
    expect(wrongStatement.code).toBe("23514");
    expect(wrongStatement.message).toMatch(/belongs to the balance_sheet statement/);
  });

  /**
   * Asserting the message, not just the refusal. A missing key makes
   * `entry -> 'key'` SQL NULL, so a plain `<> 'number'` test yields NULL and
   * never fires — the row then dies on the not-null constraint and the desk gets
   * a bare 23502 instead of something an analyst can act on. That is exactly
   * what this caught.
   */
  it("insists every proposal carries a figure and a page, and says which", async () => {
    const noPage = await expectSqlError(
      queueBatch({ suggestions: [{ line_item: "revenue", value_reported: 1000 }] }),
    );
    expect(noPage.code).toBe("23514");
    expect(noPage.message).toMatch(/needs the page it was read from/);

    const noFigure = await expectSqlError(
      db.query(
        `select public.record_figure_suggestions(
           $1, $2, $3, 'income', 'FY', '2031-01-01', '2031-12-31', 'NGN', 'thousands', 'manual_paste',
           '[{"line_item": "revenue", "source_page": 40}]'::jsonb, null, null, null
         )`,
        [financial, company, document],
      ),
    );
    expect(noFigure.code).toBe("23514");
    expect(noFigure.message).toMatch(/needs a figure/);
  });

  it("refuses the same figure twice in one run", async () => {
    const error = await expectSqlError(
      queueBatch({
        suggestions: [
          { line_item: "revenue", value_reported: 1000, source_page: 40 },
          { line_item: "revenue", value_reported: 2000, source_page: 41 },
        ],
      }),
    );
    expect(error.code).toBe("23505");
  });

  it("requires an approved document with a verifiable licence", async () => {
    const unapproved = await makeDocument({ approve: false });
    const first = await expectSqlError(queueBatch({ documentId: unapproved }));
    expect(first.code).toBe("23514");
    expect(first.message).toMatch(/approved document/);

    const unverified = await makeDocument({ licence: "unverified" });
    const second = await expectSqlError(queueBatch({ documentId: unverified }));
    expect(second.code).toBe("23514");
    expect(second.message).toMatch(/licence is unverified/);
  });

  it("refuses an empty run", async () => {
    const error = await expectSqlError(queueBatch({ suggestions: [] }));
    expect(error.code).toBe("23514");
  });

  it("admits only the figures desk", async () => {
    for (const actor of [analyst, reader]) {
      const error = await expectSqlError(queueBatch({ actor }));
      expect(error.code).toBe("42501");
      expect(error.message).toMatch(/may not queue suggested figures/);
    }
  });
});

describe("deciding a suggestion", () => {
  it("takes one at a time, and records who decided", async () => {
    const batch = await queueBatch();
    const suggestions = await suggestionsOf(batch);
    await db.query("select public.decide_figure_suggestion($1, $2, 'accepted')", [suggestions[0].id, checker]);

    const after = await suggestionsOf(batch);
    expect(after.map((s) => s.status).sort()).toEqual(["accepted", "pending"]);
    const { rows } = await db.query<{ decided_by: string; decided_at: string }>(
      "select decided_by, decided_at from public.figure_suggestions where id = $1",
      [suggestions[0].id],
    );
    expect(rows[0].decided_by).toBe(checker);
    expect(rows[0].decided_at).toBeTruthy();
  });

  it("needs a reason to reject, because the reason is what stops the next one", async () => {
    const batch = await queueBatch();
    const [first] = await suggestionsOf(batch);
    const error = await expectSqlError(
      db.query("select public.decide_figure_suggestion($1, $2, 'rejected')", [first.id, checker]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/Say why the suggestion is wrong/);

    await db.query("select public.decide_figure_suggestion($1, $2, 'rejected', 'Read from the prior-year column.')", [
      first.id,
      checker,
    ]);
    const after = await suggestionsOf(batch);
    expect(after.find((s) => s.id === first.id)?.decision_reason).toMatch(/prior-year column/);
  });

  it("will not decide the same suggestion twice", async () => {
    const batch = await queueBatch();
    const [first] = await suggestionsOf(batch);
    await db.query("select public.decide_figure_suggestion($1, $2, 'accepted')", [first.id, checker]);
    const error = await expectSqlError(
      db.query("select public.decide_figure_suggestion($1, $2, 'rejected', 'Changed my mind.')", [first.id, checker]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/already been accepted/);
  });

  it("admits only the figures desk", async () => {
    const batch = await queueBatch();
    const [first] = await suggestionsOf(batch);
    for (const actor of [analyst, reader]) {
      const error = await expectSqlError(
        db.query("select public.decide_figure_suggestion($1, $2, 'accepted')", [first.id, actor]),
      );
      expect(error.code).toBe("42501");
    }
  });
});

describe("a suggestion is not a figure", () => {
  /**
   * The guarantee the whole sub-stage rests on. Accepting a proposal changes its
   * status and nothing else: no statement appears, and no line is written. A
   * figure reaches the register only when a person enters it.
   */
  it("writes nothing to the register when a suggestion is accepted", async () => {
    const period = nextPeriod();
    const batch = await queueBatch({ period });
    for (const suggestion of await suggestionsOf(batch)) {
      await db.query("select public.decide_figure_suggestion($1, $2, 'accepted')", [suggestion.id, checker]);
    }

    const { rows: statements } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.financial_statements where company_id = $1 and period_end = $2",
      [company, period.end],
    );
    expect(statements[0].n).toBe(0);

    const { rows: lines } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.financial_statement_lines",
    );
    expect(lines[0].n).toBe(0);
  });

  it("fixes the figure once proposed, so only the decision moves", async () => {
    const batch = await queueBatch();
    const [first] = await suggestionsOf(batch);

    const edit = await expectSqlError(
      db.query("update public.figure_suggestions set value_reported = 9999 where id = $1", [first.id]),
    );
    expect(edit.code).toBe("42501");
    expect(edit.message).toMatch(/fixed once proposed/);

    const page = await expectSqlError(
      db.query("update public.figure_suggestions set source_page = 1 where id = $1", [first.id]),
    );
    expect(page.code).toBe("42501");

    const remove = await expectSqlError(
      db.query("delete from public.figure_suggestions where id = $1", [first.id]),
    );
    expect(remove.code).toBe("42501");
    expect(remove.message).toMatch(/not deleted/);
  });

  it("holds a batch's description still, and refuses to delete it", async () => {
    const batch = await queueBatch();
    const edit = await expectSqlError(
      db.query("update public.figure_suggestion_batches set provider = 'some_model' where id = $1", [batch]),
    );
    expect(edit.code).toBe("42501");
    expect(edit.message).toMatch(/one run of one extractor/);

    const remove = await expectSqlError(
      db.query("delete from public.figure_suggestion_batches where id = $1", [batch]),
    );
    expect(remove.code).toBe("42501");
  });
});

describe("closing a batch", () => {
  async function recordStatement(period: { start: string; end: string }): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      `select public.record_statement(
         $1, $2, 'income', 'FY', $3, $4, true, true, 'NGN', 'thousands', $5,
         $6::jsonb, null, null, null, null
       ) as id`,
      [
        financial,
        company,
        period.start,
        period.end,
        document,
        JSON.stringify([
          { line_item: "revenue", value_reported: 1000, source_page: 40, ai_assisted: true },
          { line_item: "profit_before_tax", value_reported: 300, source_page: 40 },
          { line_item: "profit_after_tax", value_reported: 200, source_page: 40, ai_assisted: true },
        ]),
      ],
    );
    return rows[0].id;
  }

  it("ties the run to the statement it produced", async () => {
    const period = nextPeriod();
    const batch = await queueBatch({ period });
    const statement = await recordStatement(period);
    await db.query("select public.close_suggestion_batch($1, $2, $3)", [batch, financial, statement]);

    const { rows } = await db.query<{ status: string; statement_id: string; closed_at: string }>(
      "select status, statement_id, closed_at from public.figure_suggestion_batches where id = $1",
      [batch],
    );
    expect(rows[0].status).toBe("closed");
    expect(rows[0].statement_id).toBe(statement);
    expect(rows[0].closed_at).toBeTruthy();

    // And the statement itself is labelled, for the life of the figures.
    const { rows: labelled } = await db.query<{ ai_assisted: boolean }>(
      "select ai_assisted from public.financial_statements where id = $1",
      [statement],
    );
    expect(labelled[0].ai_assisted).toBe(true);
  });

  /**
   * A batch pointed at the wrong statement would say an extractor proposed
   * figures it never saw, which is a provenance lie rather than a mix-up.
   */
  it("refuses a statement for a different period", async () => {
    const period = nextPeriod();
    const batch = await queueBatch({ period });
    const other = nextPeriod();
    const statement = await recordStatement(other);
    const error = await expectSqlError(
      db.query("select public.close_suggestion_batch($1, $2, $3)", [batch, financial, statement]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/different company, statement or period/);
  });

  it("closes without a statement, for a run that produced nothing worth keeping", async () => {
    const batch = await queueBatch();
    await db.query("select public.close_suggestion_batch($1, $2, null)", [batch, financial]);
    const { rows } = await db.query<{ status: string; statement_id: string | null }>(
      "select status, statement_id from public.figure_suggestion_batches where id = $1",
      [batch],
    );
    expect(rows[0]).toEqual({ status: "closed", statement_id: null });
  });

  it("stops decisions once the batch is closed", async () => {
    const batch = await queueBatch();
    const [first] = await suggestionsOf(batch);
    await db.query("select public.close_suggestion_batch($1, $2, null)", [batch, financial]);
    const error = await expectSqlError(
      db.query("select public.decide_figure_suggestion($1, $2, 'accepted')", [first.id, checker]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/batch is closed/);
  });

  it("will not close the same batch twice", async () => {
    const batch = await queueBatch();
    await db.query("select public.close_suggestion_batch($1, $2, null)", [batch, financial]);
    const error = await expectSqlError(
      db.query("select public.close_suggestion_batch($1, $2, null)", [batch, financial]),
    );
    expect(error.code).toBe("23514");
  });
});

describe("who may see a proposal", () => {
  it("shows the queue to the figures desk and to nobody else", async () => {
    const batch = await queueBatch();

    for (const [label, actor, visible] of [
      ["the figures desk", financial, true],
      ["a platform admin", admin, true],
      ["the register's analyst", analyst, false],
      ["a reader", reader, false],
    ] as const) {
      await asUser(db, actor, async () => {
        const { rows: batches } = await db.query(
          "select id from public.figure_suggestion_batches where id = $1",
          [batch],
        );
        const { rows: suggestions } = await db.query(
          "select id from public.figure_suggestions where batch_id = $1",
          [batch],
        );
        expect(batches.length > 0, `${label} sees the batch`).toBe(visible);
        expect(suggestions.length > 0, `${label} sees the suggestions`).toBe(visible);
      });
    }
  });

  it("refuses an unauthenticated caller outright", async () => {
    await db.exec("set role anon");
    try {
      const error = await expectSqlError(db.query("select id from public.figure_suggestions limit 1"));
      expect(error.code).toBe("42501");
    } finally {
      await db.exec("reset role");
    }
  });
});
