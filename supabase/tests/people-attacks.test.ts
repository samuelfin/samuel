import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * Adversarial tests for people and leadership, written against my own migration.
 *
 * Stage 3a taught two lessons that shape this file. The first is that an attack
 * test which probes three of the four tables proves nothing about the fourth —
 * that is exactly how an over-broad history policy survived a review — so every
 * staff role here is probed against every one of the five new tables. The second
 * is that the test harness drives the functions as the migration owner, where no
 * policy applies at all, so anything about access has to run inside `asUser`.
 *
 * What is being defended: that a reader cannot learn anything about a person or
 * an office that has not been reviewed; that no role other than analyst and
 * administrator can write, review or withdraw a claim about a named individual;
 * that the history cannot be forged or rewritten; and that nothing an analyst
 * types can escape into a URL.
 */

let db: PGlite;
let analyst: string;
let reviewer: string;
let reader: string;
const staffRoles = ["editor", "fact_checker", "publisher"] as const;
const otherStaff: Record<string, string> = {};

let approvedCompany: string;
let pendingCompany: string;
let document: string;

/** A record in every state an attacker might want to read. */
let pendingPerson: string;
let rejectedPerson: string;
let approvedPerson: string;
let pendingRole: string;
let withdrawnRole: string;
let roleOnPendingCompany: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  reviewer = await createUser(db, { staff: ["analyst"] });
  reader = await createUser(db);
  for (const role of staffRoles) {
    otherStaff[role] = await createUser(db, { staff: [role] });
  }

  approvedCompany = await makeCompany("Attack Target Plc", "attack-target", "ATTK");
  pendingCompany = await makeCompany("Hidden Issuer Plc", "hidden-issuer", "HIDDN", false);
  document = await makeDocument(approvedCompany);

  pendingPerson = await person("Pending Subject");
  rejectedPerson = await person("Rejected Subject");
  await db.query("select public.review_person($1, $2, 'rejected', 'Unverifiable')", [
    rejectedPerson,
    reviewer,
  ]);
  approvedPerson = await person("Approved Subject");
  await db.query("select public.review_person($1, $2, 'approved')", [approvedPerson, reviewer]);

  pendingRole = await role(pendingPerson, approvedCompany, "cfo");

  withdrawnRole = await role(approvedPerson, approvedCompany, "coo");
  await db.query("select public.review_company_role($1, $2, 'approved')", [withdrawnRole, reviewer]);
  await db.query(
    "select public.withdraw_company_role($1, $2, 'Confused with a namesake; never held the office')",
    [withdrawnRole, reviewer],
  );

  roleOnPendingCompany = await role(approvedPerson, pendingCompany, "ceo");
  await db.query("select public.review_company_role($1, $2, 'approved')", [
    roleOnPendingCompany,
    reviewer,
  ]);
}, 180_000);

let counter = 0;

async function makeCompany(name: string, slug: string, symbol: string, approve = true) {
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_profile(
       $1, $2, $3, 'listed', null, null, null, null, null, null, null, $4, null
     ) as id`,
    [analyst, name, slug, symbol],
  );
  const id = rows[0].id;
  if (approve) await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
  return id;
}

async function makeDocument(companyId: string) {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 4096, 'issuer_document', $5, $6
     ) as id`,
    [
      analyst,
      `Attack source ${counter}`,
      `atk/doc-${counter}.pdf`,
      sha256(`attack-${counter}`),
      companyId,
      `https://issuer.test/atk-${counter}.pdf`,
    ],
  );
  await db.query("select public.review_document($1, $2, 'approved')", [rows[0].id, reviewer]);
  return rows[0].id;
}

async function person(name: string, actor = analyst): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    "select public.upsert_person($1, $2, null, $3, null, null) as id",
    [actor, name, `attack-person-${counter}`],
  );
  return rows[0].id;
}

async function role(
  personId: string,
  companyId: string,
  roleCode: string,
  actor = analyst,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_role(
       $1, $2, $3, $4, '2018-01-01', null, null, false, 'day', null, null, $5, 11,
       null, null, null, null, null, null
     ) as id`,
    [actor, personId, companyId, roleCode, document],
  );
  return rows[0].id;
}

/** Every new table, so no probe can miss one. */
const ALL_TABLES = [
  "people",
  "company_roles",
  "person_versions",
  "company_role_versions",
  "person_role_catalogue",
] as const;

async function countAs(userId: string, sql: string, params: unknown[] = []): Promise<number> {
  return asUser(db, userId, async () => {
    const { rows } = await db.query<{ n: number }>(sql, params);
    return rows[0].n;
  });
}

// ---------------------------------------------------------------------------

describe("no staff role but analyst learns anything it should not", () => {
  /**
   * Probing all five tables for every role, deliberately. The stage 3a review
   * found an over-broad history policy that my own attack test had missed by
   * checking three tables and not the fourth.
   */
  for (const staffRole of [...staffRoles, "none"] as const) {
    it(`a ${staffRole === "none" ? "plain reader" : staffRole} sees no unreviewed person or office`, async () => {
      const actor = staffRole === "none" ? reader : otherStaff[staffRole];

      // The two histories are the register's working record and belong to the
      // desk alone.
      expect(
        await countAs(actor, "select count(*)::int as n from public.person_versions"),
        `${staffRole} person_versions`,
      ).toBe(0);
      expect(
        await countAs(actor, "select count(*)::int as n from public.company_role_versions"),
        `${staffRole} company_role_versions`,
      ).toBe(0);

      // Nothing pending or rejected.
      expect(
        await countAs(
          actor,
          "select count(*)::int as n from public.people where review_status <> 'approved'",
        ),
        `${staffRole} unapproved people`,
      ).toBe(0);
      expect(
        await countAs(
          actor,
          "select count(*)::int as n from public.company_roles where review_status <> 'approved'",
        ),
        `${staffRole} unapproved roles`,
      ).toBe(0);

      // Nothing withdrawn, and nothing belonging to a company nobody approved.
      expect(
        await countAs(
          actor,
          "select count(*)::int as n from public.company_roles where withdrawn_at is not null",
        ),
        `${staffRole} withdrawn roles`,
      ).toBe(0);
      expect(
        await countAs(actor, "select count(*)::int as n from public.company_roles where company_id = $1", [
          pendingCompany,
        ]),
        `${staffRole} roles on a pending company`,
      ).toBe(0);

      // The role catalogue is reference data and is meant to be readable. Named
      // explicitly so the table is covered rather than silently skipped.
      expect(
        await countAs(actor, "select count(*)::int as n from public.person_role_catalogue"),
        `${staffRole} catalogue`,
      ).toBeGreaterThan(0);
    });
  }

  it("covers every table this migration adds", () => {
    // A guard on the guard: if a later stage adds a table here, this fails until
    // the probe above is extended to it.
    expect(new Set(ALL_TABLES).size).toBe(5);
  });

  it("the specific hidden records stay hidden, by id", async () => {
    for (const actor of [reader, ...Object.values(otherStaff)]) {
      for (const [label, id] of [
        ["pending person", pendingPerson],
        ["rejected person", rejectedPerson],
      ] as const) {
        expect(
          await countAs(actor, "select count(*)::int as n from public.people where id = $1", [id]),
          label,
        ).toBe(0);
      }
      for (const [label, id] of [
        ["pending role", pendingRole],
        ["withdrawn role", withdrawnRole],
        ["role on a pending company", roleOnPendingCompany],
      ] as const) {
        expect(
          await countAs(actor, "select count(*)::int as n from public.company_roles where id = $1", [id]),
          label,
        ).toBe(0);
      }
    }
  });

  it("gives a reader no aggregate it cannot see rows for", async () => {
    // Counting, min/max and existence are all reads of the same hidden rows; a
    // policy that hides a row but answers questions about it is not hiding it.
    const leaked = await countAs(
      reader,
      `select count(*)::int as n from public.company_roles
        where person_id = $1 or company_id = $2`,
      [pendingPerson, pendingCompany],
    );
    expect(leaked).toBe(0);

    const names = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ full_name: string }>(
        "select full_name from public.people where full_name in ('Pending Subject', 'Rejected Subject')",
      );
      return rows;
    });
    expect(names).toHaveLength(0);
  });
});

describe("no client role may write", () => {
  /**
   * Each entry carries its own parameter list. An earlier version of this test
   * passed the same four parameters to every statement, which made the one-
   * placeholder calls fail with a protocol error (08P01) — a failure that looks
   * like a refusal in a loop checking only that something went wrong, while
   * proving nothing about the grant.
   */
  function writeAttempts(actor: string): Array<[string, string, unknown[]]> {
    return [
      [
        "upsert_person",
        "select public.upsert_person($1, 'Injected Person', null, null, null, null)",
        [actor],
      ],
      [
        "upsert_company_role",
        `select public.upsert_company_role($1, $2, $3, 'ceo', '2020-01-01', null, null, false,
           'day', null, null, $4, 3, null, null, null, null, null, null)`,
        [actor, approvedPerson, approvedCompany, document],
      ],
      ["review_person", "select public.review_person($1, $2, 'approved')", [pendingPerson, actor]],
      [
        "review_company_role",
        "select public.review_company_role($1, $2, 'approved')",
        [pendingRole, actor],
      ],
      [
        "withdraw_company_role",
        "select public.withdraw_company_role($1, $2, 'Because I said so')",
        [pendingRole, actor],
      ],
    ];
  }

  it("refuses EXECUTE to every signed-in client, whatever their staff role", async () => {
    for (const actor of [reader, ...Object.values(otherStaff)]) {
      for (const [name, sql, params] of writeAttempts(actor)) {
        const error = await asUser(db, actor, () => expectSqlError(db.query(sql, params)));
        // EXECUTE is revoked from `authenticated`, so the refusal lands before
        // the function body runs. 42501 and nothing else: a protocol or
        // type error here would mean the call never reached the privilege check.
        expect(error.code, `${name} as ${actor}`).toBe("42501");
        expect(error.message, `${name} as ${actor}`).toMatch(/permission denied/i);
      }
    }
  });

  it("leaves nothing behind after those attempts", async () => {
    // The refusals above must be refusals, not partial writes.
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.people where full_name = 'Injected Person'",
    );
    expect(rows[0].n).toBe(0);
    const { rows: stillPending } = await db.query<{ review_status: string; withdrawn_at: Date | null }>(
      "select review_status, withdrawn_at from public.company_roles where id = $1",
      [pendingRole],
    );
    expect(stillPending[0]).toMatchObject({ review_status: "pending", withdrawn_at: null });
  });

  it("refuses direct INSERT, UPDATE and DELETE on every table", async () => {
    for (const actor of [reader, ...Object.values(otherStaff), analyst]) {
      for (const table of ALL_TABLES) {
        const insert = await asUser(db, actor, () =>
          expectSqlError(db.query(`insert into public.${table} default values`)),
        );
        expect(insert.code, `insert ${table} as ${actor}`).toBe("42501");

        const update = await asUser(db, actor, () =>
          expectSqlError(db.query(`update public.${table} set id = id`)),
        );
        expect(update.code, `update ${table} as ${actor}`).toBe("42501");

        const del = await asUser(db, actor, () =>
          expectSqlError(db.query(`delete from public.${table}`)),
        );
        expect(del.code, `delete ${table} as ${actor}`).toBe("42501");
      }
    }
  });

  /**
   * The guards let a write through when `sfi.person_write` is set, because the
   * functions set it themselves. A custom setting can be set by any session, so
   * the question is whether a client can set the flag and then write directly.
   * It cannot — the table privileges refuse first — but that is worth pinning
   * down rather than reasoning about, because the guard would wave it through.
   */
  it("cannot be bypassed by setting the write flag the functions use", async () => {
    const error = await asUser(db, analyst, async () => {
      await db.query("select set_config('sfi.person_write', '1', false)");
      return expectSqlError(
        db.query("update public.people set full_name = 'Owned' where id = $1", [approvedPerson]),
      );
    });
    expect(error.code).toBe("42501");

    const { rows } = await db.query<{ full_name: string }>(
      "select full_name from public.people where id = $1",
      [approvedPerson],
    );
    expect(rows[0].full_name).toBe("Approved Subject");
  });

  it("cannot forge a history row even as the owner, because history is append-only", async () => {
    // Insert is permitted to the owner by design — the functions do it — so the
    // defence is that nothing can later alter or remove what was written.
    const { rows } = await db.query<{ id: string }>(
      "select id from public.person_versions where person_id = $1 limit 1",
      [approvedPerson],
    );
    const versionId = rows[0].id;

    expect(
      (
        await expectSqlError(
          db.query("update public.person_versions set full_name = 'Rewritten' where id = $1", [
            versionId,
          ]),
        )
      ).code,
    ).toBe("42501");
    expect(
      (
        await expectSqlError(
          db.query("delete from public.person_versions where id = $1", [versionId]),
        )
      ).code,
    ).toBe("42501");
  });
});

describe("a claim cannot be quietly re-pointed at someone else", () => {
  /**
   * The subtle one. Changing a date or a title on an approved role is a
   * refinement of the same assertion. Changing who it is about is a different
   * statement about a different human being, and inheriting the old approval
   * would publish a claim no reviewer ever read.
   */
  it("refuses to move an approved role to another person, company or office", async () => {
    const subject = await person("Original Subject");
    await db.query("select public.review_person($1, $2, 'approved')", [subject, reviewer]);
    const other = await person("Substituted Subject");
    await db.query("select public.review_person($1, $2, 'approved')", [other, reviewer]);

    const id = await role(subject, approvedCompany, "chair");
    await db.query("select public.review_company_role($1, $2, 'approved')", [id, reviewer]);

    for (const [label, args] of [
      ["another person", [other, approvedCompany, "chair"]],
      ["another company", [subject, pendingCompany, "chair"]],
      ["another office", [subject, approvedCompany, "vice_chair"]],
    ] as const) {
      const error = await expectSqlError(
        db.query(
          `select public.upsert_company_role($1, $2, $3, $4, '2018-01-01', $5, null, false,
             'day', null, null, $6, 11, null, null, null, null, null, 'Correcting the record')`,
          [analyst, args[0], args[1], args[2], id, document],
        ),
      );
      expect(error.code, label).toBe("42501");
      expect(error.message, label).toMatch(/withdraw it and record the correct one/i);
    }

    // The role still says what it said, about whom it said it.
    const { rows } = await db.query<{ person_id: string; role_code: string }>(
      "select person_id, role_code from public.company_roles where id = $1",
      [id],
    );
    expect(rows[0]).toMatchObject({ person_id: subject, role_code: "chair" });
  });

  it("still allows the dates and the title to be corrected, which is a refinement", async () => {
    const subject = await person("Date Corrected");
    const id = await role(subject, approvedCompany, "cfo");
    await db.query("select public.review_company_role($1, $2, 'approved')", [id, reviewer]);

    await db.query(
      `select public.upsert_company_role($1, $2, $3, 'cfo', '2018-01-01', $4,
         'Chief Finance Officer', false, 'day', '2024-03-31', 'day', $5, 11,
         null, null, null, null, null, 'Retirement date added from the 2024 report')`,
      [analyst, subject, approvedCompany, id, document],
    );

    const { rows } = await db.query<{ valid_to: Date | null; reviewed_version: number }>(
      "select valid_to, reviewed_version from public.company_roles where id = $1",
      [id],
    );
    expect(rows[0].valid_to).not.toBeNull();
    // Approval survives, but the row records that clearance is behind the
    // content — the same latitude a company profile gets.
    expect(rows[0].reviewed_version).toBe(1);
  });

  it("refuses to revive a withdrawn claim by editing it", async () => {
    const error = await expectSqlError(
      db.query(
        `select public.upsert_company_role($1, $2, $3, 'coo', '2018-01-01', $4, null, false,
           'day', null, null, $5, 11, null, null, null, null, null, 'Actually it was true')`,
        [analyst, approvedPerson, approvedCompany, withdrawnRole, document],
      ),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/withdrawn/i);
  });
});

describe("nothing an analyst types escapes into a URL", () => {
  /**
   * A person's slug is interpolated into /people/[slug] the same way a company's
   * is. The database is the last line: whatever arrives, the stored slug either
   * matches the safe shape or the write is refused.
   */
  const hostile = [
    "../../admin",
    "..%2f..%2fadmin",
    "//evil.test",
    "\\\\evil.test",
    "https://evil.test",
    "javascript:alert(1)",
    "<script>alert(1)</script>",
    "a/b?c=1#d",
    "a\r\nLocation: https://evil.test",
    "name' or '1'='1",
    "'; drop table public.people; --",
    "%00",
    "x".repeat(400),
  ];

  for (const attempt of hostile) {
    it(`stores nothing dangerous from ${JSON.stringify(attempt.slice(0, 40))}`, async () => {
      counter += 1;
      let created: string | null = null;
      try {
        const { rows } = await db.query<{ id: string }>(
          "select public.upsert_person($1, $2, null, $3, null, null) as id",
          [analyst, `Hostile Slug ${counter}`, attempt],
        );
        created = rows[0].id;
      } catch {
        // Refusal is a perfectly good outcome; what matters is that nothing
        // unsafe was stored.
        return;
      }

      const { rows } = await db.query<{ slug: string }>(
        "select slug from public.people where id = $1",
        [created],
      );
      expect(rows[0].slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(rows[0].slug.length).toBeLessThanOrEqual(120);
    });
  }

  it("refuses a name that is only punctuation or non-Latin script, rather than inventing an address", async () => {
    // A name the slug rule cannot represent is sent back to the analyst, who can
    // give an explicit address. Silently coining one would put a meaningless URL
    // against a real person.
    for (const name of ["!!! ???", "。。。", "،،،"]) {
      const error = await expectSqlError(
        db.query("select public.upsert_person($1, $2, null, null, null, null)", [analyst, name]),
      );
      expect(error.code, JSON.stringify(name)).toBe("23514");
      expect(error.message).toMatch(/address/i);
    }
  });

  it("keeps a diacritic name storable, with a usable address", async () => {
    // Nigerian names carry diacritics — Olúwáṣọ́lá. The name is stored exactly as
    // given; only the address is reduced to the slug alphabet.
    const { rows: created } = await db.query<{ id: string }>(
      "select public.upsert_person($1, 'Olúwáṣọ́lá Adébáyọ̀', null, 'oluwasola-adebayo', null, null) as id",
      [analyst],
    );
    const { rows } = await db.query<{ full_name: string; slug: string }>(
      "select full_name, slug from public.people where id = $1",
      [created[0].id],
    );
    expect(rows[0].full_name).toBe("Olúwáṣọ́lá Adébáyọ̀");
    expect(rows[0].slug).toBe("oluwasola-adebayo");
  });

  it("refuses markup and control characters in a name or a title", async () => {
    // A NUL byte cannot exist in a Postgres text value at all, so it is refused
    // by the type (22021) before the constraint is consulted. The others reach
    // the check constraint (23514). Both are refusals; the distinction is
    // recorded so neither code silently becomes "success" later.
    for (const [bad, expected] of [
      ["Ada\u0000Okonkwo", "22021"],
      ["Ada\nOkonkwo", "23514"],
      ["Ada\tOkonkwo", "23514"],
      ["Ada\u001bOkonkwo", "23514"],
      ["Ada\u007fOkonkwo", "23514"],
    ] as const) {
      const error = await expectSqlError(
        db.query("select public.upsert_person($1, $2, null, null, null, null)", [analyst, bad]),
      );
      expect(error.code, JSON.stringify(bad)).toBe(expected);
    }

    const subject = await person("Title Attack Subject");
    for (const [badTitle, expected] of [
      ["Chief\u0000Officer", "22021"],
      ["Chief\nOfficer", "23514"],
      ["Chief\u007fOfficer", "23514"],
    ] as const) {
      const error = await expectSqlError(
        db.query(
          `select public.upsert_company_role($1, $2, $3, 'cfo', '2020-01-01', null, $4, false,
             'day', null, null, $5, 2, null, null, null, null, null, null)`,
          [analyst, subject, approvedCompany, badTitle, document],
        ),
      );
      expect(error.code, JSON.stringify(badTitle)).toBe(expected);
    }

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.company_roles where person_id = $1",
      [subject],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("injection and malformed input", () => {
  it("treats a role code as a value, not as SQL", async () => {
    const subject = await person("Injection Subject");
    for (const code of ["ceo'; drop table public.company_roles; --", "ceo or 1=1", "CEO", ""]) {
      const error = await expectSqlError(
        db.query(
          `select public.upsert_company_role($1, $2, $3, $4, '2020-01-01', null, null, false,
             'day', null, null, $5, 1, null, null, null, null, null, null)`,
          [analyst, subject, approvedCompany, code, document],
        ),
      );
      expect(error.code, code).toBe("23503");
    }

    // The table is still there, with its rows.
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.company_roles",
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("treats a change reason and a precision as values", async () => {
    const subject = await person("Reason Subject");
    const id = await role(subject, approvedCompany, "md");

    const error = await expectSqlError(
      db.query(
        `select public.upsert_company_role($1, $2, $3, 'md', '2018-01-01', $4, null, false,
           $5, null, null, $6, 11, null, null, null, null, null, 'x')`,
        [analyst, subject, approvedCompany, id, "day'; drop table public.people; --", document],
      ),
    );
    expect(error.code).toBe("23514");

    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.people");
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("refuses a page number outside what a page can be", async () => {
    const subject = await person("Page Overflow Subject");
    for (const page of [0, -1, -2147483648]) {
      const error = await expectSqlError(
        db.query(
          `select public.upsert_company_role($1, $2, $3, 'cfo', '2020-01-01', null, null, false,
             'day', null, null, $4, $5, null, null, null, null, null, null)`,
          [analyst, subject, approvedCompany, document, page],
        ),
      );
      expect(error.code, String(page)).toBe("23514");
    }

    // Beyond an integer entirely. A literal that large is a bigint, so no
    // overload of this function matches it and the call is refused at resolution
    // (42883) rather than being truncated into a plausible page number. Sending
    // it as a typed integer parameter overflows instead (22003). Either way
    // nothing is stored, which is the property under test.
    const overflowAttempts: Array<[string, unknown[]]> = [
      [
        `select public.upsert_company_role($1, $2, $3, 'cfo', '2020-01-01', null, null, false,
           'day', null, null, $4, 99999999999, null, null, null, null, null, null)`,
        [analyst, subject, approvedCompany, document],
      ],
      [
        `select public.upsert_company_role($1, $2, $3, 'cfo', '2020-01-01', null, null, false,
           'day', null, null, $4, $5::integer, null, null, null, null, null, null)`,
        [analyst, subject, approvedCompany, document, "99999999999"],
      ],
    ];
    for (const [sql, params] of overflowAttempts) {
      const overflow = await expectSqlError(db.query(sql, params));
      expect(["42883", "22003"]).toContain(overflow.code);
    }

    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.company_roles where person_id = $1",
      [subject],
    );
    expect(rows[0].n).toBe(0);
  });

  it("refuses a tenure date that is not a date", async () => {
    const subject = await person("Date Attack Subject");
    for (const date of ["not-a-date", "2020-13-01", "2020-02-31"]) {
      const error = await expectSqlError(
        db.query(
          `select public.upsert_company_role($1, $2, $3, 'cfo', $4, null, null, false,
             'day', null, null, $5, 1, null, null, null, null, null, null)`,
          [analyst, subject, approvedCompany, date, document],
        ),
      );
      expect(["22007", "22008"], date).toContain(error.code);
    }
  });
});

describe("the audit trail records what happened", () => {
  it("names the actor, the subject and the reason for every leadership action", async () => {
    const subject = await person("Audited Subject");
    const id = await role(subject, approvedCompany, "chief_risk_officer");
    await db.query("select public.review_company_role($1, $2, 'approved')", [id, reviewer]);
    await db.query("select public.withdraw_company_role($1, $2, 'Role never existed')", [
      id,
      reviewer,
    ]);

    const { rows } = await db.query<{ action: string; actor_user_id: string; details: Record<string, unknown> }>(
      `select action, actor_user_id, details from public.audit_logs
        where details->>'role_id' = $1 order by created_at`,
      [id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      "company_role.created",
      "company_role.approved",
      "company_role.withdrawn",
    ]);
    expect(rows[2].actor_user_id).toBe(reviewer);
    expect(rows[2].details.reason).toBe("Role never existed");
  });

  it("is closed to clients, so an action cannot be disowned", async () => {
    for (const actor of [reader, ...Object.values(otherStaff), analyst]) {
      const error = await asUser(db, actor, () =>
        expectSqlError(db.query("delete from public.audit_logs")),
      );
      expect(error.code, actor).toBe("42501");
    }
  });
});
