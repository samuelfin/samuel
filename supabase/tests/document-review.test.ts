import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * A document is evidence: its bytes never change, it is never deleted, and every
 * decision about it names a person and a reason. A correction supersedes the old
 * document rather than overwriting it.
 */

let db: PGlite;
let analyst: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
}, 180_000);

let counter = 0;

/** Insert a pending document the way an upload would, and return its id. */
async function createDocument(opts: { stored?: boolean } = {}): Promise<string> {
  counter += 1;
  const stored = opts.stored ?? true;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.documents
       (provider_id, kind, title, source_uri, storage_path, sha256, mime_type, size_bytes, licence_class)
     values ('issuer_ir', 'annual_report', $1, 'https://example.test/report.pdf', $2, $3, 'application/pdf', 1024, 'issuer_document')
     returning id`,
    [
      `Test report ${counter}`,
      stored ? `source-documents/test-${counter}.pdf` : null,
      sha256(`document-${counter}`),
    ],
  );
  return rows[0].id;
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await db.query<{ review_status: string }>(
    "select review_status from public.documents where id = $1",
    [id],
  );
  return rows[0].review_status;
}

describe("stored documents are immutable", () => {
  it("refuses to change the checksum or the stored path", async () => {
    const doc = await createDocument();

    const checksum = await expectSqlError(
      db.query("update public.documents set sha256 = $1 where id = $2", [sha256("tampered"), doc]),
    );
    expect(checksum.code).toBe("23514");

    const path = await expectSqlError(
      db.query("update public.documents set storage_path = 'source-documents/elsewhere.pdf' where id = $1", [doc]),
    );
    expect(path.code).toBe("23514");
  });

  it("refuses to delete a document, even for service_role", async () => {
    const doc = await createDocument();
    const error = await expectSqlError(db.query("delete from public.documents where id = $1", [doc]));
    expect(error.code).toBe("42501");
  });

  it("still allows cataloguing fields to be corrected", async () => {
    const doc = await createDocument();
    await db.query("update public.documents set title = 'Corrected title' where id = $1", [doc]);
    const { rows } = await db.query<{ title: string }>("select title from public.documents where id = $1", [doc]);
    expect(rows[0].title).toBe("Corrected title");
  });
});

describe("review status moves only through review_document", () => {
  it("refuses a direct status update", async () => {
    const doc = await createDocument();
    const error = await expectSqlError(
      db.query("update public.documents set review_status = 'approved' where id = $1", [doc]),
    );
    expect(error.code).toBe("42501");
  });

  it("approves a pending document and records the event", async () => {
    const doc = await createDocument();
    await db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]);

    expect(await statusOf(doc)).toBe("approved");

    const { rows } = await db.query<{ from_status: string; to_status: string; actor_user_id: string }>(
      "select from_status, to_status, actor_user_id from public.document_review_events where document_id = $1",
      [doc],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_status: "pending", to_status: "approved", actor_user_id: analyst });
  });

  it("requires a reason to reject", async () => {
    const doc = await createDocument();

    const blank = await expectSqlError(db.query("select public.review_document($1, $2, 'rejected')", [doc, analyst]));
    expect(blank.code).toBe("23514");

    const whitespace = await expectSqlError(
      db.query("select public.review_document($1, $2, 'rejected', '   ')", [doc, analyst]),
    );
    expect(whitespace.code).toBe("23514");

    await db.query("select public.review_document($1, $2, 'rejected', 'Wrong issuer')", [doc, analyst]);
    const { rows } = await db.query<{ reason: string }>(
      "select reason from public.document_review_events where document_id = $1",
      [doc],
    );
    expect(rows[0].reason).toBe("Wrong issuer");
  });

  it("will not approve a document whose file was never stored", async () => {
    const doc = await createDocument({ stored: false });
    const error = await expectSqlError(db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]));
    expect(error.code).toBe("23514");
  });

  it("treats rejection as terminal", async () => {
    const doc = await createDocument();
    await db.query("select public.review_document($1, $2, 'rejected', 'Duplicate')", [doc, analyst]);

    const error = await expectSqlError(db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]));
    expect(error.code).toBe("23514");
    expect(await statusOf(doc)).toBe("rejected");
  });

  it("refuses to repeat a decision already made", async () => {
    const doc = await createDocument();
    await db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]);
    const error = await expectSqlError(db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]));
    expect(error.code).toBe("23514");
  });
});

describe("only authorised people review", () => {
  it("refuses an ordinary signed-in user", async () => {
    const doc = await createDocument();
    const outsider = await createUser(db);
    const error = await expectSqlError(
      db.query("select public.review_document($1, $2, 'approved')", [doc, outsider]),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses a staff member without a reviewing role", async () => {
    const doc = await createDocument();
    const publisher = await createUser(db, { staff: ["publisher"] });
    const error = await expectSqlError(
      db.query("select public.review_document($1, $2, 'approved')", [doc, publisher]),
    );
    expect(error.code).toBe("42501");
  });

  it("allows a platform administrator", async () => {
    const doc = await createDocument();
    const admin = await createUser(db, { admin: true });
    await db.query("select public.review_document($1, $2, 'approved')", [doc, admin]);
    expect(await statusOf(doc)).toBe("approved");
  });
});

describe("corrections supersede rather than overwrite", () => {
  it("refuses to supersede a document with nothing to replace it", async () => {
    const original = await createDocument();
    await db.query("select public.review_document($1, $2, 'approved')", [original, analyst]);

    const error = await expectSqlError(
      db.query("select public.review_document($1, $2, 'superseded')", [original, analyst]),
    );
    expect(error.code).toBe("23514");
  });

  it("supersedes once an approved replacement exists, keeping both rows", async () => {
    const original = await createDocument();
    await db.query("select public.review_document($1, $2, 'approved')", [original, analyst]);

    const replacement = await createDocument();
    await db.query("update public.documents set supersedes_id = $1 where id = $2", [original, replacement]);
    await db.query("select public.review_document($1, $2, 'approved')", [replacement, analyst]);

    await db.query("select public.review_document($1, $2, 'superseded', 'Restated figures')", [original, analyst]);

    expect(await statusOf(original)).toBe("superseded");
    expect(await statusOf(replacement)).toBe("approved");
  });

  it("refuses a document that supersedes itself", async () => {
    const doc = await createDocument();
    const error = await expectSqlError(
      db.query("update public.documents set supersedes_id = id where id = $1", [doc]),
    );
    expect(error.code).toBe("23514");
  });
});

describe("the review history is append-only", () => {
  it("refuses to change or delete an event", async () => {
    const doc = await createDocument();
    await db.query("select public.review_document($1, $2, 'rejected', 'Unreadable scan')", [doc, analyst]);

    const changed = await expectSqlError(
      db.query("update public.document_review_events set reason = 'Something else' where document_id = $1", [doc]),
    );
    expect(changed.code).toBe("42501");

    const removed = await expectSqlError(
      db.query("delete from public.document_review_events where document_id = $1", [doc]),
    );
    expect(removed.code).toBe("42501");
  });
});

describe("who can see what", () => {
  it("hides pending documents from an ordinary user but shows them to staff", async () => {
    const doc = await createDocument();
    const reader = await createUser(db);

    const readerSees = await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.documents where id = $1", [doc]);
      return rows.length;
    });
    const staffSees = await asUser(db, analyst, async () => {
      const { rows } = await db.query("select id from public.documents where id = $1", [doc]);
      return rows.length;
    });

    expect(readerSees).toBe(0);
    expect(staffSees).toBe(1);
  });

  it("keeps the review history away from ordinary users", async () => {
    const doc = await createDocument();
    await db.query("select public.review_document($1, $2, 'approved')", [doc, analyst]);
    const reader = await createUser(db);

    const visible = await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.document_review_events where document_id = $1", [doc]);
      return rows.length;
    });

    expect(visible).toBe(0);
  });
});
