import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * Editorial: SFI's own writing. A draft is freely editable; once published it is
 * a matter of record. An article must show its evidence before it can claim
 * anything, and nothing is ever edited in place or deleted.
 */

let db: PGlite;
let analyst: string;
let editor: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  editor = await createUser(db, { staff: ["editor"] });
}, 180_000);

let counter = 0;

async function approvedDocument(): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 2048, 'issuer_document', null, $5
     ) as id`,
    [analyst, `Editorial source ${counter}`, `aa/ed-${counter}.pdf`, sha256(`ed-${counter}`), `https://issuer.test/ed-${counter}.pdf`],
  );
  await db.query("select public.review_document($1, $2, 'approved')", [rows[0].id, editor]);
  return rows[0].id;
}

async function draft(overrides: Record<string, unknown> = {}): Promise<string> {
  counter += 1;
  const kind = (overrides.kind as string) ?? "article";
  const { rows } = await db.query<{ id: string }>(
    `insert into public.editorial_items (kind, slug, title, body_text, video_id, guest_name, author_id, ai_assisted, ai_model, supersedes_id, correction_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      kind,
      (overrides.slug as string) ?? `item-${counter}`,
      (overrides.title as string) ?? `Item ${counter}`,
      kind === "video" ? null : ((overrides.body as string) ?? "First paragraph.\n\nSecond paragraph."),
      kind === "video" ? ((overrides.videoId as string) ?? "dQw4w9WgXcQ") : null,
      kind === "video" ? ((overrides.guest as string) ?? "Dr Adaeze Okafor") : null,
      (overrides.author as string) ?? analyst,
      (overrides.aiAssisted as boolean) ?? false,
      (overrides.aiModel as string) ?? null,
      (overrides.supersedes as string) ?? null,
      (overrides.correctionReason as string) ?? null,
    ],
  );
  return rows[0].id;
}

async function cite(itemId: string, documentId: string) {
  await db.query(
    "insert into public.editorial_citations (item_id, claim, document_id, source_page) values ($1, 'Revenue rose', $2, 12)",
    [itemId, documentId],
  );
}

async function statusOf(id: string) {
  const { rows } = await db.query<{ status: string }>("select status from public.editorial_items where id = $1", [id]);
  return rows[0]?.status;
}

describe("the shape of an item", () => {
  it("rejects a slug that could carry a path, scheme or traversal", async () => {
    for (const slug of ["../etc", "a/b", "Upper", "trailing-", "has space", "dot.dot", "a%2fb", "x"]) {
      const error = await expectSqlError(draft({ slug }));
      expect(error.code).toBe("23514");
    }
    await expect(draft({ slug: "mtn-q3-2026-results" })).resolves.toBeTruthy();
  });

  it("rejects anything that is not an 11-character YouTube id", async () => {
    for (const videoId of ["https://youtube.com/watch?v=dQw4w9WgXcQ", "short", "dQw4w9WgXcQextra", "dQw4w9WgXc!", ""]) {
      const error = await expectSqlError(draft({ kind: "video", videoId }));
      expect(error.code).toBe("23514");
    }
    await expect(draft({ kind: "video", videoId: "aBc-123_xyZ" })).resolves.toBeTruthy();
  });

  it("insists an article has prose and a video has none", async () => {
    expect((await expectSqlError(draft({ body: "   " }))).code).toBe("23514");
    const error = await expectSqlError(
      db.query(
        `insert into public.editorial_items (kind, slug, title, body_text, video_id)
         values ('video', 'video-with-body', 'Bad', 'Prose', 'dQw4w9WgXcQ')`,
      ),
    );
    expect(error.code).toBe("23514");
  });

  it("insists AI-assisted work names the model", async () => {
    expect((await expectSqlError(draft({ aiAssisted: true }))).code).toBe("23514");
    await expect(draft({ aiAssisted: true, aiModel: "claude-opus-5" })).resolves.toBeTruthy();
  });
});

describe("publication requires evidence", () => {
  it("refuses an article with no citation", async () => {
    const item = await draft();
    const error = await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [item, editor]));
    expect(error.code).toBe("23514");
    expect(error.message).toMatch(/cite at least one source/i);
    expect(await statusOf(item)).toBe("draft");
  });

  it("publishes an article once it cites an approved document", async () => {
    const item = await draft();
    await cite(item, await approvedDocument());
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);
    expect(await statusOf(item)).toBe("published");
  });

  it("publishes a video without any citation", async () => {
    const item = await draft({ kind: "video" });
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);
    expect(await statusOf(item)).toBe("published");
  });

  it("refuses a citation resting on a document that is not approved", async () => {
    counter += 1;
    const { rows } = await db.query<{ id: string }>(
      `select public.record_uploaded_document(
         $1, 'companies.documents', 'issuer_ir', 'annual_report', 'Pending source', $2, $3,
         'application/pdf', 2048, 'issuer_document', null, 'https://issuer.test/pending.pdf'
       ) as id`,
      [analyst, `aa/pending-${counter}.pdf`, sha256(`pending-${counter}`)],
    );
    const item = await draft();
    const error = await expectSqlError(
      db.query("insert into public.editorial_citations (item_id, claim, document_id) values ($1, 'x', $2)", [
        item,
        rows[0].id,
      ]),
    );
    expect(error.code).toBe("23514");
  });

  it("requires a citation to name exactly one source", async () => {
    const item = await draft();
    const doc = await approvedDocument();
    expect(
      (
        await expectSqlError(
          db.query("insert into public.editorial_citations (item_id, claim) values ($1, 'none')", [item]),
        )
      ).code,
    ).toBe("23514");
    await expect(cite(item, doc)).resolves.toBeUndefined();
  });
});

describe("a draft is editable, a published item is not", () => {
  it("allows free editing while a draft", async () => {
    const item = await draft();
    await db.query("update public.editorial_items set title = 'Rewritten', body_text = 'New body.' where id = $1", [item]);
    const { rows } = await db.query<{ title: string }>("select title from public.editorial_items where id = $1", [item]);
    expect(rows[0].title).toBe("Rewritten");
  });

  it("refuses edits once published", async () => {
    const item = await draft();
    await cite(item, await approvedDocument());
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);

    for (const statement of [
      "update public.editorial_items set title = 'Rewritten' where id = $1",
      "update public.editorial_items set body_text = 'Rewritten' where id = $1",
      "update public.editorial_items set slug = 'different-slug' where id = $1",
      "update public.editorial_items set ai_assisted = true, ai_model = 'x' where id = $1",
    ]) {
      expect((await expectSqlError(db.query(statement, [item]))).code).toBe("23514");
    }
  });

  it("refuses a direct status change outside the trusted functions", async () => {
    const item = await draft();
    const error = await expectSqlError(
      db.query("update public.editorial_items set status = 'published', published_at = now() where id = $1", [item]),
    );
    expect(error.code).toBe("42501");
  });

  it("refuses deletion", async () => {
    const item = await draft();
    expect((await expectSqlError(db.query("delete from public.editorial_items where id = $1", [item]))).code).toBe("42501");
  });

  it("refuses citations being added to or removed from a published item", async () => {
    const item = await draft();
    const doc = await approvedDocument();
    await cite(item, doc);
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);

    expect((await expectSqlError(cite(item, doc))).code).toBe("42501");
    expect(
      (await expectSqlError(db.query("delete from public.editorial_citations where item_id = $1", [item]))).code,
    ).toBe("42501");
  });
});

describe("corrections and withdrawal", () => {
  it("supersedes the original and keeps the same address", async () => {
    const doc = await approvedDocument();
    const first = await draft({ slug: "shared-slug" });
    await cite(first, doc);
    await db.query("select public.publish_editorial_item($1, $2)", [first, editor]);

    const second = await draft({ slug: "shared-slug", supersedes: first, correctionReason: "Misstated margin" });
    await cite(second, doc);
    await db.query("select public.publish_editorial_item($1, $2)", [second, editor]);

    expect(await statusOf(first)).toBe("superseded");
    expect(await statusOf(second)).toBe("published");
    const { rows } = await db.query<{ version: number }>("select version from public.editorial_items where id = $1", [second]);
    expect(rows[0].version).toBe(2);
  });

  it("refuses a correction that changes the address", async () => {
    const doc = await approvedDocument();
    const first = await draft({ slug: "original-slug" });
    await cite(first, doc);
    await db.query("select public.publish_editorial_item($1, $2)", [first, editor]);

    const second = await draft({ slug: "moved-slug", supersedes: first, correctionReason: "Fix" });
    await cite(second, doc);
    const error = await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [second, editor]));
    expect(error.code).toBe("23514");
  });

  it("withdraws with a reason and keeps the item readable", async () => {
    const item = await draft({ kind: "video" });
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);
    await db.query("select public.withdraw_editorial_item($1, $2, 'Guest requested removal')", [item, editor]);

    const { rows } = await db.query<{ status: string; withdrawal_reason: string; title: string }>(
      "select status, withdrawal_reason, title from public.editorial_items where id = $1",
      [item],
    );
    expect(rows[0].status).toBe("withdrawn");
    expect(rows[0].withdrawal_reason).toBe("Guest requested removal");
    expect(rows[0].title).toBeTruthy();
  });

  it("requires a reason to withdraw", async () => {
    const item = await draft({ kind: "video" });
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);
    expect(
      (await expectSqlError(db.query("select public.withdraw_editorial_item($1, $2, '  ')", [item, editor]))).code,
    ).toBe("23514");
  });

  it("keeps a withdrawn item's address reserved", async () => {
    const item = await draft({ kind: "video", slug: "taken-slug" });
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);
    await db.query("select public.withdraw_editorial_item($1, $2, 'Retracted')", [item, editor]);

    const other = await draft({ kind: "video", slug: "taken-slug" });
    const error = await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [other, editor]));
    expect(error.code).toBe("23505");
  });
});

describe("self-review is recorded, not blocked", () => {
  it("flags publication by the author", async () => {
    const item = await draft({ author: analyst });
    await cite(item, await approvedDocument());
    await db.query("select public.publish_editorial_item($1, $2)", [item, analyst]);
    const { rows } = await db.query<{ self_reviewed: boolean }>(
      "select self_reviewed from public.editorial_items where id = $1",
      [item],
    );
    expect(rows[0].self_reviewed).toBe(true);
  });

  it("does not flag publication by someone else", async () => {
    const item = await draft({ author: analyst });
    await cite(item, await approvedDocument());
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);
    const { rows } = await db.query<{ self_reviewed: boolean }>(
      "select self_reviewed from public.editorial_items where id = $1",
      [item],
    );
    expect(rows[0].self_reviewed).toBe(false);
  });
});

describe("who may publish, and who may read", () => {
  it("refuses an ordinary user and a staff member without a publishing role", async () => {
    const item = await draft({ kind: "video" });
    const outsider = await createUser(db);
    const factChecker = await createUser(db, { staff: ["fact_checker"] });

    for (const actor of [outsider, factChecker]) {
      const error = await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [item, actor]));
      expect(error.code).toBe("42501");
    }
  });

  it("hides drafts and superseded versions from readers", async () => {
    const doc = await approvedDocument();
    const first = await draft({ slug: "visibility-test" });
    await cite(first, doc);
    await db.query("select public.publish_editorial_item($1, $2)", [first, editor]);
    const second = await draft({ slug: "visibility-test", supersedes: first, correctionReason: "Fix" });
    await cite(second, doc);
    await db.query("select public.publish_editorial_item($1, $2)", [second, editor]);
    const stillDraft = await draft({ slug: "never-published" });

    const reader = await createUser(db);
    const visible = await asUser(db, reader, async () => {
      const { rows } = await db.query<{ id: string; status: string }>(
        "select id, status from public.editorial_items where id in ($1, $2, $3)",
        [first, second, stillDraft],
      );
      return rows;
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(second);
  });

  it("hides a draft's working sources from readers", async () => {
    const item = await draft();
    await cite(item, await approvedDocument());
    const reader = await createUser(db);

    const seen = await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.editorial_citations where item_id = $1", [item]);
      return rows.length;
    });
    expect(seen).toBe(0);
  });

  it("refuses a client write even from an administrator's session", async () => {
    const admin = await createUser(db, { admin: true });
    const error = await asUser(db, admin, () =>
      expectSqlError(
        db.query(
          `insert into public.editorial_items (kind, slug, title, body_text) values ('article', 'planted', 'Planted', 'Body.')`,
        ),
      ),
    );
    expect(error.code).toBe("42501");
  });
});

describe("the audit log is append-only", () => {
  it("refuses to change or delete an entry", async () => {
    const item = await draft({ kind: "video" });
    await db.query("select public.publish_editorial_item($1, $2)", [item, editor]);

    const { rows } = await db.query<{ id: string }>(
      "select id from public.audit_logs where action = 'editorial.published' order by created_at desc limit 1",
    );
    const entry = rows[0].id;

    for (const statement of [
      "update public.audit_logs set action = 'something.else' where id = $1",
      "update public.audit_logs set details = '{}'::jsonb where id = $1",
      "update public.audit_logs set created_at = now() where id = $1",
      "delete from public.audit_logs where id = $1",
    ]) {
      expect((await expectSqlError(db.query(statement, [entry]))).code).toBe("42501");
    }
  });

  it("still lets an actor's account be deleted, anonymising their entries", async () => {
    const leaver = await createUser(db, { staff: ["editor"] });
    const item = await draft({ kind: "video" });
    await db.query("select public.publish_editorial_item($1, $2)", [item, leaver]);

    await db.query("delete from auth.users where id = $1", [leaver]);

    const { rows } = await db.query<{ n: string }>(
      "select count(*) as n from public.audit_logs where actor_user_id is null and action = 'editorial.published'",
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });
});
