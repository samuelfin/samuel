import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * Stage 3c, attacked rather than read.
 *
 * These are the probes that found the two faults in the foundation's statement
 * policies, and they stay as permanent tests because the next migration to touch
 * a grant or a policy will be written by someone who has forgotten why these
 * exist.
 *
 * Four claims are under test. Nobody but the figures desk may write a figure or
 * see an unpublished one. No client role may reach a write function, whatever
 * actor it names. A figure, once entered, cannot be edited into something else.
 * And the definer predicates the policies rely on answer no more than a SELECT
 * on the row would — a function that says "true" about a row the policy hides is
 * an oracle, which is the defect a code review found in stage 3b's first fix.
 */

let db: PGlite;
let financial: string;
let admin: string;
let analyst: string;
let editor: string;
let factChecker: string;
let publisher: string;
let reader: string;

let company: string;
let pendingCompany: string;
let document: string;
let approvedStatement: string;
let pendingStatement: string;
let hiddenStatement: string;
let batch: string;
let suggestion: string;

beforeAll(async () => {
  db = await createTestDatabase();
  financial = await createUser(db, { staff: ["financial_analyst"] });
  admin = await createUser(db, { admin: true });
  analyst = await createUser(db, { staff: ["analyst"] });
  editor = await createUser(db, { staff: ["editor"] });
  factChecker = await createUser(db, { staff: ["fact_checker"] });
  publisher = await createUser(db, { staff: ["publisher"] });
  reader = await createUser(db);

  // Licences before display: the statements policy tests is_displayable_source,
  // so without this the "visible" statement would be invisible for the wrong
  // reason and every probe below would pass vacuously.
  const { rows: licence } = await db.query<{ id: string }>(
    `insert into public.data_licences (provider_id, product, status, allows_display)
     values ('issuer_ir', 'Issuer-published filings', 'active', true) returning id`,
  );
  await db.query("update public.datasets set licence_id = $1, is_active = true where id = 'companies.documents'", [
    licence[0].id,
  ]);

  company = await makeCompany("Attack Industries Plc", "attack-industries", "ATKI");
  pendingCompany = await makeCompany("Unreviewed Attack Plc", "unreviewed-attack", "UNAT", false);
  document = await makeDocument(company);

  approvedStatement = await makeStatement({ periodEnd: "2021-12-31" });
  await db.query("select public.review_statement($1, $2, 'approved')", [approvedStatement, admin]);

  pendingStatement = await makeStatement({ periodEnd: "2022-12-31" });

  const hiddenDocument = await makeDocument(pendingCompany);
  hiddenStatement = await makeStatement({
    companyId: pendingCompany,
    documentId: hiddenDocument,
    periodEnd: "2023-12-31",
  });
  await db.query("select public.review_statement($1, $2, 'approved')", [hiddenStatement, admin]);

  const { rows: batchRows } = await db.query<{ id: string }>(
    `select public.record_figure_suggestions(
       $1, $2, $3, 'income', 'FY', '2024-01-01', '2024-12-31', 'NGN', 'thousands', 'manual_paste',
       '[{"line_item": "revenue", "value_reported": 1000, "source_page": 40}]'::jsonb, null, null, null
     ) as id`,
    [financial, company, document],
  );
  batch = batchRows[0].id;
  const { rows: suggestionRows } = await db.query<{ id: string }>(
    "select id from public.figure_suggestions where batch_id = $1 limit 1",
    [batch],
  );
  suggestion = suggestionRows[0].id;
}, 240_000);

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

async function makeDocument(companyId: string): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 4096, 'issuer_document', $5, 'https://issuer.test/r.pdf'
     ) as id`,
    [analyst, `Attack source ${counter}`, `at/doc-${counter}.pdf`, sha256(`attack-${counter}`), companyId],
  );
  const id = rows[0].id;
  await db.query("select public.review_document($1, $2, 'approved')", [id, admin]);
  return id;
}

async function makeStatement(
  opts: { companyId?: string; documentId?: string; periodEnd?: string } = {},
): Promise<string> {
  const periodEnd = opts.periodEnd ?? "2020-12-31";
  const periodStart = `${Number(periodEnd.slice(0, 4))}-01-01`;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_statement(
       $1, $2, 'income', 'FY', $3, $4, true, true, 'NGN', 'thousands', $5, $6::jsonb, null, null, null, null
     ) as id`,
    [
      financial,
      opts.companyId ?? company,
      periodStart,
      periodEnd,
      opts.documentId ?? document,
      JSON.stringify([
        { line_item: "revenue", value_reported: 1000, source_page: 40 },
        { line_item: "profit_before_tax", value_reported: 300, source_page: 40 },
        { line_item: "profit_after_tax", value_reported: 200, source_page: 40 },
      ]),
    ],
  );
  return rows[0].id;
}

/** Every role that is not the figures desk. */
const OUTSIDERS = () =>
  [
    ["an analyst", analyst],
    ["an editor", editor],
    ["a fact checker", factChecker],
    ["a publisher", publisher],
    ["a reader", reader],
  ] as const;

describe("privilege escalation", () => {
  it("refuses every non-financial role the write functions, whatever actor they name", async () => {
    for (const [label, actor] of OUTSIDERS()) {
      // Each probe names the outsider as the actor. Calling makeStatement here
      // would write as `financial` and assert nothing about them, which is the
      // vacuous-probe mistake this file exists to avoid.
      const record = await expectSqlError(
        db.query(
          `select public.record_statement(
             $1, $2, 'income', 'FY', '2019-01-01', '2019-12-31', true, true, 'NGN', 'thousands', $3,
             '[{"line_item": "revenue", "value_reported": 1, "source_page": 1}]'::jsonb, null, null, null, null
           )`,
          [actor, company, document],
        ),
      );
      expect(record.code, `${label} record_statement`).toBe("42501");

      const review = await expectSqlError(
        db.query("select public.review_statement($1, $2, 'approved')", [pendingStatement, actor]),
      );
      expect(review.code, `${label} review_statement`).toBe("42501");

      const template = await expectSqlError(
        db.query("select public.assign_company_template($1, $2, 'bank', '2020-01-01', null)", [actor, company]),
      );
      expect(template.code, `${label} assign_company_template`).toBe("42501");

      const catalogue = await expectSqlError(
        db.query(
          "select public.upsert_statement_line($1, 'smuggled', 'Smuggled', 'income', 'currency', 'currency', 'positive', null)",
          [actor],
        ),
      );
      expect(catalogue.code, `${label} upsert_statement_line`).toBe("42501");

      const queue = await expectSqlError(
        db.query(
          `select public.record_figure_suggestions(
             $1, $2, $3, 'income', 'FY', '2019-01-01', '2019-12-31', 'NGN', 'thousands', 'manual_paste',
             '[{"line_item": "revenue", "value_reported": 1, "source_page": 1}]'::jsonb, null, null, null
           )`,
          [actor, company, document],
        ),
      );
      expect(queue.code, `${label} record_figure_suggestions`).toBe("42501");

      const decide = await expectSqlError(
        db.query("select public.decide_figure_suggestion($1, $2, 'accepted')", [suggestion, actor]),
      );
      expect(decide.code, `${label} decide_figure_suggestion`).toBe("42501");

      const close = await expectSqlError(
        db.query("select public.close_suggestion_batch($1, $2, null)", [batch, actor]),
      );
      expect(close.code, `${label} close_suggestion_batch`).toBe("42501");
    }
  });

  /**
   * The grants are the boundary, not the role check inside the function. A
   * client that can EXECUTE a definer function gets to choose the actor
   * argument, so EXECUTE must be revoked from every client role — and that is
   * invisible to the rest of this suite, which runs as the migration owner.
   */
  it("refuses a signed-in client EXECUTE on every write function", async () => {
    const calls: Array<[string, unknown[]]> = [
      [
        `select public.record_statement($1, $2, 'income', 'FY', '2019-01-01', '2019-12-31', true, true,
           'NGN', 'thousands', $3, '[]'::jsonb, null, null, null, null)`,
        [admin, company, document],
      ],
      ["select public.review_statement($1, $2, 'approved')", [pendingStatement, admin]],
      ["select public.assign_company_template($1, $2, 'bank', '2020-01-01', null)", [admin, company]],
      [
        "select public.upsert_statement_line($1, 'x', 'X', 'income', 'currency', 'currency', 'positive', null)",
        [admin],
      ],
      ["select public.set_template_line($1, 'core', 'revenue', false, false, 1, false)", [admin]],
      [
        "select public.record_company_succession($1, $2, $3, 'merger', '2022-01-01', 'year', $4, 2, null, null)",
        [admin, pendingCompany, company, document],
      ],
      ["select public.review_company_succession($1, $2, 'approved')", [batch, admin]],
      [
        `select public.record_figure_suggestions($1, $2, $3, 'income', 'FY', '2019-01-01', '2019-12-31',
           'NGN', 'thousands', 'manual_paste', '[]'::jsonb, null, null, null)`,
        [admin, company, document],
      ],
      ["select public.decide_figure_suggestion($1, $2, 'accepted')", [suggestion, admin]],
      ["select public.close_suggestion_batch($1, $2, null)", [batch, admin]],
    ];

    await asUser(db, admin, async () => {
      for (const [sql, params] of calls) {
        const error = await expectSqlError(db.query(sql, params));
        expect(error.code, sql.slice(0, 60)).toBe("42501");
        expect(error.message).toMatch(/permission denied/i);
      }
    });
  });

  it("refuses an unauthenticated caller the same functions", async () => {
    await db.exec("set role anon");
    try {
      const error = await expectSqlError(
        db.query("select public.review_statement($1, $2, 'approved')", [pendingStatement, admin]),
      );
      expect(error.code).toBe("42501");
      expect(error.message).toMatch(/permission denied/i);
    } finally {
      await db.exec("reset role");
    }
  });

  /**
   * `may_enter_figures` is called by server code to decide what the desk offers.
   * A client that could call it would learn who holds the role, and a client
   * that could pass any uuid would learn it about anyone.
   */
  it("keeps may_enter_figures away from clients", async () => {
    await asUser(db, admin, async () => {
      const error = await expectSqlError(db.query("select public.may_enter_figures($1)", [financial]));
      expect(error.code).toBe("42501");
    });
  });

  it("does not let the new role reach another desk's functions", async () => {
    // financial_analyst runs the figures desk and nothing else: the company and
    // leadership registers stay with 'analyst'.
    const person = await expectSqlError(
      db.query("select public.upsert_person($1, 'Smuggled Officer', null, null, null, null)", [financial]),
    );
    expect(person.code).toBe("42501");

    const company_ = await expectSqlError(
      db.query(
        `select public.upsert_company_profile(
           $1, 'Smuggled Plc', 'smuggled-plc', 'listed', null, null, null, null, null, null, null, 'SMUG', null
         )`,
        [financial],
      ),
    );
    expect(company_.code).toBe("42501");

    const document_ = await expectSqlError(
      db.query("select public.review_document($1, $2, 'approved')", [document, financial]),
    );
    expect(document_.code).toBe("42501");
  });
});

describe("what a reader can see", () => {
  it("hides a pending statement, a rejected one and the figures of an unapproved company", async () => {
    const rejected = await makeStatement({ periodEnd: "2018-12-31" });
    await db.query("select public.review_statement($1, $2, 'rejected', 'Wrong column.')", [rejected, admin]);

    for (const [label, actor] of OUTSIDERS()) {
      await asUser(db, actor, async () => {
        for (const [what, id] of [
          ["pending", pendingStatement],
          ["rejected", rejected],
          ["an unapproved company's", hiddenStatement],
        ] as const) {
          const { rows } = await db.query("select id from public.financial_statements where id = $1", [id]);
          expect(rows, `${label} sees ${what}`).toHaveLength(0);
          const { rows: lines } = await db.query(
            "select line_item from public.financial_statement_lines where statement_id = $1",
            [id],
          );
          expect(lines, `${label} sees ${what} lines`).toHaveLength(0);
        }
      });
    }
  });

  it("shows an approved statement of an approved company to anyone signed in", async () => {
    for (const [label, actor] of OUTSIDERS()) {
      await asUser(db, actor, async () => {
        const { rows } = await db.query("select id from public.financial_statements where id = $1", [
          approvedStatement,
        ]);
        expect(rows, `${label} sees the published statement`).toHaveLength(1);
      });
    }
  });

  it("hides the suggestion queue from everyone but the figures desk", async () => {
    for (const [label, actor] of OUTSIDERS()) {
      await asUser(db, actor, async () => {
        const { rows: batches } = await db.query("select id from public.figure_suggestion_batches where id = $1", [
          batch,
        ]);
        const { rows: suggestions } = await db.query("select id from public.figure_suggestions where id = $1", [
          suggestion,
        ]);
        expect(batches, `${label} sees the batch`).toHaveLength(0);
        expect(suggestions, `${label} sees the suggestion`).toHaveLength(0);
      });
    }
  });

  it("gives an unauthenticated caller nothing at all", async () => {
    await db.exec("set role anon");
    try {
      for (const table of [
        "financial_statements",
        "financial_statement_lines",
        "statement_line_catalogue",
        "statement_templates",
        "statement_template_lines",
        "company_statement_templates",
        "company_successions",
        "figure_suggestion_batches",
        "figure_suggestions",
      ]) {
        const error = await expectSqlError(db.query(`select * from public.${table} limit 1`));
        expect(error.code, table).toBe("42501");
      }
    } finally {
      await db.exec("reset role");
    }
  });

  it("refuses a client every kind of write on the tables themselves", async () => {
    await asUser(db, reader, async () => {
      const insert = await expectSqlError(
        db.query(
          "insert into public.financial_statement_lines (statement_id, line_item, value_standardised) values ($1, 'ebitda', 1)",
          [approvedStatement],
        ),
      );
      expect(insert.code).toBe("42501");

      const update = await expectSqlError(
        db.query("update public.financial_statements set review_status = 'approved' where id = $1", [
          pendingStatement,
        ]),
      );
      expect(update.code).toBe("42501");

      const del = await expectSqlError(
        db.query("delete from public.financial_statements where id = $1", [approvedStatement]),
      );
      expect(del.code).toBe("42501");

      const catalogue = await expectSqlError(
        db.query(
          "insert into public.statement_line_catalogue (line_item, label, statement_type, unit_kind, unit_label, standard_sign) values ('smuggled', 'S', 'income', 'currency', 'currency', 'positive')",
        ),
      );
      expect(catalogue.code).toBe("42501");

      const decide = await expectSqlError(
        db.query("update public.figure_suggestions set status = 'accepted' where id = $1", [suggestion]),
      );
      expect(decide.code).toBe("42501");
    });
  });
});

describe("the definer predicates answer no more than the row does", () => {
  /**
   * The standard stage 3b arrived at: a policy that hides a row but answers
   * questions about it is not hiding it. Each predicate is executable by
   * `authenticated` because a policy expression runs as the querying role, so
   * its answer has to equal the policy's answer.
   */
  it("statement_is_published agrees with what a reader can select", async () => {
    await asUser(db, reader, async () => {
      for (const [id, expected] of [
        [approvedStatement, true],
        [pendingStatement, false],
        [hiddenStatement, false],
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

  it("company_is_approved agrees with what a reader can select", async () => {
    await asUser(db, reader, async () => {
      for (const [id, expected] of [
        [company, true],
        [pendingCompany, false],
      ] as const) {
        const { rows } = await db.query<{ answer: boolean }>("select public.company_is_approved($1) as answer", [id]);
        const { rows: selected } = await db.query("select id from public.companies where id = $1", [id]);
        expect(rows[0].answer).toBe(expected);
        expect(selected.length > 0).toBe(expected);
      }
    });
  });

  it("company_succession_is_published agrees with what a reader can select", async () => {
    const { rows: created } = await db.query<{ id: string }>(
      `select public.record_company_succession(
         $1, $2, $3, 'merger', '2019-01-01', 'year', $4, 3, null, null
       ) as id`,
      [financial, pendingCompany, company, document],
    );
    const hidden = created[0].id;
    await db.query("select public.review_company_succession($1, $2, 'approved')", [hidden, admin]);

    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ answer: boolean }>(
        "select public.company_succession_is_published($1) as answer",
        [hidden],
      );
      const { rows: selected } = await db.query("select id from public.company_successions where id = $1", [hidden]);
      // Approved claim, but the predecessor is not approved, so neither the
      // predicate nor the select may admit it.
      expect(rows[0].answer).toBe(false);
      expect(selected).toHaveLength(0);
    });
  });

  it("keeps a reader out of the one predicate they have no business holding", async () => {
    await asUser(db, reader, async () => {
      const error = await expectSqlError(db.query("select public.may_enter_figures($1)", [reader]));
      expect(error.code).toBe("42501");
    });
  });
});

describe("integrity", () => {
  it("cannot turn a stored figure into a different one", async () => {
    const edits: Array<[string, unknown[]]> = [
      ["update public.financial_statement_lines set value_standardised = 99 where statement_id = $1", [approvedStatement]],
      ["update public.financial_statement_lines set value_reported = 99 where statement_id = $1", [approvedStatement]],
      ["update public.financial_statement_lines set source_page = 1 where statement_id = $1", [approvedStatement]],
      ["update public.financial_statements set currency = 'USD' where id = $1", [approvedStatement]],
      ["update public.financial_statements set magnitude = 'billions' where id = $1", [approvedStatement]],
      ["update public.financial_statements set period_end = '2030-12-31' where id = $1", [approvedStatement]],
      ["update public.financial_statements set entered_by = null where id = $1", [approvedStatement]],
      ["update public.financial_statements set ai_assisted = true where id = $1", [approvedStatement]],
    ];
    for (const [sql, params] of edits) {
      const error = await expectSqlError(db.query(sql, params));
      expect(error.code, sql.slice(0, 70)).toBe("42501");
    }
  });

  it("cannot walk a review backwards or around the allowed transitions", async () => {
    const rejected = await makeStatement({ periodEnd: "2017-12-31" });
    await db.query("select public.review_statement($1, $2, 'rejected', 'Not the right page.')", [rejected, admin]);

    const revive = await expectSqlError(
      db.query("update public.financial_statements set review_status = 'approved' where id = $1", [rejected]),
    );
    expect(revive.code).toBe("23514");

    const unapprove = await expectSqlError(
      db.query("update public.financial_statements set review_status = 'pending' where id = $1", [
        approvedStatement,
      ]),
    );
    expect(unapprove.code).toBe("23514");
  });

  it("cannot forge a standardised value that disagrees with the reported one", async () => {
    // The only writer computes it, so the attack is to insert a line directly
    // beside an existing statement. The guard refuses a line on a reviewed
    // statement, and the grants refuse the client outright.
    const error = await expectSqlError(
      db.query(
        `insert into public.financial_statement_lines
           (statement_id, line_item, value_standardised, value_reported, source_page)
         values ($1, 'ebitda', 999999, 1, 9)`,
        [approvedStatement],
      ),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/pending statement/);
  });

  it("cannot revive a decided suggestion or a closed batch", async () => {
    await db.query("select public.decide_figure_suggestion($1, $2, 'rejected', 'Read the wrong column.')", [
      suggestion,
      admin,
    ]);
    const second = await expectSqlError(
      db.query("select public.decide_figure_suggestion($1, $2, 'accepted')", [suggestion, admin]),
    );
    expect(second.code).toBe("23514");

    const direct = await expectSqlError(
      db.query("update public.figure_suggestions set status = 'accepted', decided_at = now() where id = $1", [
        suggestion,
      ]),
    );
    expect(direct.code).toBe("23514");

    await db.query("select public.close_suggestion_batch($1, $2, null)", [batch, admin]);
    const reopen = await expectSqlError(
      db.query("update public.figure_suggestion_batches set status = 'open', closed_at = null where id = $1", [
        batch,
      ]),
    );
    expect(reopen.code).toBe("23514");
  });

  it("cannot smuggle a control character into a label or a note", async () => {
    for (const [column, sql, params] of [
      [
        "catalogue label",
        "select public.upsert_statement_line($1, 'probe_line', $2, 'income', 'currency', 'currency', 'positive', null)",
        [admin, "Revenue\u0000injected"],
      ],
      [
        "line note",
        `select public.record_statement($1, $2, 'income', 'FY', '2016-01-01', '2016-12-31', true, true,
           'NGN', 'thousands', $3, $4::jsonb, null, null, null, null)`,
        [
          financial,
          company,
          document,
          JSON.stringify([
            { line_item: "revenue", value_reported: 1, source_page: 1, note: "ok\nsmuggled" },
            { line_item: "profit_before_tax", value_reported: 1, source_page: 1 },
            { line_item: "profit_after_tax", value_reported: 1, source_page: 1 },
          ]),
        ],
      ],
    ] as Array<[string, string, unknown[]]>) {
      const error = await expectSqlError(db.query(sql, params));
      // 22021 where the byte cannot be stored at all, 23514 where the check
      // refuses it. Either is a refusal; silence would not be.
      expect(["22021", "23514"], column).toContain(error.code);
    }
  });

  it("cannot enter a figure against a filing nobody approved", async () => {
    counter += 1;
    const { rows } = await db.query<{ id: string }>(
      `select public.record_uploaded_document(
         $1, 'companies.documents', 'issuer_ir', 'annual_report', 'Unapproved', $2, $3,
         'application/pdf', 4096, 'issuer_document', $4, null
       ) as id`,
      [analyst, `at/unapproved-${counter}.pdf`, sha256(`unapproved-${counter}`), company],
    );
    const error = await expectSqlError(makeStatement({ documentId: rows[0].id, periodEnd: "2015-12-31" }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/approved document/);
  });

  it("cannot point a suggestion batch at a statement it does not describe", async () => {
    const { rows: fresh } = await db.query<{ id: string }>(
      `select public.record_figure_suggestions(
         $1, $2, $3, 'income', 'FY', '2014-01-01', '2014-12-31', 'NGN', 'thousands', 'manual_paste',
         '[{"line_item": "revenue", "value_reported": 1, "source_page": 1}]'::jsonb, null, null, null
       ) as id`,
      [financial, company, document],
    );
    const error = await expectSqlError(
      db.query("select public.close_suggestion_batch($1, $2, $3)", [fresh[0].id, financial, approvedStatement]),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/different company, statement or period/);
  });
});
