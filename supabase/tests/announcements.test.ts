import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * An announcement is a claim tied to its evidence. These tests pin down what it
 * may rest on, that it cannot be quietly edited or deleted, and that a reader
 * always sees a correction or a withdrawal rather than a silent change.
 */

let db: PGlite;
let analyst: string;
let reviewer: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  reviewer = await createUser(db, { staff: ["analyst"] });
}, 180_000);

let counter = 0;

/** An uploaded document, optionally approved, optionally with a public link. */
async function makeDocument(opts: { approve?: boolean; sourceUri?: string | null; approver?: string } = {}) {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'announcement', $2, $3, $4,
       'application/pdf', 2048, 'issuer_document', null, $5
     ) as id`,
    [
      analyst,
      `Announcement source ${counter}`,
      `aa/ann-${counter}.pdf`,
      sha256(`ann-${counter}`),
      opts.sourceUri === undefined ? `https://issuer.test/release-${counter}.pdf` : opts.sourceUri,
    ],
  );
  const id = rows[0].id;
  if (opts.approve !== false) {
    await db.query("select public.review_document($1, $2, 'approved')", [id, opts.approver ?? reviewer]);
  }
  return id;
}

async function publish(documentId: string, actor = analyst, extra: Record<string, unknown> = {}) {
  const { rows } = await db.query<{ id: string }>(
    `select public.publish_announcement(
       $1, $2, 'results', $3, now() - interval '1 hour', $4, $5, null, $6, $7
     ) as id`,
    [
      actor,
      documentId,
      (extra.headline as string) ?? `Headline ${counter}`,
      (extra.summary as string) ?? null,
      (extra.priceSensitive as boolean) ?? false,
      (extra.supersedes as string) ?? null,
      (extra.correctionReason as string) ?? null,
    ],
  );
  return rows[0].id;
}

async function statusOf(id: string) {
  const { rows } = await db.query<{ status: string }>("select status from public.announcements where id = $1", [id]);
  return rows[0]?.status;
}

describe("an announcement must rest on approved, citable evidence", () => {
  it("publishes from an approved document that has a public link", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);
    expect(await statusOf(id)).toBe("published");
  });

  it("refuses a document that is still pending", async () => {
    const doc = await makeDocument({ approve: false });
    const error = await expectSqlError(publish(doc));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/approved document/i);
  });

  it("refuses a rejected document", async () => {
    const doc = await makeDocument({ approve: false });
    await db.query("select public.review_document($1, $2, 'rejected', 'Wrong issuer')", [doc, reviewer]);
    const error = await expectSqlError(publish(doc));
    expect(error.code).toBe("23514");
  });

  it("refuses a document with no public source link", async () => {
    const doc = await makeDocument({ sourceUri: null });
    const error = await expectSqlError(publish(doc));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/no public source link/i);
  });

  it("keeps provenance: the source record must belong to the cited document", async () => {
    const doc = await makeDocument();
    const other = await makeDocument();
    const { rows } = await db.query<{ id: string }>(
      "select id from public.source_records where document_id = $1 limit 1",
      [other],
    );
    const { rows: docRow } = await db.query<{ source_uri: string }>(
      "select source_uri from public.documents where id = $1",
      [doc],
    );
    const error = await expectSqlError(
      db.query(
        `insert into public.announcements (document_id, source_record_id, source_uri, category, headline, announced_at)
         values ($1, $2, $3, 'results', 'Mismatched provenance', now())`,
        [doc, rows[0].id, docRow[0].source_uri],
      ),
    );
    expect(error.code).toBe("23514");
  });

  it("carries the document's own source link, so the feed never depends on document visibility", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);

    const { rows } = await db.query<{ source_uri: string; doc_uri: string }>(
      `select a.source_uri, d.source_uri as doc_uri
       from public.announcements a join public.documents d on d.id = a.document_id
       where a.id = $1`,
      [id],
    );
    expect(rows[0].source_uri).toBe(rows[0].doc_uri);
    expect(rows[0].source_uri).toMatch(/^https:\/\//);
  });

  it("refuses a source link that is not the cited document's", async () => {
    const doc = await makeDocument();
    const { rows } = await db.query<{ id: string }>(
      "select id from public.source_records where document_id = $1 limit 1",
      [doc],
    );
    const error = await expectSqlError(
      db.query(
        `insert into public.announcements (document_id, source_record_id, source_uri, category, headline, announced_at)
         values ($1, $2, 'https://attacker.test/elsewhere.pdf', 'results', 'Wrong link', now())`,
        [doc, rows[0].id],
      ),
    );
    expect(error.code).toBe("23514");
  });

  it("does not retract an announcement when its document is later superseded", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);

    const replacement = await makeDocument();
    await db.query("update public.documents set supersedes_id = $1 where id = $2", [doc, replacement]);
    await db.query("select public.review_document($1, $2, 'superseded', 'Restated')", [doc, reviewer]);

    // It was true when published; only new announcements are blocked.
    expect(await statusOf(id)).toBe("published");
    const error = await expectSqlError(publish(doc));
    expect(error.code).toBe("23514");
  });
});

describe("only one live announcement per document", () => {
  it("refuses a second publication of the same document", async () => {
    const doc = await makeDocument();
    await publish(doc);
    const error = await expectSqlError(publish(doc));
    expect(error.code).toBe("23505");
  });
});

describe("self-publishing is recorded", () => {
  it("flags the publisher who also approved the document", async () => {
    const doc = await makeDocument({ approver: analyst });
    const id = await publish(doc, analyst);
    const { rows } = await db.query<{ self_published: boolean }>(
      "select self_published from public.announcements where id = $1",
      [id],
    );
    expect(rows[0].self_published).toBe(true);
  });

  it("does not flag it when someone else approved the document", async () => {
    const doc = await makeDocument({ approver: reviewer });
    const id = await publish(doc, analyst);
    const { rows } = await db.query<{ self_published: boolean }>(
      "select self_published from public.announcements where id = $1",
      [id],
    );
    expect(rows[0].self_published).toBe(false);
  });

  it("does not claim independent approval once the approver's account is gone", async () => {
    // An unknown reviewer must count as self-published. Reading "false" off a
    // null reviewer would assert a second pair of eyes nobody can show — the
    // same defect fixed in publish_editorial_item and avoided in review_company.
    const leaver = await createUser(db, { staff: ["analyst"] });
    const doc = await makeDocument({ approver: leaver });
    await db.query("delete from auth.users where id = $1", [leaver]);

    const id = await publish(doc, analyst);
    const { rows } = await db.query<{ self_published: boolean }>(
      "select self_published from public.announcements where id = $1",
      [id],
    );
    expect(rows[0].self_published).toBe(true);
  });
});

describe("corrections replace rather than rewrite", () => {
  it("supersedes the old version and keeps both", async () => {
    const doc = await makeDocument();
    const first = await publish(doc, analyst, { headline: "Profit up 10%" });
    const second = await publish(doc, analyst, {
      headline: "Profit up 12%",
      supersedes: first,
      correctionReason: "Transposed figure in the original",
    });

    expect(await statusOf(first)).toBe("superseded");
    expect(await statusOf(second)).toBe("published");

    const { rows } = await db.query<{ version: number; correction_reason: string }>(
      "select version, correction_reason from public.announcements where id = $1",
      [second],
    );
    expect(rows[0].version).toBe(2);
    expect(rows[0].correction_reason).toBe("Transposed figure in the original");
  });

  it("requires a reason", async () => {
    const doc = await makeDocument();
    const first = await publish(doc);
    const error = await expectSqlError(publish(doc, analyst, { supersedes: first }));
    expect(error.code).toBe("23514");
  });

  it("refuses to correct something already superseded", async () => {
    const doc = await makeDocument();
    const first = await publish(doc);
    await publish(doc, analyst, { supersedes: first, correctionReason: "First fix" });
    const error = await expectSqlError(
      publish(doc, analyst, { supersedes: first, correctionReason: "Second fix" }),
    );
    expect(error.code).toBe("23514");
  });
});

describe("withdrawal is explicit and never silent", () => {
  it("withdraws with a reason, keeping the row readable", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);

    await db.query("select public.withdraw_announcement($1, $2, 'Issuer retracted the release')", [id, analyst]);

    const { rows } = await db.query<{
      status: string;
      withdrawal_reason: string;
      withdrawn_at: string;
      withdrawn_by: string;
      headline: string;
    }>("select status, withdrawal_reason, withdrawn_at, withdrawn_by, headline from public.announcements where id = $1", [id]);

    expect(rows[0].status).toBe("withdrawn");
    expect(rows[0].withdrawal_reason).toBe("Issuer retracted the release");
    expect(rows[0].withdrawn_at).toBeTruthy();
    expect(rows[0].withdrawn_by).toBe(analyst);
    // The words stay: a reader sees what was said and that it was withdrawn.
    expect(rows[0].headline).toBeTruthy();
  });

  it("requires a reason", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);
    for (const reason of ["", "   "]) {
      const error = await expectSqlError(
        db.query("select public.withdraw_announcement($1, $2, $3)", [id, analyst, reason]),
      );
      expect(error.code).toBe("23514");
    }
  });

  it("is terminal, and frees the document for a fresh announcement", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);
    await db.query("select public.withdraw_announcement($1, $2, 'Published in error')", [id, analyst]);

    const again = await expectSqlError(
      db.query("select public.withdraw_announcement($1, $2, 'Again')", [id, analyst]),
    );
    expect(again.code).toBe("23514");

    // Withdrawn is not 'published', so the partial unique index allows a new one.
    await expect(publish(doc)).resolves.toBeTruthy();
  });

  it("writes an audit entry", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);
    await db.query("select public.withdraw_announcement($1, $2, 'Duplicate')", [id, analyst]);

    const { rows } = await db.query<{ action: string }>(
      "select action from public.audit_logs where details ->> 'announcement_id' = $1 order by created_at",
      [id],
    );
    expect(rows.map((r) => r.action)).toContain("announcement.withdrawn");
  });
});

describe("an announcement cannot be quietly changed", () => {
  it("refuses edits to what it says", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);

    for (const statement of [
      "update public.announcements set headline = 'Rewritten' where id = $1",
      "update public.announcements set summary = 'Rewritten' where id = $1",
      "update public.announcements set announced_at = now() where id = $1",
      // A real change: this row was published by someone who did not approve the
      // document, so self_published is false and setting it true is a rewrite.
      "update public.announcements set self_published = true where id = $1",
      "update public.announcements set document_id = gen_random_uuid() where id = $1",
    ]) {
      const error = await expectSqlError(db.query(statement, [id]));
      expect(error.code).toBe("23514");
    }
  });

  it("refuses a direct status change outside the trusted functions", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);
    const error = await expectSqlError(
      db.query("update public.announcements set status = 'withdrawn', withdrawn_at = now(), withdrawal_reason = 'x' where id = $1", [id]),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses deletion", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);
    const error = await expectSqlError(db.query("delete from public.announcements where id = $1", [id]));
    expect(error.code).toBe("42501");
  });

  it("lets a publisher's account be deleted, anonymising the record", async () => {
    const leaver = await createUser(db, { staff: ["analyst"] });
    const doc = await makeDocument();
    const id = await publish(doc, leaver);

    await db.query("delete from auth.users where id = $1", [leaver]);

    const { rows } = await db.query<{ published_by: string | null; status: string }>(
      "select published_by, status from public.announcements where id = $1",
      [id],
    );
    expect(rows[0].published_by).toBeNull();
    expect(rows[0].status).toBe("published");
  });

  it("refuses reattribution to a different person", async () => {
    const doc = await makeDocument();
    const id = await publish(doc, analyst);
    const error = await expectSqlError(
      db.query("update public.announcements set published_by = $1 where id = $2", [reviewer, id]),
    );
    expect(error.code).toBe("42501");
  });
});

describe("who may publish, and who may read", () => {
  it("refuses an ordinary signed-in user", async () => {
    const doc = await makeDocument();
    const outsider = await createUser(db);
    const error = await expectSqlError(publish(doc, outsider));
    expect(error.code).toBe("42501");
  });

  it("refuses a staff member without a publishing role", async () => {
    const doc = await makeDocument();
    const factChecker = await createUser(db, { staff: ["fact_checker"] });
    const error = await expectSqlError(publish(doc, factChecker));
    expect(error.code).toBe("42501");
  });

  it("refuses withdrawal by an ordinary user", async () => {
    const doc = await makeDocument();
    const id = await publish(doc);
    const outsider = await createUser(db);
    const error = await expectSqlError(
      db.query("select public.withdraw_announcement($1, $2, 'Not mine to withdraw')", [id, outsider]),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses a client write even from an administrator's session", async () => {
    const admin = await createUser(db, { admin: true });
    const doc = await makeDocument();
    const { rows } = await db.query<{ id: string }>(
      "select id from public.source_records where document_id = $1 limit 1",
      [doc],
    );
    const error = await asUser(db, admin, () =>
      expectSqlError(
        db.query(
          `insert into public.announcements (document_id, source_record_id, source_uri, category, headline, announced_at)
           values ($1, $2, 'https://issuer.test/x.pdf', 'results', 'Planted', now())`,
          [doc, rows[0].id],
        ),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("shows readers published and withdrawn, but not superseded versions", async () => {
    const doc = await makeDocument();
    const first = await publish(doc, analyst, { headline: "Original" });
    await publish(doc, analyst, { supersedes: first, correctionReason: "Fixed a figure", headline: "Corrected" });

    const withdrawnDoc = await makeDocument();
    const withdrawn = await publish(withdrawnDoc, analyst, { headline: "Withdrawn item" });
    await db.query("select public.withdraw_announcement($1, $2, 'Retracted by issuer')", [withdrawn, analyst]);

    const reader = await createUser(db);
    const visible = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ headline: string; status: string }>(
        "select headline, status from public.announcements where document_id in ($1, $2)",
        [doc, withdrawnDoc],
      );
      return rows;
    });

    const statuses = visible.map((r) => r.status).sort();
    expect(statuses).toEqual(["published", "withdrawn"]);
    expect(visible.map((r) => r.headline)).not.toContain("Original");
  });

  it("shows staff every version, including superseded ones", async () => {
    const doc = await makeDocument();
    const first = await publish(doc, analyst, { headline: "Staff original" });
    await publish(doc, analyst, { supersedes: first, correctionReason: "Fix", headline: "Staff corrected" });

    const seen = await asUser(db, analyst, async () => {
      const { rows } = await db.query<{ status: string }>(
        "select status from public.announcements where document_id = $1",
        [doc],
      );
      return rows.map((r) => r.status).sort();
    });

    expect(seen).toEqual(["published", "superseded"]);
  });
});
