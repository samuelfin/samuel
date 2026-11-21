import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * Leadership is the first thing this platform publishes about a named private
 * individual, so these tests hold three guarantees the rest of the schema does
 * not need.
 *
 * Every role cites evidence a reader can follow — an approved, citable document
 * and the page, or a published announcement. Tenure dates record how precise the
 * source actually was, so "appointed 2015" is never stored as 12 March 2015. And
 * a claim we no longer stand behind leaves the published record rather than
 * staying on display with a label, which is the opposite of how a withdrawn
 * announcement behaves and is deliberate: for personal data, continuing to
 * publish a wrong claim is itself the accuracy failure.
 */

let db: PGlite;
let analyst: string;
let reviewer: string;
let admin: string;
let editor: string;
let reader: string;

let company: string;
let otherCompany: string;
let pendingCompany: string;
let document: string;
let announcement: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  reviewer = await createUser(db, { staff: ["analyst"] });
  admin = await createUser(db, { admin: true });
  editor = await createUser(db, { staff: ["editor"] });
  reader = await createUser(db);

  company = await makeCompany("Leadership Bank Plc", "leadership-bank", "LEADB");
  otherCompany = await makeCompany("Second Issuer Plc", "second-issuer", "SECND");
  pendingCompany = await makeCompany("Unreviewed Plc", "unreviewed-co", "UNREV", false);
  document = await makeDocument(company);
  announcement = await makeAnnouncement(company);
}, 180_000);

let counter = 0;

async function makeCompany(
  name: string,
  slug: string,
  symbol: string,
  approve = true,
): Promise<string> {
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
      `Leadership source ${counter}`,
      `ld/doc-${counter}.pdf`,
      sha256(`leadership-${counter}`),
      opts.licence ?? "issuer_document",
      companyId,
      `https://issuer.test/report-${counter}.pdf`,
    ],
  );
  const id = rows[0].id;
  if (opts.approve !== false) {
    await db.query("select public.review_document($1, $2, 'approved')", [id, reviewer]);
  }
  return id;
}

async function makeAnnouncement(companyId: string): Promise<string> {
  const source = await makeDocument(companyId);
  const { rows } = await db.query<{ id: string }>(
    `select public.publish_announcement(
       $1, $2, 'board_change', 'Board appointment', now() - interval '1 day',
       null, false, $3, null, null
     ) as id`,
    [analyst, source, companyId],
  );
  return rows[0].id;
}

interface PersonInput {
  actor?: string;
  name?: string;
  personId?: string | null;
  slug?: string | null;
  honorific?: string | null;
  reason?: string | null;
}

async function upsertPerson(opts: PersonInput = {}): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    "select public.upsert_person($1, $2, $3, $4, $5, $6) as id",
    [
      opts.actor ?? analyst,
      // `=== undefined`, not `??`: a test that means to send null must send it.
      // `??` would quietly substitute the default and assert nothing.
      opts.name === undefined ? `Example Person ${counter}` : opts.name,
      opts.personId ?? null,
      opts.slug === undefined ? null : opts.slug,
      opts.honorific === undefined ? null : opts.honorific,
      opts.reason ?? null,
    ],
  );
  return rows[0].id;
}

interface RoleInput {
  actor?: string;
  personId?: string;
  companyId?: string;
  roleCode?: string;
  validFrom?: string;
  roleId?: string | null;
  roleTitle?: string | null;
  isActing?: boolean;
  fromPrecision?: string | null;
  validTo?: string | null;
  toPrecision?: string | null;
  documentId?: string | null;
  sourcePage?: number | null;
  announcementId?: string | null;
  confirmedOn?: string | null;
  confirmDocumentId?: string | null;
  confirmPage?: number | null;
  confirmAnnouncementId?: string | null;
  reason?: string | null;
}

async function upsertRole(opts: RoleInput = {}): Promise<string> {
  const usesAnnouncement = opts.announcementId !== undefined && opts.announcementId !== null;
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_role(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
     ) as id`,
    [
      opts.actor ?? analyst,
      opts.personId ?? (await upsertPerson()),
      opts.companyId ?? company,
      opts.roleCode ?? "ceo",
      // `=== undefined`, not `??`. With `??` a test passing null for the start
      // date got the default instead, so "needs a start date" asserted nothing.
      opts.validFrom === undefined ? "2015-03-12" : opts.validFrom,
      opts.roleId ?? null,
      opts.roleTitle === undefined ? null : opts.roleTitle,
      opts.isActing ?? false,
      opts.fromPrecision === undefined ? "day" : opts.fromPrecision,
      opts.validTo === undefined ? null : opts.validTo,
      opts.toPrecision === undefined ? null : opts.toPrecision,
      // A document page is the default evidence; pass an announcement to use that
      // instead, and the document is dropped so exactly one source is sent.
      opts.documentId === undefined ? (usesAnnouncement ? null : document) : opts.documentId,
      opts.sourcePage === undefined ? (usesAnnouncement ? null : 42) : opts.sourcePage,
      opts.announcementId === undefined ? null : opts.announcementId,
      opts.confirmedOn === undefined ? null : opts.confirmedOn,
      opts.confirmDocumentId === undefined ? null : opts.confirmDocumentId,
      opts.confirmPage === undefined ? null : opts.confirmPage,
      opts.confirmAnnouncementId === undefined ? null : opts.confirmAnnouncementId,
      opts.reason ?? null,
    ],
  );
  return rows[0].id;
}

async function personRow(id: string) {
  const { rows } = await db.query<{
    slug: string;
    full_name: string;
    honorific: string | null;
    review_status: string;
    review_self_approved: boolean;
    reviewed_by: string | null;
    reviewed_version: number | null;
  }>(
    `select slug, full_name, honorific, review_status, review_self_approved, reviewed_by,
            reviewed_version
       from public.people where id = $1`,
    [id],
  );
  return rows[0];
}

async function roleRow(id: string) {
  const { rows } = await db.query<{
    role_code: string;
    role_title: string | null;
    is_acting: boolean;
    valid_from: Date;
    valid_from_precision: string;
    valid_to: Date | null;
    valid_to_precision: string | null;
    source_page: number | null;
    announcement_id: string | null;
    last_confirmed_on: Date | null;
    last_confirmed_source_page: number | null;
    review_status: string;
    review_self_approved: boolean;
    withdrawn_at: Date | null;
    withdrawal_reason: string | null;
    reviewed_version: number | null;
  }>(
    `select role_code, role_title, is_acting, valid_from, valid_from_precision, valid_to,
            valid_to_precision, source_page, announcement_id, last_confirmed_on,
            last_confirmed_source_page, review_status, review_self_approved, withdrawn_at,
            withdrawal_reason, reviewed_version
       from public.company_roles where id = $1`,
    [id],
  );
  return rows[0];
}

async function personVersions(id: string) {
  const { rows } = await db.query<{
    version: number;
    slug: string;
    full_name: string;
    honorific: string | null;
    change_reason: string | null;
    changed_by: string | null;
  }>(
    `select version, slug, full_name, honorific, change_reason, changed_by
       from public.person_versions where person_id = $1 order by version`,
    [id],
  );
  return rows;
}

async function roleVersions(id: string) {
  const { rows } = await db.query<{
    version: number;
    role_code: string;
    valid_from: Date;
    valid_to: Date | null;
    is_acting: boolean;
    change_reason: string | null;
    changed_by: string | null;
  }>(
    `select version, role_code, valid_from, valid_to, is_acting, change_reason, changed_by
       from public.company_role_versions where role_id = $1 order by version`,
    [id],
  );
  return rows;
}

// ---------------------------------------------------------------------------

describe("the role catalogue", () => {
  it("holds the offices Nigerian filings name, with their governance class", async () => {
    const { rows } = await db.query<{ id: string; is_executive: boolean; is_board: boolean }>(
      "select id, is_executive, is_board from public.person_role_catalogue order by sort_order",
    );
    const byId = new Map(rows.map((r) => [r.id, r]));

    // A chairman sits on the board without being an executive; an executive
    // director is both; a CEO who is not a director is executive only. The page
    // splits its panels on these, so getting them wrong mislabels a board.
    expect(byId.get("chair")).toMatchObject({ is_executive: false, is_board: true });
    expect(byId.get("executive_director")).toMatchObject({ is_executive: true, is_board: true });
    expect(byId.get("ceo")).toMatchObject({ is_executive: true, is_board: false });
    expect(byId.get("independent_non_executive_director")).toMatchObject({
      is_executive: false,
      is_board: true,
    });
    expect(byId.has("gmd_ceo")).toBe(true);
  });

  it("is readable by any signed-in user, being reference data", async () => {
    const seen = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.person_role_catalogue",
      );
      return rows[0].n;
    });
    expect(seen).toBeGreaterThan(10);
  });
});

describe("a person record", () => {
  it("derives its address from the name", async () => {
    const id = await upsertPerson({ name: "Ada Okonkwo-Bello" });
    expect((await personRow(id)).slug).toBe("ada-okonkwo-bello");
  });

  it("normalises a given address rather than refusing its spacing", async () => {
    const id = await upsertPerson({ name: "Bola Adeyemi", slug: "  Bola   Adeyemi  " });
    expect((await personRow(id)).slug).toBe("bola-adeyemi");
  });

  it("keeps the honorific the filing carries", async () => {
    const id = await upsertPerson({ name: "Chike Obi", honorific: "  Chief  " });
    expect((await personRow(id)).honorific).toBe("Chief");
  });

  it("treats an empty honorific as none given", async () => {
    const id = await upsertPerson({ name: "Dapo Iyen", honorific: "   " });
    expect((await personRow(id)).honorific).toBeNull();
  });

  it("refuses a name that is not one", async () => {
    for (const name of ["", " ", "A", "x".repeat(201)]) {
      const error = await expectSqlError(upsertPerson({ name }));
      expect(error.code, JSON.stringify(name)).toBe("23514");
    }
  });

  it("refuses a name carrying a line break", async () => {
    const error = await expectSqlError(upsertPerson({ name: "Ada\nOkonkwo" }));
    expect(error.code).toBe("23514");
  });

  it("refuses a name that reduces to no address", async () => {
    const error = await expectSqlError(upsertPerson({ name: "!!! ???" }));
    expect(error.code).toBe("23514");
  });

  /**
   * The identity decision, enforced. Two people genuinely share a name, and
   * merging two records that turn out to be different people is worse than
   * leaving them apart — so the second one is refused and handed back rather
   * than quietly given "-2".
   */
  it("refuses a second person at the same address instead of inventing one", async () => {
    const first = await upsertPerson({ name: "Samuel Eze" });
    const error = await expectSqlError(upsertPerson({ name: "Samuel Eze" }));
    expect(error.code).toBe("23505");
    expect(error.message).toMatch(/distinct address/i);
    // The existing record is untouched: no silent renaming of a real person.
    expect((await personRow(first)).slug).toBe("samuel-eze");
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.people where slug = 'samuel-eze'",
    );
    expect(rows[0].n).toBe(1);
  });

  it("lets a namesake in under a distinct address", async () => {
    await upsertPerson({ name: "Ngozi Bello" });
    const second = await upsertPerson({ name: "Ngozi Bello", slug: "ngozi-bello-gtco" });
    expect((await personRow(second)).slug).toBe("ngozi-bello-gtco");
  });

  it("records version 1 on creation", async () => {
    const id = await upsertPerson({ name: "Femi Oluwa" });
    const versions = await personVersions(id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 1, full_name: "Femi Oluwa", changed_by: analyst });
  });

  it("requires a reason for an edit, and keeps both versions", async () => {
    const id = await upsertPerson({ name: "Grace Umeh" });

    const error = await expectSqlError(
      upsertPerson({ personId: id, name: "Grace Umeh-Nwosu" }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/why/i);

    await upsertPerson({
      personId: id,
      name: "Grace Umeh-Nwosu",
      slug: "grace-umeh",
      reason: "Married name, per the 2026 annual report",
    });

    const versions = await personVersions(id);
    expect(versions.map((v) => v.full_name)).toEqual(["Grace Umeh", "Grace Umeh-Nwosu"]);
    expect(versions[1].change_reason).toMatch(/Married name/);
    // The address is unchanged, so an existing link does not break.
    expect((await personRow(id)).slug).toBe("grace-umeh");
  });

  it("refuses a save that changes nothing", async () => {
    const id = await upsertPerson({ name: "Henry Ade" });
    const error = await expectSqlError(
      upsertPerson({ personId: id, name: "Henry Ade", reason: "No change at all" }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/Nothing changed/i);
  });

  it("cannot be written by a role that does not keep the register", async () => {
    for (const actor of [editor, reader]) {
      const error = await expectSqlError(upsertPerson({ actor, name: "Forbidden Entry" }));
      expect(error.code).toBe("42501");
    }
  });

  it("can be written by a platform administrator", async () => {
    const id = await upsertPerson({ actor: admin, name: "Admin Entered" });
    expect((await personRow(id)).full_name).toBe("Admin Entered");
  });
});

describe("reviewing a person", () => {
  it("approves, and flags that the author cleared their own work", async () => {
    const id = await upsertPerson({ name: "Self Reviewed" });
    await db.query("select public.review_person($1, $2, 'approved')", [id, analyst]);
    const row = await personRow(id);
    expect(row).toMatchObject({
      review_status: "approved",
      review_self_approved: true,
      reviewed_by: analyst,
      reviewed_version: 1,
    });
  });

  it("does not flag a review by someone else", async () => {
    const id = await upsertPerson({ name: "Independently Reviewed" });
    await db.query("select public.review_person($1, $2, 'approved')", [id, reviewer]);
    expect((await personRow(id)).review_self_approved).toBe(false);
  });

  /**
   * The polarity bug that has appeared three times in this codebase, pinned down
   * on its first outing here. When the author's account is gone the foreign key
   * has nulled the actor, and reading "someone independent reviewed this" out of
   * that null would assert a second pair of eyes nobody can produce.
   */
  it("treats unknown authorship as self-reviewed, not as independent review", async () => {
    const leaver = await createUser(db, { staff: ["analyst"] });
    const id = await upsertPerson({ actor: leaver, name: "Author Departed" });
    await db.query("delete from auth.users where id = $1", [leaver]);
    expect((await personVersions(id))[0].changed_by).toBeNull();

    await db.query("select public.review_person($1, $2, 'approved')", [id, reviewer]);
    expect((await personRow(id)).review_self_approved).toBe(true);
  });

  it("requires a reason to reject", async () => {
    const id = await upsertPerson({ name: "Rejected Person" });
    const error = await expectSqlError(
      db.query("select public.review_person($1, $2, 'rejected')", [id, reviewer]),
    );
    expect(error.code).toBe("23514");

    await db.query("select public.review_person($1, $2, 'rejected', 'Could not verify the name')", [
      id,
      reviewer,
    ]);
    expect((await personRow(id)).review_status).toBe("rejected");
  });

  it("refuses a decision that is neither approval nor rejection", async () => {
    const id = await upsertPerson({ name: "Odd Decision" });
    const error = await expectSqlError(
      db.query("select public.review_person($1, $2, 'pending')", [id, reviewer]),
    );
    expect(error.code).toBe("23514");
  });

  it("will not re-approve something nobody has touched, but will once it changes", async () => {
    const id = await upsertPerson({ name: "Twice Reviewed" });
    await db.query("select public.review_person($1, $2, 'approved')", [id, reviewer]);

    const error = await expectSqlError(
      db.query("select public.review_person($1, $2, 'approved')", [id, reviewer]),
    );
    expect(error.code).toBe("23514");

    await upsertPerson({ personId: id, name: "Twice Reviewed Again", reason: "Spelling" });
    // The edit does not unpublish the person, but it does record that the
    // clearance is behind the content.
    const mid = await personRow(id);
    expect(mid.review_status).toBe("approved");
    expect(mid.reviewed_version).toBe(1);

    await db.query("select public.review_person($1, $2, 'approved')", [id, reviewer]);
    expect((await personRow(id)).reviewed_version).toBe(2);
  });

  it("cannot be reviewed by a role that does not keep the register", async () => {
    const id = await upsertPerson({ name: "Guarded Review" });
    for (const actor of [editor, reader]) {
      const error = await expectSqlError(
        db.query("select public.review_person($1, $2, 'approved')", [id, actor]),
      );
      expect(error.code).toBe("42501");
    }
  });

  it("blocks self-review once the platform requires two people", async () => {
    await db.query(
      `insert into public.platform_settings (key, value) values ('review.require_two_person', 'true'::jsonb)
       on conflict (key) do update set value = excluded.value`,
    );
    const id = await upsertPerson({ name: "Two Person Rule" });
    const error = await expectSqlError(
      db.query("select public.review_person($1, $2, 'approved')", [id, analyst]),
    );
    expect(error.code).toBe("42501");

    // Someone else may still clear it.
    await db.query("select public.review_person($1, $2, 'approved')", [id, reviewer]);
    expect((await personRow(id)).review_status).toBe("approved");

    await db.query("delete from public.platform_settings where key = 'review.require_two_person'");
  });
});

describe("a role must cite evidence a reader can follow", () => {
  it("rests on an approved document and the page it appears on", async () => {
    const id = await upsertRole({ sourcePage: 118 });
    expect((await roleRow(id)).source_page).toBe(118);
  });

  it("rests on a published announcement instead, which has no page", async () => {
    const id = await upsertRole({ announcementId: announcement });
    const row = await roleRow(id);
    expect(row.announcement_id).toBe(announcement);
    expect(row.source_page).toBeNull();
  });

  it("refuses two sources, which would support neither", async () => {
    const error = await expectSqlError(
      upsertRole({ documentId: document, sourcePage: 4, announcementId: announcement }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/exactly one/i);
  });

  it("refuses no source at all", async () => {
    const error = await expectSqlError(
      upsertRole({ documentId: null, sourcePage: null, announcementId: null }),
    );
    expect(error.code).toBe("23514");
  });

  it("refuses a document without the page", async () => {
    const error = await expectSqlError(upsertRole({ documentId: document, sourcePage: null }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/page/i);
  });

  it("refuses a page against an announcement", async () => {
    const error = await expectSqlError(
      upsertRole({ announcementId: announcement, documentId: null, sourcePage: 9 }),
    );
    expect(error.code).toBe("23514");
  });

  it("refuses a page that is not a page", async () => {
    for (const page of [0, -1]) {
      const error = await expectSqlError(upsertRole({ sourcePage: page }));
      expect(error.code, String(page)).toBe("23514");
    }
  });

  it("refuses a document nobody has approved", async () => {
    const pending = await makeDocument(company, { approve: false });
    const error = await expectSqlError(upsertRole({ documentId: pending, sourcePage: 3 }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/approved, citable document/i);
  });

  /**
   * The editorial desk's lesson: a document whose licence a reader cannot act on
   * is not evidence they can follow, so it is not citable even when approved.
   */
  it("refuses an approved document whose licence is unverified", async () => {
    const unverified = await makeDocument(company, { licence: "unverified" });
    const error = await expectSqlError(upsertRole({ documentId: unverified, sourcePage: 3 }));
    expect(error.code).toBe("23514");
  });

  it("refuses a document and an announcement that do not exist", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    // The source guard runs before the foreign key, so a citation naming
    // nothing is reported as what it is — not an approved, citable source —
    // rather than as a bare reference violation. The message is the one the
    // desk shows, so this is the better of the two codes to arrive here.
    const docError = await expectSqlError(upsertRole({ documentId: missing, sourcePage: 1 }));
    expect(docError.code).toBe("23514");
    expect(docError.message).toMatch(/approved, citable document/i);

    const annError = await expectSqlError(
      upsertRole({ announcementId: missing, documentId: null, sourcePage: null }),
    );
    expect(annError.code).toBe("23514");
    expect(annError.message).toMatch(/published announcement/i);
  });
});

describe("tenure dates record how precise the source was", () => {
  it("keeps a year-only appointment as a year", async () => {
    const id = await upsertRole({ validFrom: "2015-01-01", fromPrecision: "year" });
    const row = await roleRow(id);
    expect(row.valid_from_precision).toBe("year");
  });

  it("defaults to a full date when the filing gives one", async () => {
    const id = await upsertRole({ validFrom: "2019-07-01", fromPrecision: null });
    expect((await roleRow(id)).valid_from_precision).toBe("day");
  });

  it("refuses a precision that is not one of the three", async () => {
    for (const precision of ["decade", "DAY", "", "quarter"]) {
      const error = await expectSqlError(upsertRole({ fromPrecision: precision }));
      expect(error.code, JSON.stringify(precision)).toBe("23514");
    }
  });

  it("gives an end date its own precision, and clears it when there is no end", async () => {
    const ended = await upsertRole({ validTo: "2022-12-31" });
    expect((await roleRow(ended)).valid_to_precision).toBe("day");

    const current = await upsertRole({ validTo: null });
    expect((await roleRow(current)).valid_to_precision).toBeNull();
  });

  it("refuses a role that ends before it began", async () => {
    const error = await expectSqlError(
      upsertRole({ validFrom: "2020-01-01", validTo: "2019-01-01" }),
    );
    expect(error.code).toBe("23514");
  });

  it("accepts a role that has not started yet, which a notified appointment has not", async () => {
    const id = await upsertRole({ validFrom: "2099-01-01" });
    expect((await roleRow(id)).valid_from_precision).toBe("day");
  });

  it("needs a start date", async () => {
    const error = await expectSqlError(upsertRole({ validFrom: null as unknown as string }));
    expect(error.code).toBe("23514");
  });
});

describe("acting appointments", () => {
  it("are recorded as a different fact from a substantive one", async () => {
    const person = await upsertPerson({ name: "Acting Officer" });
    const id = await upsertRole({ personId: person, roleCode: "cfo", isActing: true });
    expect((await roleRow(id)).is_acting).toBe(true);
  });

  it("can sit beside a substantive holder of the same office during a handover", async () => {
    const outgoing = await upsertPerson({ name: "Outgoing Chief" });
    const acting = await upsertPerson({ name: "Interim Chief" });
    await upsertRole({
      personId: outgoing,
      companyId: otherCompany,
      roleCode: "ceo",
      validFrom: "2018-01-01",
    });
    const second = await upsertRole({
      personId: acting,
      companyId: otherCompany,
      roleCode: "ceo",
      validFrom: "2024-06-01",
      isActing: true,
    });
    // Both exist. A constraint refusing this would be refusing reality, and an
    // analyst would work around it by fudging a date.
    expect((await roleRow(second)).is_acting).toBe(true);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.company_roles where company_id = $1 and role_code = 'ceo' and valid_to is null",
      [otherCompany],
    );
    expect(rows[0].n).toBe(2);
  });
});

describe("one office, one start date, one row", () => {
  it("refuses the identical tenure twice", async () => {
    const person = await upsertPerson({ name: "Duplicate Tenure" });
    await upsertRole({ personId: person, roleCode: "cfo", validFrom: "2017-02-01" });
    const error = await expectSqlError(
      upsertRole({ personId: person, roleCode: "cfo", validFrom: "2017-02-01" }),
    );
    expect(error.code).toBe("23505");
  });

  it("allows a re-appointment as its own row", async () => {
    const person = await upsertPerson({ name: "Returning Director" });
    const first = await upsertRole({
      personId: person,
      roleCode: "non_executive_director",
      validFrom: "2010-01-01",
      validTo: "2014-01-01",
    });
    const second = await upsertRole({
      personId: person,
      roleCode: "non_executive_director",
      validFrom: "2019-01-01",
    });
    expect(first).not.toBe(second);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.company_roles where person_id = $1",
      [person],
    );
    expect(rows[0].n).toBe(2);
  });

  it("lets one person hold offices at several companies", async () => {
    const person = await upsertPerson({ name: "Multiple Boards" });
    await upsertRole({ personId: person, companyId: company, roleCode: "chair" });
    await upsertRole({ personId: person, companyId: otherCompany, roleCode: "non_executive_director" });

    const { rows } = await db.query<{ company_id: string }>(
      "select company_id from public.company_roles where person_id = $1",
      [person],
    );
    expect(new Set(rows.map((r) => r.company_id))).toEqual(new Set([company, otherCompany]));
  });

  it("refuses an office, a person or a company that does not exist", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect((await expectSqlError(upsertRole({ roleCode: "supreme_leader" }))).code).toBe("23503");
    expect((await expectSqlError(upsertRole({ personId: missing }))).code).toBe("23503");
    expect((await expectSqlError(upsertRole({ companyId: missing }))).code).toBe("23503");
  });

  it("keeps the title exactly as the filing gives it, beside the canonical code", async () => {
    const id = await upsertRole({ roleCode: "gmd_ceo", roleTitle: "Group Managing Director/CEO" });
    const row = await roleRow(id);
    expect(row.role_code).toBe("gmd_ceo");
    expect(row.role_title).toBe("Group Managing Director/CEO");
  });

  it("refuses a title carrying a line break", async () => {
    const error = await expectSqlError(upsertRole({ roleTitle: "Chief\nOfficer" }));
    expect(error.code).toBe("23514");
  });
});

describe("last confirmed", () => {
  it("records the date and what confirmed it", async () => {
    const id = await upsertRole({
      validFrom: "2015-01-01",
      confirmedOn: "2026-06-30",
      confirmDocumentId: document,
      confirmPage: 7,
    });
    const row = await roleRow(id);
    expect(row.last_confirmed_on?.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(row.last_confirmed_source_page).toBe(7);
  });

  it("accepts an announcement as the confirming source", async () => {
    const id = await upsertRole({
      confirmedOn: "2026-05-01",
      confirmAnnouncementId: announcement,
    });
    expect((await roleRow(id)).last_confirmed_on).not.toBeNull();
  });

  it("refuses a confirming source with no date, which confirms nothing", async () => {
    const error = await expectSqlError(
      upsertRole({ confirmDocumentId: document, confirmPage: 2 }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/needs the date/i);
  });

  it("refuses a date with no source, which says somebody checked but not what", async () => {
    const error = await expectSqlError(upsertRole({ confirmedOn: "2026-05-01" }));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/exactly one/i);
  });

  it("refuses two confirming sources", async () => {
    const error = await expectSqlError(
      upsertRole({
        confirmedOn: "2026-05-01",
        confirmDocumentId: document,
        confirmPage: 2,
        confirmAnnouncementId: announcement,
      }),
    );
    expect(error.code).toBe("23514");
  });

  it("refuses a confirming document without its page", async () => {
    const error = await expectSqlError(
      upsertRole({ confirmedOn: "2026-05-01", confirmDocumentId: document }),
    );
    expect(error.code).toBe("23514");
  });

  it("refuses a confirmation dated in the future", async () => {
    const error = await expectSqlError(
      upsertRole({ confirmedOn: "2099-01-01", confirmDocumentId: document, confirmPage: 1 }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/future/i);
  });

  it("refuses a confirmation dated before the role began", async () => {
    const error = await expectSqlError(
      upsertRole({
        validFrom: "2020-01-01",
        confirmedOn: "2019-01-01",
        confirmDocumentId: document,
        confirmPage: 1,
      }),
    );
    expect(error.code).toBe("23514");
  });

  it("refuses a confirming document nobody has approved", async () => {
    const pending = await makeDocument(company, { approve: false });
    const error = await expectSqlError(
      upsertRole({ confirmedOn: "2026-01-01", confirmDocumentId: pending, confirmPage: 1 }),
    );
    expect(error.code).toBe("23514");
  });

  /**
   * The desk's staleness queue. A current role nobody has confirmed within a year
   * is the thing that quietly rots: the register still asserts someone holds an
   * office, on the strength of a filing from two years ago.
   */
  it("separates roles that have gone stale from those recently checked", async () => {
    const staleCompany = await makeCompany("Stale Register Plc", "stale-register", "STALE");
    const stalePerson = await upsertPerson({ name: "Long Unchecked" });
    const freshPerson = await upsertPerson({ name: "Recently Checked" });
    const neverPerson = await upsertPerson({ name: "Never Checked" });

    const stale = await upsertRole({
      personId: stalePerson,
      companyId: staleCompany,
      roleCode: "ceo",
      validFrom: "2015-01-01",
      confirmedOn: "2024-01-15",
      confirmDocumentId: document,
      confirmPage: 3,
    });
    const fresh = await upsertRole({
      personId: freshPerson,
      companyId: staleCompany,
      roleCode: "cfo",
      validFrom: "2015-01-01",
      confirmedOn: new Date().toISOString().slice(0, 10),
      confirmDocumentId: document,
      confirmPage: 4,
    });
    const never = await upsertRole({
      personId: neverPerson,
      companyId: staleCompany,
      roleCode: "chair",
      validFrom: "2015-01-01",
    });
    // A role that has ended is not stale; nobody needs to confirm a former
    // officer still holds an office they left.
    const ended = await upsertRole({
      personId: stalePerson,
      companyId: staleCompany,
      roleCode: "coo",
      validFrom: "2010-01-01",
      validTo: "2012-01-01",
    });

    const { rows } = await db.query<{ id: string }>(
      `select id from public.company_roles
        where company_id = $1
          and valid_to is null
          and withdrawn_at is null
          and (last_confirmed_on is null or last_confirmed_on < current_date - interval '12 months')`,
      [staleCompany],
    );
    const flagged = new Set(rows.map((r) => r.id));
    expect(flagged.has(stale)).toBe(true);
    expect(flagged.has(never)).toBe(true);
    expect(flagged.has(fresh)).toBe(false);
    expect(flagged.has(ended)).toBe(false);
  });
});

describe("editing a role", () => {
  it("requires a reason and keeps both versions", async () => {
    const id = await upsertRole({ validFrom: "2016-01-01" });
    const bare = await expectSqlError(
      upsertRole({ roleId: id, validFrom: "2016-01-01", validTo: "2023-05-31" }),
    );
    expect(bare.code).toBe("23514");
    expect(bare.message).toMatch(/why/i);

    const row = await roleRow(id);
    await upsertRole({
      roleId: id,
      personId: (
        await db.query<{ person_id: string }>(
          "select person_id from public.company_roles where id = $1",
          [id],
        )
      ).rows[0].person_id,
      roleCode: row.role_code,
      validFrom: "2016-01-01",
      validTo: "2023-05-31",
      reason: "Retired at the 2023 AGM, per the annual report",
    });

    const versions = await roleVersions(id);
    expect(versions).toHaveLength(2);
    expect(versions[1].valid_to).not.toBeNull();
    expect(versions[1].change_reason).toMatch(/Retired/);
  });

  it("refuses a save that changes nothing", async () => {
    const id = await upsertRole({ validFrom: "2016-02-01" });
    const { rows } = await db.query<{ person_id: string }>(
      "select person_id from public.company_roles where id = $1",
      [id],
    );
    const error = await expectSqlError(
      upsertRole({
        roleId: id,
        personId: rows[0].person_id,
        validFrom: "2016-02-01",
        reason: "No change",
      }),
    );
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/Nothing changed/i);
  });

  it("cannot be written or reviewed by a role that does not keep the register", async () => {
    const id = await upsertRole();
    for (const actor of [editor, reader]) {
      expect((await expectSqlError(upsertRole({ actor }))).code).toBe("42501");
      expect(
        (
          await expectSqlError(
            db.query("select public.review_company_role($1, $2, 'approved')", [id, actor]),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await expectSqlError(
            db.query("select public.withdraw_company_role($1, $2, 'because')", [id, actor]),
          )
        ).code,
      ).toBe("42501");
    }
  });
});

describe("reviewing a role", () => {
  it("approves and flags self-approval exactly as the company desk does", async () => {
    const own = await upsertRole();
    await db.query("select public.review_company_role($1, $2, 'approved')", [own, analyst]);
    expect(await roleRow(own)).toMatchObject({
      review_status: "approved",
      review_self_approved: true,
      reviewed_version: 1,
    });

    const other = await upsertRole();
    await db.query("select public.review_company_role($1, $2, 'approved')", [other, reviewer]);
    expect((await roleRow(other)).review_self_approved).toBe(false);
  });

  it("treats unknown authorship as self-reviewed", async () => {
    const leaver = await createUser(db, { staff: ["analyst"] });
    const id = await upsertRole({ actor: leaver });
    await db.query("delete from auth.users where id = $1", [leaver]);
    expect((await roleVersions(id))[0].changed_by).toBeNull();

    await db.query("select public.review_company_role($1, $2, 'approved')", [id, reviewer]);
    expect((await roleRow(id)).review_self_approved).toBe(true);
  });

  it("requires a reason to reject", async () => {
    const id = await upsertRole();
    const error = await expectSqlError(
      db.query("select public.review_company_role($1, $2, 'rejected')", [id, reviewer]),
    );
    expect(error.code).toBe("23514");
  });
});

describe("withdrawing a role that turned out to be wrong", () => {
  it("leaves the published record, keeps the history, and names a reason", async () => {
    const person = await upsertPerson({ name: "Wrongly Listed" });
    await db.query("select public.review_person($1, $2, 'approved')", [person, reviewer]);
    const id = await upsertRole({ personId: person, roleCode: "cfo" });
    await db.query("select public.review_company_role($1, $2, 'approved')", [id, reviewer]);

    const visibleBefore = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.company_roles where id = $1",
        [id],
      );
      return rows[0].n;
    });
    expect(visibleBefore).toBe(1);

    await db.query(
      "select public.withdraw_company_role($1, $2, 'Never held this office; confused with a namesake')",
      [id, reviewer],
    );

    const row = await roleRow(id);
    expect(row.withdrawn_at).not.toBeNull();
    expect(row.withdrawal_reason).toMatch(/namesake/);

    // The reader stops seeing a claim we no longer stand behind. This is the
    // opposite of a withdrawn announcement, which stays visible and labelled —
    // deliberately, because for personal data the display is the harm.
    const visibleAfter = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.company_roles where id = $1",
        [id],
      );
      return rows[0].n;
    });
    expect(visibleAfter).toBe(0);

    // Nothing is destroyed: the row and its history remain for the desk.
    expect(await roleVersions(id)).not.toHaveLength(0);
    const { rows: audit } = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_logs where action = 'company_role.withdrawn' and details->>'role_id' = $1",
      [id],
    );
    expect(audit[0].n).toBe(1);
  });

  it("needs a reason", async () => {
    const id = await upsertRole();
    for (const reason of [null, "", "   "]) {
      const error = await expectSqlError(
        db.query("select public.withdraw_company_role($1, $2, $3)", [id, reviewer, reason]),
      );
      expect(error.code).toBe("23514");
    }
  });

  it("cannot be withdrawn twice, edited, or reviewed afterwards", async () => {
    const id = await upsertRole();
    await db.query("select public.withdraw_company_role($1, $2, 'Wrong person')", [id, reviewer]);

    expect(
      (
        await expectSqlError(
          db.query("select public.withdraw_company_role($1, $2, 'Again')", [id, reviewer]),
        )
      ).code,
    ).toBe("23514");

    expect(
      (
        await expectSqlError(
          db.query("select public.review_company_role($1, $2, 'approved')", [id, reviewer]),
        )
      ).code,
    ).toBe("42501");

    const { rows } = await db.query<{ person_id: string }>(
      "select person_id from public.company_roles where id = $1",
      [id],
    );
    const error = await expectSqlError(
      upsertRole({ roleId: id, personId: rows[0].person_id, validTo: "2024-01-01", reason: "Revive" }),
    );
    expect(error.code).toBe("42501");
    expect(error.message).toMatch(/withdrawn/i);
  });
});

describe("nothing is edited or deleted in place", () => {
  it("refuses to delete a person or a role", async () => {
    const person = await upsertPerson({ name: "Permanent Record" });
    const role = await upsertRole({ personId: person });

    expect((await expectSqlError(db.query("delete from public.people where id = $1", [person]))).code)
      .toBe("42501");
    expect(
      (await expectSqlError(db.query("delete from public.company_roles where id = $1", [role]))).code,
    ).toBe("42501");
  });

  it("refuses a direct update that would bypass the history", async () => {
    const person = await upsertPerson({ name: "No Side Door" });
    const role = await upsertRole({ personId: person });

    expect(
      (
        await expectSqlError(
          db.query("update public.people set full_name = 'Renamed Quietly' where id = $1", [person]),
        )
      ).code,
    ).toBe("42501");

    expect(
      (
        await expectSqlError(
          db.query("update public.company_roles set role_code = 'chair' where id = $1", [role]),
        )
      ).code,
    ).toBe("42501");

    // And the values are untouched.
    expect((await personRow(person)).full_name).toBe("No Side Door");
    expect((await roleRow(role)).role_code).toBe("ceo");
  });

  it("keeps both version tables append-only", async () => {
    const person = await upsertPerson({ name: "Append Only" });
    const role = await upsertRole({ personId: person });

    for (const [table, column, id] of [
      ["person_versions", "person_id", person],
      ["company_role_versions", "role_id", role],
    ] as const) {
      expect(
        (
          await expectSqlError(
            db.query(`delete from public.${table} where ${column} = $1`, [id]),
          )
        ).code,
      ).toBe("42501");
      expect(
        (
          await expectSqlError(
            db.query(`update public.${table} set change_reason = 'rewritten' where ${column} = $1`, [id]),
          )
        ).code,
      ).toBe("42501");
    }
  });

  it("lets a departed actor be anonymised, so offboarding still works", async () => {
    const leaver = await createUser(db, { staff: ["analyst"] });
    const person = await upsertPerson({ actor: leaver, name: "Entered By Leaver" });
    const role = await upsertRole({ actor: leaver, personId: person });
    await db.query("select public.review_person($1, $2, 'approved')", [person, leaver]);
    await db.query("select public.review_company_role($1, $2, 'approved')", [role, leaver]);

    await db.query("delete from auth.users where id = $1", [leaver]);

    expect((await personVersions(person))[0].changed_by).toBeNull();
    expect((await roleVersions(role))[0].changed_by).toBeNull();
    expect((await personRow(person)).reviewed_by).toBeNull();
  });
});

describe("what a reader may see", () => {
  async function visibleAs(userId: string, roleId: string): Promise<boolean> {
    return asUser(db, userId, async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.company_roles where id = $1",
        [roleId],
      );
      return rows[0].n === 1;
    });
  }

  it("shows a role only once the role, the person and the company are all approved", async () => {
    const person = await upsertPerson({ name: "Fully Approved" });
    const role = await upsertRole({ personId: person });

    // Nothing approved yet.
    expect(await visibleAs(reader, role)).toBe(false);

    await db.query("select public.review_person($1, $2, 'approved')", [person, reviewer]);
    expect(await visibleAs(reader, role)).toBe(false);

    await db.query("select public.review_company_role($1, $2, 'approved')", [role, reviewer]);
    expect(await visibleAs(reader, role)).toBe(true);
  });

  /**
   * The leak this policy exists to prevent: a company nobody has reviewed is not
   * public, and neither are its officers. Stage 3a's equivalent gap left the
   * analyst desk empty; this one would have gone the other way.
   */
  it("hides the officers of a company nobody has approved", async () => {
    const person = await upsertPerson({ name: "Officer Of Pending" });
    await db.query("select public.review_person($1, $2, 'approved')", [person, reviewer]);
    const role = await upsertRole({ personId: person, companyId: pendingCompany });
    await db.query("select public.review_company_role($1, $2, 'approved')", [role, reviewer]);

    expect(await visibleAs(reader, role)).toBe(false);
    // The analyst who has to work the queue still sees it.
    expect(await visibleAs(analyst, role)).toBe(true);
  });

  it("hides a role whose person is not approved, even on an approved company", async () => {
    const person = await upsertPerson({ name: "Unapproved Individual" });
    const role = await upsertRole({ personId: person });
    await db.query("select public.review_company_role($1, $2, 'approved')", [role, reviewer]);
    expect(await visibleAs(reader, role)).toBe(false);
  });

  it("hides a rejected person from readers and shows them to the desk", async () => {
    const person = await upsertPerson({ name: "Rejected Record" });
    await db.query("select public.review_person($1, $2, 'rejected', 'Not verifiable')", [
      person,
      reviewer,
    ]);

    const asReader = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.people where id = $1",
        [person],
      );
      return rows[0].n;
    });
    expect(asReader).toBe(0);

    const asDesk = await asUser(db, analyst, async () => {
      const { rows } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.people where id = $1",
        [person],
      );
      return rows[0].n;
    });
    expect(asDesk).toBe(1);
  });

  it("keeps both histories closed to readers and open to the desk", async () => {
    const person = await upsertPerson({ name: "History Closed" });
    const role = await upsertRole({ personId: person });

    for (const [table, column, id] of [
      ["person_versions", "person_id", person],
      ["company_role_versions", "role_id", role],
    ] as const) {
      const seenByReader = await asUser(db, reader, async () => {
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from public.${table} where ${column} = $1`,
          [id],
        );
        return rows[0].n;
      });
      expect(seenByReader, table).toBe(0);

      const seenByDesk = await asUser(db, analyst, async () => {
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from public.${table} where ${column} = $1`,
          [id],
        );
        return rows[0].n;
      });
      expect(seenByDesk, table).toBeGreaterThan(0);
    }
  });

  /**
   * What the company page asks for: the offices held at one company, as a
   * signed-in reader. The page relies on row-level security for the filtering
   * rather than restating it in the query, so this exercises the read the way
   * the page makes it — scoped by company and nothing else.
   */
  it("gives a reader a company's board, split and ordered by the catalogue", async () => {
    const boardCompany = await makeCompany("Board Order Plc", "board-order", "BOARD");

    async function approvedRole(name: string, roleCode: string, validTo: string | null = null) {
      const subject = await upsertPerson({ name });
      await db.query("select public.review_person($1, $2, 'approved')", [subject, reviewer]);
      const id = await upsertRole({
        personId: subject,
        companyId: boardCompany,
        roleCode,
        validTo,
      });
      await db.query("select public.review_company_role($1, $2, 'approved')", [id, reviewer]);
      return id;
    }

    await approvedRole("Chair Person", "chair");
    await approvedRole("Chief Exec", "ceo");
    await approvedRole("Finance Chief", "cfo");
    await approvedRole("Independent Director", "independent_non_executive_director");
    const departed = await approvedRole("Departed Officer", "coo", "2022-12-31");

    const hidden = await upsertPerson({ name: "Unapproved Officer" });
    const hiddenRole = await upsertRole({ personId: hidden, companyId: boardCompany, roleCode: "md" });

    const rows = await asUser(db, reader, async () => {
      const { rows: found } = await db.query<{
        id: string;
        full_name: string;
        name: string;
        is_executive: boolean;
        is_board: boolean;
        sort_order: number;
        valid_to: Date | null;
      }>(
        `select r.id, p.full_name, cat.name, cat.is_executive, cat.is_board, cat.sort_order, r.valid_to
           from public.company_roles r
           join public.people p on p.id = r.person_id
           join public.person_role_catalogue cat on cat.id = r.role_code
          where r.company_id = $1
          order by cat.sort_order`,
        [boardCompany],
      );
      return found;
    });

    // The unapproved person's office is absent, and the departed officer is
    // present with an end date for the "formerly" group.
    expect(rows.map((r) => r.full_name)).not.toContain("Unapproved Officer");
    expect(rows.map((r) => r.id)).not.toContain(hiddenRole);
    expect(rows.map((r) => r.id)).toContain(departed);

    // Ordered as a filing lists a board: the chairman first.
    expect(rows[0].full_name).toBe("Chair Person");

    // The split the panel draws comes from the catalogue, not from a list in
    // TypeScript, so a new office added as a row lands in the right group.
    const byName = new Map(rows.map((r) => [r.full_name, r]));
    expect(byName.get("Chair Person")).toMatchObject({ is_board: true, is_executive: false });
    expect(byName.get("Chief Exec")).toMatchObject({ is_board: false, is_executive: true });
    expect(byName.get("Independent Director")).toMatchObject({ is_board: true, is_executive: false });
    expect(byName.get("Departed Officer")?.valid_to).not.toBeNull();
  });

  it("gives a reader nothing for a company whose leadership nobody has recorded", async () => {
    const quiet = await makeCompany("No Board Yet Plc", "no-board-yet", "QUIET");
    const rows = await asUser(db, reader, async () => {
      const { rows: found } = await db.query<{ n: number }>(
        "select count(*)::int as n from public.company_roles where company_id = $1",
        [quiet],
      );
      return found[0].n;
    });
    // Which the page reports as "No data yet", not as a company with no board.
    expect(rows).toBe(0);
  });

  it("shows the desk its own pending queue, which is the point of the desk", async () => {
    const person = await upsertPerson({ name: "Queued For Review" });
    const role = await upsertRole({ personId: person });

    const queue = await asUser(db, analyst, async () => {
      const { rows } = await db.query<{ people: number; roles: number }>(
        `select (select count(*)::int from public.people where review_status = 'pending') as people,
                (select count(*)::int from public.company_roles where review_status = 'pending') as roles`,
      );
      return rows[0];
    });
    expect(queue.people).toBeGreaterThan(0);
    expect(queue.roles).toBeGreaterThan(0);
    expect(person).toBeTruthy();
    expect(role).toBeTruthy();
  });
});
