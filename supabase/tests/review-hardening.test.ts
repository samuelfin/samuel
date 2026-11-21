import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * Regressions found reviewing stage 2a. Each of these was a real defect:
 * offboarding was impossible, settings could be read past their policy, and a
 * malformed setting could stop every review.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
}, 180_000);

let counter = 0;

async function uploadAndApprove(actor: string): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 2048, 'issuer_document'
     ) as id`,
    [actor, `Hardening case ${counter}`, `aa/harden-${counter}.pdf`, sha256(`harden-${counter}`)],
  );
  const id = rows[0].id;
  await db.query("select public.review_document($1, $2, 'approved')", [id, actor]);
  return id;
}

describe("a reviewer's account can be deleted", () => {
  it("anonymises their review events instead of refusing the delete", async () => {
    const analyst = await createUser(db, { staff: ["analyst"] });
    const documentId = await uploadAndApprove(analyst);

    // The foreign key is declared `on delete set null`; the append-only trigger
    // used to block that, which made offboarding impossible.
    await db.query("delete from auth.users where id = $1", [analyst]);

    const { rows } = await db.query<{ actor_user_id: string | null; to_status: string; self_approved: boolean }>(
      "select actor_user_id, to_status, self_approved from public.document_review_events where document_id = $1",
      [documentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBeNull();
    // The decision itself survives the person.
    expect(rows[0].to_status).toBe("approved");
    expect(rows[0].self_approved).toBe(true);
  });

  it("still refuses every other change to a review event", async () => {
    const analyst = await createUser(db, { staff: ["analyst"] });
    const documentId = await uploadAndApprove(analyst);

    for (const statement of [
      "update public.document_review_events set to_status = 'rejected' where document_id = $1",
      "update public.document_review_events set reason = 'rewritten' where document_id = $1",
      "update public.document_review_events set self_approved = false where document_id = $1",
      "update public.document_review_events set created_at = now() where document_id = $1",
    ]) {
      const error = await expectSqlError(db.query(statement, [documentId]));
      expect(error.code).toBe("42501");
    }
  });

  it("refuses to reassign an event to a different actor", async () => {
    const analyst = await createUser(db, { staff: ["analyst"] });
    const other = await createUser(db, { staff: ["analyst"] });
    const documentId = await uploadAndApprove(analyst);

    const error = await expectSqlError(
      db.query("update public.document_review_events set actor_user_id = $1 where document_id = $2", [
        other,
        documentId,
      ]),
    );
    expect(error.code).toBe("42501");
  });
});

describe("settings cannot break the review path", () => {
  it("falls back when the stored value is not a boolean", async () => {
    await db.query("update public.platform_settings set value = '{}'::jsonb where key = 'review.require_two_person'");
    try {
      // Previously this raised 22P02 and took every approval down with it.
      const { rows } = await db.query<{ a: boolean; b: boolean }>(
        "select public.setting_bool('review.require_two_person', false) as a, public.setting_bool('review.require_two_person', true) as b",
      );
      expect(rows[0].a).toBe(false);
      expect(rows[0].b).toBe(true);

      // And review still works.
      const analyst = await createUser(db, { staff: ["analyst"] });
      await expect(uploadAndApprove(analyst)).resolves.toBeTruthy();
    } finally {
      await db.query(
        "update public.platform_settings set value = 'false'::jsonb where key = 'review.require_two_person'",
      );
    }
  });

  it("refuses a value of the wrong type on the way in", async () => {
    const admin = await createUser(db, { admin: true });
    for (const value of ["'{}'::jsonb", `'"yes"'::jsonb`, "'7'::jsonb"]) {
      const error = await expectSqlError(
        db.query(`select public.set_platform_setting('review.require_two_person', ${value}, $1)`, [admin]),
      );
      expect(error.code).toBe("22023");
    }

    // A boolean is still accepted.
    await db.query("select public.set_platform_setting('review.require_two_person', 'true'::jsonb, $1)", [admin]);
    await db.query("select public.set_platform_setting('review.require_two_person', 'false'::jsonb, $1)", [admin]);
  });

  it("does not let a signed-in user read settings through the function", async () => {
    const { rows } = await db.query<{ has: boolean }>(
      `select has_function_privilege('authenticated', 'public.setting_bool(text, boolean)', 'execute') as has`,
    );
    // The staff-only policy on platform_settings is the only way in; a definer
    // function granted to authenticated would have read straight past it.
    expect(rows[0].has).toBe(false);
  });
});
