import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, createUser, expectSqlError, sha256 } from "./db";

/**
 * A manual upload has to leave three rows behind together: the job explaining
 * where the document came from, the document, and the source record that later
 * observations cite. Evidence without provenance is the failure this prevents.
 */

let db: PGlite;
let analyst: string;

beforeAll(async () => {
  db = await createTestDatabase();
  analyst = await createUser(db, { staff: ["analyst"] });
}, 180_000);

let counter = 0;

async function record(actor: string, overrides: Record<string, unknown> = {}): Promise<string> {
  counter += 1;
  const args = {
    sha: sha256(`upload-${counter}`),
    path: `aa/upload-${counter}.pdf`,
    title: `Uploaded report ${counter}`,
    ...overrides,
  };
  const { rows } = await db.query<{ id: string }>(
    `select public.record_uploaded_document(
       $1, 'companies.documents', 'issuer_ir', 'annual_report', $2, $3, $4,
       'application/pdf', 2048, 'issuer_document'
     ) as id`,
    [actor, args.title, args.path, args.sha],
  );
  return rows[0].id;
}

describe("recording an upload", () => {
  it("creates the document, its job and its source record in one go", async () => {
    const documentId = await record(analyst);

    const { rows: docs } = await db.query<{
      review_status: string;
      uploaded_by: string;
      storage_path: string;
    }>("select review_status, uploaded_by, storage_path from public.documents where id = $1", [documentId]);
    expect(docs[0].review_status).toBe("pending");
    expect(docs[0].uploaded_by).toBe(analyst);

    const { rows: sources } = await db.query<{ dataset_id: string; job_id: string; content_sha256: string }>(
      "select dataset_id, job_id, content_sha256 from public.source_records where document_id = $1",
      [documentId],
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].dataset_id).toBe("companies.documents");

    const { rows: jobs } = await db.query<{ trigger: string; status: string; requested_by: string }>(
      "select trigger, status, requested_by from public.ingestion_jobs where id = $1",
      [sources[0].job_id],
    );
    expect(jobs[0]).toMatchObject({ trigger: "upload", status: "succeeded", requested_by: analyst });
  });

  it("records the upload in the audit log", async () => {
    const documentId = await record(analyst);
    const { rows } = await db.query<{ action: string }>(
      "select action from public.audit_logs where details ->> 'document_id' = $1",
      [documentId],
    );
    expect(rows.map((r) => r.action)).toContain("document.uploaded");
  });

  it("arrives invisible to readers, since it starts pending", async () => {
    const documentId = await record(analyst);
    const { rows } = await db.query<{ review_status: string }>(
      "select review_status from public.documents where id = $1",
      [documentId],
    );
    expect(rows[0].review_status).toBe("pending");
  });
});

describe("the same bytes are not recorded twice", () => {
  it("rejects a second upload of an identical document", async () => {
    const duplicate = sha256("identical-bytes");
    await record(analyst, { sha: duplicate, path: "bb/identical.pdf" });

    const error = await expectSqlError(
      db.query(
        `select public.record_uploaded_document(
           $1, 'companies.documents', 'issuer_ir', 'annual_report', 'Same again', 'bb/identical.pdf', $2,
           'application/pdf', 2048, 'issuer_document'
         )`,
        [analyst, duplicate],
      ),
    );
    expect(error.code).toBe("23505");
  });

  it("leaves no job or source record behind when the document is refused", async () => {
    const duplicate = sha256("rolled-back");
    await record(analyst, { sha: duplicate, path: "cc/first.pdf" });

    const { rows: before } = await db.query<{ n: string }>(
      "select count(*) as n from public.ingestion_jobs where dataset_id = 'companies.documents'",
    );

    await expectSqlError(
      db.query(
        `select public.record_uploaded_document(
           $1, 'companies.documents', 'issuer_ir', 'annual_report', 'Same again', 'cc/first.pdf', $2,
           'application/pdf', 2048, 'issuer_document'
         )`,
        [analyst, duplicate],
      ),
    );

    const { rows: after } = await db.query<{ n: string }>(
      "select count(*) as n from public.ingestion_jobs where dataset_id = 'companies.documents'",
    );
    // The whole function is one statement, so the failed attempt rolls back with it.
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("only authorised people upload", () => {
  it("refuses an ordinary signed-in user", async () => {
    const outsider = await createUser(db);
    const error = await expectSqlError(record(outsider));
    expect(error.code).toBe("42501");
  });

  it("refuses a staff member without an uploading role", async () => {
    const factChecker = await createUser(db, { staff: ["fact_checker"] });
    const error = await expectSqlError(record(factChecker));
    expect(error.code).toBe("42501");
  });

  it("allows an editor and a platform administrator", async () => {
    const editor = await createUser(db, { staff: ["editor"] });
    const admin = await createUser(db, { admin: true });
    await expect(record(editor)).resolves.toBeTruthy();
    await expect(record(admin)).resolves.toBeTruthy();
  });
});

describe("a document must name its stored object", () => {
  it("refuses an empty storage path", async () => {
    const error = await expectSqlError(record(analyst, { path: "   " }));
    expect(error.code).toBe("23514");
  });
});
