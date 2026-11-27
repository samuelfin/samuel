import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * A company that changed its name is the same company.
 *
 * That sentence is the whole test file. A rename is not a succession: the entity,
 * the registration and the figure history are unchanged, and only the label
 * moved. Recording one as the other would either split a continuous series into
 * two companies or splice two companies into one series, so the two records are
 * kept apart and these tests hold the line.
 *
 * And because "Formerly Lafarge Africa Plc (WAPCO), renamed July 2026" is a
 * published claim about a real company, it carries what every published claim
 * here carries: a source a reader can follow, and a person who approved it.
 */

let db: PGlite;
let analyst: string;
let financial: string;
let admin: string;
let reader: string;

let hbm: string;
let notice: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  financial = await createUser(db, { staff: ["financial_analyst"] });
  admin = await createUser(db, { admin: true });
  reader = await createUser(db);

  hbm = await makeCompany("HBM Nigeria Plc", "hbm-nigeria", "HBMNG");
  // Exists so that a rename can be caught trying to claim a live address.
  await makeCompany("Unrelated Issuer Plc", "unrelated-issuer", "UNRL");
  notice = await makeDocument(hbm);
}, 180_000);

afterEach(async () => {
  // A failed assertion inside a transaction skips the rollback written after it,
  // and every later statement on the connection then fails with 25P02 — one
  // real failure reading as eleven. Rolling back unconditionally costs a warning
  // when nothing is open and keeps the suite honest.
  await db.query("rollback").catch(() => undefined);
});

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

async function makeDocument(companyId: string, opts: { approve?: boolean } = {}): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'circular', $2, $3, $4,
       'application/pdf', 4096, 'issuer_document', $5, 'https://ngx.test/bulletin.pdf'
     ) as id`,
    [analyst, `NGX market bulletin ${counter}`, `ngx/bulletin-${counter}.pdf`, sha256(`bulletin-${counter}`), companyId],
  );
  if (opts.approve !== false) {
    await db.query("select public.review_document($1, $2, 'approved')", [rows[0].id, admin]);
  }
  return rows[0].id;
}

interface RenameInput {
  actor?: string;
  companyId?: string;
  formerName?: string;
  formerSlug?: string;
  effectiveOn?: string;
  precision?: string;
  formerSymbol?: string | null;
  documentId?: string | null;
  sourcePage?: number | null;
  announcementId?: string | null;
}

async function record(opts: RenameInput = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.record_company_rename(
       $1, $2, $3, $4, $5, $6, $7, null, $8, $9, $10, null
     ) as id`,
    [
      opts.actor ?? analyst,
      opts.companyId ?? hbm,
      opts.formerName ?? "Lafarge Africa Plc",
      opts.formerSlug ?? "lafarge-africa",
      opts.effectiveOn ?? "2026-07-09",
      opts.precision ?? "month",
      opts.formerSymbol === undefined ? "WAPCO" : opts.formerSymbol,
      opts.documentId === undefined ? notice : opts.documentId,
      opts.sourcePage === undefined ? 1 : opts.sourcePage,
      opts.announcementId ?? null,
    ],
  );
  return rows[0].id;
}

describe("recording a rename", () => {
  it("keeps the name, the ticker, the address and the date it took effect", async () => {
    await db.query("begin");
    const id = await record();
    const { rows } = await db.query<{
      former_name: string;
      former_symbol: string;
      former_slug: string;
      effective_on: Date;
      effective_precision: string;
      review_status: string;
      recorded_by: string;
    }>(
      `select former_name, former_symbol, former_slug, effective_on, effective_precision,
              review_status, recorded_by
         from public.company_renames where id = $1`,
      [id],
    );
    expect(rows[0].former_name).toBe("Lafarge Africa Plc");
    expect(rows[0].former_symbol).toBe("WAPCO");
    expect(rows[0].former_slug).toBe("lafarge-africa");
    expect(rows[0].effective_precision).toBe("month");
    expect(rows[0].recorded_by).toBe(analyst);
    // Pending, so no reader sees the line yet.
    expect(rows[0].review_status).toBe("pending");
    await db.query("rollback");
  });

  it("refuses a rename that cites nothing", async () => {
    const error = await expectSqlError(
      record({ documentId: null, sourcePage: null, announcementId: null }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/cite the notice that announced it/i);
  });

  it("refuses a document nobody approved, or one whose licence is unverified", async () => {
    const unapproved = await makeDocument(hbm, { approve: false });
    const error = await expectSqlError(record({ documentId: unapproved }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/approved document/i);
  });

  it("insists a cited document is cited to a page", async () => {
    const error = await expectSqlError(record({ sourcePage: null }));
    expect(error.code).toBe("23514");
  });

  it("refuses an address another approved company lives at now", async () => {
    // The redirect would hand a reader the wrong company, and by the time
    // somebody followed it nobody would be watching.
    const error = await expectSqlError(record({ formerSlug: "unrelated-issuer" }));
    expect(error.code).toBe("23505");
    expect(error.message).toMatch(/lives at that address now/i);
  });

  it("refuses a company having been formerly itself", async () => {
    const error = await expectSqlError(record({ formerSlug: "hbm-nigeria" }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/lives at now, not a former one/i);
  });

  it("is refused to a reader and to the editorial desk", async () => {
    const editor = await createUser(db, { staff: ["editor"] });
    for (const who of [reader, editor]) {
      const error = await expectSqlError(record({ actor: who }));
      expect(error.code).toBe("42501");
    }
    // The register's own role may record one, and so may the figures desk.
    await db.query("begin");
    await record({ actor: financial });
    await db.query("rollback");
  });

  it("is fixed once recorded", async () => {
    // Each refusal gets its own savepoint: the first error aborts whatever it is
    // in, and a second statement there would fail for that reason rather than
    // the one being tested.
    await db.query("begin");
    const id = await record();
    await db.query("savepoint before_edit");
    const edit = await expectSqlError(
      db.query("update public.company_renames set former_name = 'Something Else Plc' where id = $1", [id]),
    );
    expect(edit.code).toBe("42501");

    await db.query("rollback to savepoint before_edit");
    const remove = await expectSqlError(
      db.query("delete from public.company_renames where id = $1", [id]),
    );
    expect(remove.code).toBe("42501");
    await db.query("rollback");
  });
});

describe("reviewing a rename", () => {
  it("publishes it, and flags a self-review", async () => {
    await db.query("begin");
    const id = await record();
    await db.query("select public.review_company_rename($1, $2, 'approved', 'Checked against the bulletin.')", [
      id,
      analyst,
    ]);
    const { rows } = await db.query<{ review_status: string; review_self_approved: boolean }>(
      "select review_status, review_self_approved from public.company_renames where id = $1",
      [id],
    );
    expect(rows[0].review_status).toBe("approved");
    expect(rows[0].review_self_approved).toBe(true);
    await db.query("rollback");
  });

  it("refuses a self-review outright where two people are required", async () => {
    await db.query("begin");
    const id = await record();
    await db.query(
      "update public.platform_settings set value = 'true'::jsonb where key = 'review.require_two_person'",
    );
    const error = await expectSqlError(
      db.query("select public.review_company_rename($1, $2, 'approved', 'Looks right.')", [id, analyst]),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/other than the person who recorded/i);
    await db.query("rollback");
  });

  it("needs a reason to reject, and decides only once", async () => {
    await db.query("begin");
    const id = await record();
    await db.query("savepoint before_reject");
    const reasonless = await expectSqlError(
      db.query("select public.review_company_rename($1, $2, 'rejected', null)", [id, admin]),
    );
    expect(reasonless.code).toBe("23514");
    await db.query("rollback to savepoint before_reject");

    await db.query("select public.review_company_rename($1, $2, 'rejected', 'The bulletin says otherwise.')", [
      id,
      admin,
    ]);
    await db.query("savepoint before_second");
    const again = await expectSqlError(
      db.query("select public.review_company_rename($1, $2, 'approved', 'Changed my mind.')", [id, admin]),
    );
    expect(again.code).toBe("23514");
    expect(again.message).toMatch(/already been rejected/i);
    await db.query("rollback");
  });
});

describe("who sees the Formerly line", () => {
  it("is kept from readers until it is approved", async () => {
    await db.query("begin");
    const id = await record();

    for (const [who, visible] of [
      [reader, 0],
      [analyst, 1],
      [financial, 1],
      [admin, 1],
    ] as const) {
      await asUser(db, who, async () => {
        const { rows } = await db.query<{ count: number }>(
          "select count(*)::int as count from public.company_renames where id = $1",
          [id],
        );
        expect(rows[0].count).toBe(visible);
      });
    }

    await db.query("select public.review_company_rename($1, $2, 'approved', 'Checked.')", [id, admin]);
    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ former_name: string }>(
        "select former_name from public.company_renames where id = $1",
        [id],
      );
      expect(rows[0].former_name).toBe("Lafarge Africa Plc");
    });
    await db.query("rollback");
  });

  it("is kept from readers while the company itself is unreviewed", async () => {
    await db.query("begin");
    const pending = await makeCompany("Pending Issuer Plc", "pending-issuer", "PEND", false);
    const document = await makeDocument(pending);
    const id = await record({
      companyId: pending,
      formerSlug: "pending-issuer-old",
      formerName: "Pending Issuer (old) Plc",
      documentId: document,
    });
    await db.query("select public.review_company_rename($1, $2, 'approved', 'Checked.')", [id, admin]);

    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ count: number }>(
        "select count(*)::int as count from public.company_renames where id = $1",
        [id],
      );
      expect(rows[0].count).toBe(0);
    });
    await db.query("rollback");
  });

  it("lets nobody write one through the table", async () => {
    for (const who of [reader, analyst, admin]) {
      await asUser(db, who, async () => {
        const error = await expectSqlError(
          db.query(
            `insert into public.company_renames (company_id, former_name, former_slug, effective_on, effective_precision, document_id, source_page)
             values ($1, 'Smuggled Plc', 'smuggled', '2026-01-01', 'year', $2, 1)`,
            [hbm, notice],
          ),
        );
        expect(error.code).toBe("42501");
      });
    }
  });
});

describe("finding a company by what it used to be called", () => {
  it("resolves a former address once the rename is approved, and not before", async () => {
    await db.query("begin");
    const id = await record();

    await asUser(db, reader, async () => {
      const pending = await db.query<{ slug: string | null }>(
        "select public.company_slug_for_former_slug('lafarge-africa') as slug",
      );
      expect(pending.rows[0].slug).toBeNull();
    });

    await db.query("select public.review_company_rename($1, $2, 'approved', 'Checked.')", [id, admin]);

    await asUser(db, reader, async () => {
      const resolved = await db.query<{ slug: string | null }>(
        "select public.company_slug_for_former_slug('lafarge-africa') as slug",
      );
      expect(resolved.rows[0].slug).toBe("hbm-nigeria");
    });
    await db.query("rollback");
  });

  it("resolves a former ticker, and never one somebody holds now", async () => {
    await db.query("begin");
    const id = await record();
    await db.query("select public.review_company_rename($1, $2, 'approved', 'Checked.')", [id, admin]);

    await asUser(db, reader, async () => {
      const byFormer = await db.query<{ slug: string | null }>(
        "select public.company_slug_for_former_symbol('WAPCO') as slug",
      );
      expect(byFormer.rows[0].slug).toBe("hbm-nigeria");

      // Case and spacing are the reader's, not the exchange's.
      const messy = await db.query<{ slug: string | null }>(
        "select public.company_slug_for_former_symbol('  wapco ') as slug",
      );
      expect(messy.rows[0].slug).toBe("hbm-nigeria");
    });

    // A live symbol always wins. An exchange reassigns a ticker; hand a reader
    // the company that holds it now, or nothing — never last year's owner.
    await makeCompany("Reassigned Ticker Plc", "reassigned-ticker", "WAPCO");
    await asUser(db, reader, async () => {
      const taken = await db.query<{ slug: string | null }>(
        "select public.company_slug_for_former_symbol('WAPCO') as slug",
      );
      expect(taken.rows[0].slug).toBeNull();
    });
    await db.query("rollback");
  });

  it("still resolves an address the desk changed, as it did before", async () => {
    // The 3a behaviour this function replaces: a slug changed through the desk
    // leaves a profile version behind, and that still answers.
    await db.query("begin");
    const desk = await makeCompany("Renamed By Desk Plc", "renamed-by-desk-old", "RNMD");
    // p_company_id is the fifth argument, which is what makes this an update to
    // that company rather than a second company wearing the same ticker.
    await db.query(
      `select public.upsert_company_profile(
         $1, 'Renamed By Desk Plc', 'renamed-by-desk-new', 'listed', $2,
         null, null, null, null, null, null, 'RNMD', 'Change of address through the desk.'
       )`,
      [analyst, desk],
    );
    await asUser(db, reader, async () => {
      const { rows } = await db.query<{ slug: string | null }>(
        "select public.company_slug_for_former_slug('renamed-by-desk-old') as slug",
      );
      expect(rows[0].slug).toBe("renamed-by-desk-new");
    });
    await db.query("rollback");
  });
});

describe("a rename is not a succession", () => {
  it("creates no predecessor company and no second series", async () => {
    await db.query("begin");
    const id = await record();
    await db.query("select public.review_company_rename($1, $2, 'approved', 'Checked.')", [id, admin]);

    // One company, before and after. A succession would have introduced a
    // second company whose figures stay separate under rule 5.
    const { rows } = await db.query<{ count: number }>(
      "select count(*)::int as count from public.companies where slug in ('hbm-nigeria', 'lafarge-africa')",
    );
    expect(rows[0].count).toBe(1);

    const successions = await db.query<{ count: number }>(
      "select count(*)::int as count from public.company_successions where successor_company_id = $1",
      [hbm],
    );
    expect(successions.rows[0].count).toBe(0);
    await db.query("rollback");
  });
});
