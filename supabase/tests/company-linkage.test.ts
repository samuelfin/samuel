import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * A company page shows the company's documents, announcements and research. All
 * three depend on company_id actually being set — and before this stage nothing
 * set it anywhere: the announcement action passed null on purpose, and editorial
 * items never carried one. The panels would have read "No data yet" forever while
 * the records sat in the database unlinked, which is the most misleading kind of
 * empty state because it looks correct.
 *
 * These tests pin the linkage down from the database's side: that a record can be
 * attached to a company, that it comes back when that company's page asks, and
 * that it cannot be attached to a company a reader may not see.
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

async function makeCompany(opts: { approve?: boolean } = {}): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_company_profile(
       $1, $2, $3, 'listed', null, null, null, null, null, null, null, $4, null
     ) as id`,
    [analyst, `Linkage Test ${counter} Plc`, `linkage-test-${counter}`, `LINK${counter}`],
  );
  const id = rows[0].id;
  if (opts.approve !== false) {
    await db.query("select public.review_company($1, $2, 'approved')", [id, reviewer]);
  }
  return id;
}

async function makeDocument(companyId: string | null): Promise<string> {
  counter += 1;
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 4096, 'issuer_document', $5, $6
     ) as id`,
    [
      analyst,
      `Linkage document ${counter}`,
      `lk/doc-${counter}.pdf`,
      sha256(`linkage-${counter}`),
      companyId,
      `https://issuer.test/report-${counter}.pdf`,
    ],
  );
  const id = rows[0].id;
  await db.query("select public.review_document($1, $2, 'approved')", [id, reviewer]);
  return id;
}

describe("a document reaches its company's page", () => {
  it("is found by company once attached", async () => {
    const company = await makeCompany();
    const document = await makeDocument(company);

    const { rows } = await db.query<{ id: string }>(
      "select id from public.documents where company_id = $1 and review_status = 'approved'",
      [company],
    );
    expect(rows.map((r) => r.id)).toContain(document);
  });

  it("belongs to no company when none is given, which a regulator filing does not", async () => {
    const document = await makeDocument(null);
    const { rows } = await db.query<{ company_id: string | null }>(
      "select company_id from public.documents where id = $1",
      [document],
    );
    expect(rows[0].company_id).toBeNull();
  });

  it("cannot name a company that does not exist", async () => {
    const error = await expectSqlError(makeDocument("00000000-0000-0000-0000-000000000000"));
    expect(error.code).toBe("23503");
  });
});

describe("an announcement reaches its company's page", () => {
  it("is found by company once attached", async () => {
    const company = await makeCompany();
    const document = await makeDocument(company);

    const { rows } = await db.query<{ id: string }>(
      `select public.publish_announcement(
         $1, $2, 'results', 'Full year results', now() - interval '2 hours',
         null, false, $3, null, null
       ) as id`,
      [analyst, document, company],
    );
    const announcement = rows[0].id;

    const { rows: found } = await db.query<{ id: string }>(
      "select id from public.announcements where company_id = $1 and status = 'published'",
      [company],
    );
    expect(found.map((r) => r.id)).toContain(announcement);
  });

  it("cannot be attached to a company that does not exist", async () => {
    const company = await makeCompany();
    const document = await makeDocument(company);
    const error = await expectSqlError(
      db.query(
        `select public.publish_announcement(
           $1, $2, 'results', 'Forged issuer', now(), null, false,
           '00000000-0000-0000-0000-000000000000', null, null
         )`,
        [analyst, document],
      ),
    );
    expect(error.code).toBe("23503");
  });
});

describe("research reaches its company's page", () => {
  async function publishItem(companyId: string | null): Promise<string> {
    counter += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into public.editorial_items (kind, slug, title, body_text, company_id, author_id)
         values ('analysis', $1, $2, $3, $4, $5) returning id`,
      [
        `linkage-analysis-${counter}`,
        `Linkage analysis ${counter}`,
        "What the filing says about margins.",
        companyId,
        analyst,
      ],
    );
    const item = rows[0].id;

    const document = await makeDocument(companyId);
    await db.query(
      `insert into public.editorial_citations (item_id, claim, document_id, source_page)
         values ($1, 'Revenue grew.', $2, 12)`,
      [item, document],
    );
    await db.query("select public.publish_editorial_item($1, $2)", [item, reviewer]);
    return item;
  }

  it("is found by company once attached", async () => {
    const company = await makeCompany();
    const item = await publishItem(company);

    const { rows } = await db.query<{ id: string }>(
      "select id from public.editorial_items where company_id = $1 and status = 'published'",
      [company],
    );
    expect(rows.map((r) => r.id)).toContain(item);
  });

  it("belongs to no company when none is given, which a market-wide piece does not", async () => {
    const item = await publishItem(null);
    const { rows } = await db.query<{ company_id: string | null }>(
      "select company_id from public.editorial_items where id = $1",
      [item],
    );
    expect(rows[0].company_id).toBeNull();
  });

  it("cannot name a company that does not exist", async () => {
    const error = await expectSqlError(publishItem("00000000-0000-0000-0000-000000000000"));
    expect(error.code).toBe("23503");
  });
});

describe("a company page shows nothing belonging to another company", () => {
  it("keeps each company's records to itself", async () => {
    const first = await makeCompany();
    const second = await makeCompany();
    const firstDocument = await makeDocument(first);
    await makeDocument(second);

    const { rows } = await db.query<{ id: string }>(
      "select id from public.documents where company_id = $1",
      [first],
    );
    expect(rows.map((r) => r.id)).toEqual([firstDocument]);
  });
});
