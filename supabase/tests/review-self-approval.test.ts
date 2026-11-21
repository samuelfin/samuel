import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * Self-approval is permitted while the desk has one reviewer, but it is never
 * silent: it is marked on the review event and in the audit log, so work nobody
 * else checked can be found. Turning on review.require_two_person refuses it.
 */

let db: PGlite;
let analyst: string;
let other: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  other = await createUser(db, { staff: ["analyst"] });
}, 180_000);

let counter = 0;

async function upload(actor: string): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 2048, 'issuer_document'
     ) as id`,
    [actor, `Self-approval case ${counter}`, `aa/self-${counter}.pdf`, sha256(`self-${counter}`)],
  );
  return rows[0].id;
}

async function eventFor(documentId: string) {
  const { rows } = await db.query<{ to_status: string; self_approved: boolean; actor_user_id: string }>(
    "select to_status, self_approved, actor_user_id from public.document_review_events where document_id = $1 order by created_at desc limit 1",
    [documentId],
  );
  return rows[0];
}

async function setTwoPerson(value: boolean) {
  await db.query("update public.platform_settings set value = $1::jsonb where key = 'review.require_two_person'", [
    JSON.stringify(value),
  ]);
}

describe("while two-person review is off", () => {
  it("lets the uploader approve, and marks the event self-approved", async () => {
    const doc = await upload(analyst);
    await db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]);

    const event = await eventFor(doc);
    expect(event.to_status).toBe("approved");
    expect(event.self_approved).toBe(true);
  });

  it("does not mark an approval by someone else", async () => {
    const doc = await upload(analyst);
    await db.query("select public.review_document($1, $2, 'approved')", [doc, other]);

    const event = await eventFor(doc);
    expect(event.self_approved).toBe(false);
  });

  it("carries the fact into the audit log", async () => {
    const doc = await upload(analyst);
    await db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]);

    const { rows } = await db.query<{ details: { self_approved: boolean } }>(
      "select details from public.audit_logs where action = 'document.review.approved' and details ->> 'document_id' = $1",
      [doc],
    );
    expect(rows[0].details.self_approved).toBe(true);
  });

  it("does not treat rejecting your own upload as self-approval", async () => {
    const doc = await upload(analyst);
    await db.query("select public.review_document($1, $2, 'rejected', 'Withdrawn')", [doc, analyst]);

    const event = await eventFor(doc);
    expect(event.to_status).toBe("rejected");
    expect(event.self_approved).toBe(false);
  });
});

describe("once two-person review is required", () => {
  it("refuses the uploader and admits a second reviewer", async () => {
    await setTwoPerson(true);
    try {
      const doc = await upload(analyst);

      const refused = await expectSqlError(
        db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]),
      );
      expect(refused.code).toBe("42501");

      // Still pending, and someone else can clear it.
      await db.query("select public.review_document($1, $2, 'approved')", [doc, other]);
      const event = await eventFor(doc);
      expect(event.self_approved).toBe(false);
    } finally {
      await setTwoPerson(false);
    }
  });

  it("still lets the uploader reject their own upload", async () => {
    await setTwoPerson(true);
    try {
      const doc = await upload(analyst);
      await db.query("select public.review_document($1, $2, 'rejected', 'Wrong file')", [doc, analyst]);
      expect((await eventFor(doc)).to_status).toBe("rejected");
    } finally {
      await setTwoPerson(false);
    }
  });
});

describe("the setting itself", () => {
  it("defaults to permitting self-approval", async () => {
    const { rows } = await db.query<{ v: boolean }>(
      "select public.setting_bool('review.require_two_person', true) as v",
    );
    expect(rows[0].v).toBe(false);
  });

  it("falls back when the key is unknown", async () => {
    const { rows } = await db.query<{ a: boolean; b: boolean }>(
      "select public.setting_bool('no.such.key', true) as a, public.setting_bool('no.such.key', false) as b",
    );
    expect(rows[0].a).toBe(true);
    expect(rows[0].b).toBe(false);
  });

  it("changes only through the trusted function, by an administrator", async () => {
    const admin = await createUser(db, { admin: true });

    const direct = await asUser(db, analyst, () =>
      expectSqlError(
        db.query("update public.platform_settings set value = 'true'::jsonb where key = 'review.require_two_person'"),
      ),
    );
    expect(direct.code).toBe("42501");

    const notAdmin = await expectSqlError(
      db.query("select public.set_platform_setting('review.require_two_person', 'true'::jsonb, $1)", [analyst]),
    );
    expect(notAdmin.code).toBe("42501");

    await db.query("select public.set_platform_setting('review.require_two_person', 'true'::jsonb, $1)", [admin]);
    const { rows } = await db.query<{ v: boolean }>(
      "select public.setting_bool('review.require_two_person', false) as v",
    );
    expect(rows[0].v).toBe(true);
    await setTwoPerson(false);
  });

  it("rejects an unknown key and records a change in the audit log", async () => {
    const admin = await createUser(db, { admin: true });

    const unknown = await expectSqlError(
      db.query("select public.set_platform_setting('made.up.key', 'true'::jsonb, $1)", [admin]),
    );
    expect(unknown.code).toBe("22023");

    await db.query("select public.set_platform_setting('review.require_two_person', 'true'::jsonb, $1)", [admin]);
    const { rows } = await db.query<{ action: string }>(
      "select action from public.audit_logs where actor_user_id = $1 order by created_at desc limit 1",
      [admin],
    );
    expect(rows[0].action).toBe("platform.setting.changed");
    await setTwoPerson(false);
  });

  it("is readable by staff but not by an ordinary user", async () => {
    const reader = await createUser(db);

    const staffSees = await asUser(db, analyst, async () => {
      const { rows } = await db.query("select key from public.platform_settings");
      return rows.length;
    });
    const readerSees = await asUser(db, reader, async () => {
      const { rows } = await db.query("select key from public.platform_settings");
      return rows.length;
    });

    expect(staffSees).toBeGreaterThan(0);
    expect(readerSees).toBe(0);
  });
});
