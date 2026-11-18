import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase, createUser, expectSqlError } from "./db";

/**
 * Source documents are licensed material. The only sanctioned read path is a
 * short-lived signed URL minted by a server process holding the service key, so no
 * client role may touch the bucket — not even a platform administrator's session.
 */

let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
}, 60_000);

describe("the document bucket", () => {
  it("is created private, with a size cap and a mime allowlist", async () => {
    const { rows } = await db.query<{
      public: boolean;
      file_size_limit: string | number | null;
      allowed_mime_types: string[] | null;
    }>("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'source-documents'");

    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
    expect(Number(rows[0].file_size_limit)).toBe(52_428_800);
    expect(rows[0].allowed_mime_types).toContain("application/pdf");
  });

  it("has row-level security enabled on the objects table", async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid = 'storage.objects'::regclass",
    );
    expect(rows[0].relrowsecurity).toBe(true);
  });
});

describe("client roles cannot reach source documents", () => {
  it("hides stored objects from a signed-in user", async () => {
    await db.query(
      "insert into storage.objects (bucket_id, name) values ('source-documents', 'MTNN/2026/h1-report.pdf')",
    );
    const user = await createUser(db);

    const visible = await asUser(db, user, async () => {
      const { rows } = await db.query("select name from storage.objects where bucket_id = 'source-documents'");
      return rows;
    });

    expect(visible).toEqual([]);
  });

  it("hides them from a platform administrator's session too", async () => {
    const admin = await createUser(db, { admin: true });

    const visible = await asUser(db, admin, async () => {
      const { rows } = await db.query("select name from storage.objects where bucket_id = 'source-documents'");
      return rows;
    });

    expect(visible).toEqual([]);
  });

  it("refuses an upload from a signed-in user", async () => {
    const user = await createUser(db);

    const error = await asUser(db, user, () =>
      expectSqlError(
        db.query("insert into storage.objects (bucket_id, name) values ('source-documents', 'planted.pdf')"),
      ),
    );

    expect(error.code).toBe("42501");
  });

  it("does not let a client list the bucket's configuration", async () => {
    const user = await createUser(db);

    const visible = await asUser(db, user, async () => {
      const { rows } = await db.query("select id from storage.buckets where id = 'source-documents'");
      return rows;
    });

    expect(visible).toEqual([]);
  });
});

describe("the restriction survives a later mistake", () => {
  it("still denies access after a permissive read policy is added", async () => {
    // Exactly the sort of policy someone might add to "let analysts see documents".
    await db.exec(`
      create policy "Well-meaning but wrong" on storage.objects
      for select to authenticated using (true);
    `);
    const user = await createUser(db);

    try {
      const visible = await asUser(db, user, async () => {
        const { rows } = await db.query("select name from storage.objects where bucket_id = 'source-documents'");
        return rows;
      });
      // The restrictive policy is ANDed with the permissive one, so the bucket stays shut.
      expect(visible).toEqual([]);
    } finally {
      await db.exec('drop policy "Well-meaning but wrong" on storage.objects');
    }
  });

  it("leaves other buckets to their own policies", async () => {
    await db.query(
      "insert into storage.buckets (id, name, public) values ('public-brand-assets', 'public-brand-assets', true) on conflict (id) do nothing",
    );
    await db.query("insert into storage.objects (bucket_id, name) values ('public-brand-assets', 'logo.png')");
    await db.exec(`
      create policy "Brand assets are readable" on storage.objects
      for select to authenticated using (bucket_id = 'public-brand-assets');
    `);
    const user = await createUser(db);

    try {
      const visible = await asUser(db, user, async () => {
        const { rows } = await db.query<{ name: string }>(
          "select name from storage.objects where bucket_id = 'public-brand-assets'",
        );
        return rows.map((r) => r.name);
      });
      expect(visible).toEqual(["logo.png"]);
    } finally {
      await db.exec('drop policy "Brand assets are readable" on storage.objects');
    }
  });
});
