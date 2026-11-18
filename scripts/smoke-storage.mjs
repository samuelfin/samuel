#!/usr/bin/env node
/**
 * Storage smoke test: upload -> review -> signed URL -> fetch -> wrong user denied.
 *
 * The unit suite runs on PGlite, which has no storage layer, so the real round
 * trip through Supabase Storage is never exercised there. This script does it
 * against a live project.
 *
 * NOT FOR PRODUCTION. Two things stand in the way of running it there:
 *
 *   1. It reads its own environment variables (SFI_SMOKE_*), not the application's
 *      NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY. A stray .env.local holding
 *      production credentials cannot feed this script by accident.
 *   2. It refuses a non-local host unless SFI_SMOKE_ALLOW_REMOTE=1 is set, and
 *      refuses to run at all when NODE_ENV is production.
 *
 * It still leaves marks. The documents, ingestion_jobs, source_records,
 * document_review_events and audit_logs rows it creates CANNOT be deleted — the
 * forbid_delete trigger is deliberate, because a document is evidence. Rows are
 * titled "SMOKE TEST" so they are easy to recognise. Use a throwaway project.
 *
 * Usage: see docs/DEPLOYMENT_SMOKE_TEST.md
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

const BUCKET = "source-documents";
const DATASET = "companies.documents";

const url = process.env.SFI_SMOKE_SUPABASE_URL;
const publishableKey = process.env.SFI_SMOKE_PUBLISHABLE_KEY;
const secretKey = process.env.SFI_SMOKE_SECRET_KEY;
const allowRemote = process.env.SFI_SMOKE_ALLOW_REMOTE === "1";

let passed = 0;
let failed = 0;
const cleanup = [];

function pass(name, detail = "") {
  passed += 1;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, detail) {
  failed += 1;
  console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function check(name, condition, detail = "") {
  if (condition) pass(name, detail);
  else fail(name, detail || "condition not met");
}

function section(title) {
  console.log(`\n${title}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A tiny but structurally valid single-page PDF, so viewers treat it as real. */
function makePdf(marker) {
  const body = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >> endobj
4 0 obj << /Length 60 >> stream
BT /F1 10 Tf 20 100 Td (SMOKE TEST ${marker}) Tj ET
endstream endobj
trailer << /Root 1 0 R >>
%%EOF`;
  // Pad so range requests have something to slice.
  return Buffer.concat([Buffer.from(body, "utf8"), Buffer.alloc(40_000, 0x20)]);
}

function preflight() {
  const missing = [];
  if (!url) missing.push("SFI_SMOKE_SUPABASE_URL");
  if (!publishableKey) missing.push("SFI_SMOKE_PUBLISHABLE_KEY");
  if (!secretKey) missing.push("SFI_SMOKE_SECRET_KEY");
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    console.error("See docs/DEPLOYMENT_SMOKE_TEST.md for how to run this.");
    process.exit(2);
  }

  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run with NODE_ENV=production.");
    process.exit(2);
  }

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    console.error(`SFI_SMOKE_SUPABASE_URL is not a URL: ${url}`);
    process.exit(2);
  }

  const isLocal = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(host) || host.endsWith(".local");
  if (!isLocal && !allowRemote) {
    console.error(`Refusing to touch a non-local host (${host}) without SFI_SMOKE_ALLOW_REMOTE=1.`);
    console.error("Only point this at a local or disposable development project.");
    process.exit(2);
  }

  console.log("Samuel Terminal — storage smoke test");
  console.log(`  target        ${host}${isLocal ? " (local)" : " (REMOTE — allowed explicitly)"}`);
  console.log(`  bucket        ${BUCKET}`);
  console.log("  rows created  documents / ingestion_jobs / source_records / review events");
  console.log("                cannot be deleted afterwards, by design\n");
}

async function main() {
  preflight();

  const admin = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const marker = randomUUID().slice(0, 8);
  const password = `Smoke-${randomUUID()}`;

  // --- 1. the bucket -------------------------------------------------------
  section("1. Bucket");
  const { data: bucket, error: bucketError } = await admin.storage.getBucket(BUCKET);
  if (bucketError || !bucket) {
    fail("bucket exists", bucketError?.message ?? "not found");
    console.error("\nApply the migrations first; 202611180001 creates the bucket.");
    return;
  }
  pass("bucket exists");
  check("bucket is private", bucket.public === false, `public=${bucket.public}`);

  // --- 2. people -----------------------------------------------------------
  section("2. Users");
  const analystEmail = `smoke-analyst-${marker}@example.test`;
  const readerEmail = `smoke-reader-${marker}@example.test`;

  const { data: analystUser, error: analystError } = await admin.auth.admin.createUser({
    email: analystEmail,
    password,
    email_confirm: true,
  });
  if (analystError || !analystUser?.user) {
    fail("create analyst", analystError?.message);
    return;
  }
  const analystId = analystUser.user.id;
  cleanup.push(() => admin.auth.admin.deleteUser(analystId));
  pass("create analyst");

  const { data: readerUser, error: readerError } = await admin.auth.admin.createUser({
    email: readerEmail,
    password,
    email_confirm: true,
  });
  if (readerError || !readerUser?.user) {
    fail("create reader", readerError?.message);
    return;
  }
  const readerId = readerUser.user.id;
  cleanup.push(() => admin.auth.admin.deleteUser(readerId));
  pass("create reader");

  const { error: roleError } = await admin
    .from("platform_staff")
    .insert({ user_id: analystId, role: "analyst", granted_by: analystId });
  check("grant analyst role", !roleError, roleError?.message);

  // --- 3. upload -----------------------------------------------------------
  section("3. Upload");
  const bytes = makePdf(marker);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `${sha256.slice(0, 2)}/${sha256}.pdf`;

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  check("store the object", !uploadError, uploadError?.message);
  cleanup.push(() => admin.storage.from(BUCKET).remove([storagePath]));

  const { data: documentId, error: recordError } = await admin.rpc("record_uploaded_document", {
    actor_user: analystId,
    p_dataset_id: DATASET,
    p_provider_id: "issuer_ir",
    p_kind: "annual_report",
    p_title: `SMOKE TEST ${marker} — safe to ignore`,
    p_storage_path: storagePath,
    p_sha256: sha256,
    p_mime_type: "application/pdf",
    p_size_bytes: bytes.byteLength,
    p_licence_class: "issuer_document",
  });
  if (recordError || !documentId) {
    fail("record the document", recordError?.message);
    return;
  }
  pass("record the document", documentId);

  const { data: provenance } = await admin
    .from("source_records")
    .select("id, job_id, content_sha256")
    .eq("document_id", documentId);
  check("source record written", provenance?.length === 1);
  check("checksum matches the bytes", provenance?.[0]?.content_sha256 === sha256);
  check("ingestion job linked", Boolean(provenance?.[0]?.job_id));

  // --- 4. invisible until reviewed ----------------------------------------
  section("4. Pending work is invisible to readers");
  const readerClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { error: signInError } = await readerClient.auth.signInWithPassword({
    email: readerEmail,
    password,
  });
  check("reader signs in", !signInError, signInError?.message);

  const beforeApproval = await readerClient.from("documents").select("id").eq("id", documentId);
  check("reader cannot see it while pending", (beforeApproval.data ?? []).length === 0);

  // --- 5. review -----------------------------------------------------------
  section("5. Review");
  const { error: reviewError } = await admin.rpc("review_document", {
    target_document: documentId,
    actor_user: analystId,
    new_status: "approved",
    reason: null,
  });
  check("approve it", !reviewError, reviewError?.message);

  const { data: events } = await admin
    .from("document_review_events")
    .select("to_status, self_approved")
    .eq("document_id", documentId);
  check("review event recorded", events?.length === 1);
  check(
    "self-approval flagged (the uploader approved it)",
    events?.[0]?.self_approved === true,
    `self_approved=${events?.[0]?.self_approved}`,
  );

  const afterApproval = await readerClient.from("documents").select("id").eq("id", documentId);
  check("reader can see it once approved", (afterApproval.data ?? []).length === 1);

  // --- 6. signed URL ------------------------------------------------------
  section("6. Signed URL");
  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 600);
  check("mint a signed URL", !signError && Boolean(signed?.signedUrl), signError?.message);

  if (signed?.signedUrl) {
    const response = await fetch(signed.signedUrl);
    check("fetch returns 200", response.status === 200, `status=${response.status}`);
    const fetched = Buffer.from(await response.arrayBuffer());
    const fetchedSha = createHash("sha256").update(fetched).digest("hex");
    check("fetched bytes match the checksum", fetchedSha === sha256);

    // This is why the TTL is 600s: browser PDF viewers stream with ranges and
    // keep requesting while the reader scrolls.
    const ranged = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-99" } });
    check(
      "range request is honoured",
      ranged.status === 206,
      `status=${ranged.status}${ranged.status === 200 ? " (whole file returned instead)" : ""}`,
    );
    if (ranged.status === 206) {
      const slice = Buffer.from(await ranged.arrayBuffer());
      check("range returns the requested length", slice.byteLength === 100, `${slice.byteLength} bytes`);
    }
  }

  // --- 7. the bucket is closed to clients ---------------------------------
  section("7. Direct access is denied");
  const direct = await readerClient.storage.from(BUCKET).download(storagePath);
  check("reader cannot download the object directly", Boolean(direct.error), direct.error?.message ?? "it succeeded");

  const readerSigned = await readerClient.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  check(
    "reader cannot mint their own signed URL",
    Boolean(readerSigned.error) || !readerSigned.data?.signedUrl,
    readerSigned.error?.message ?? "it succeeded",
  );

  const listed = await readerClient.storage.from(BUCKET).list();
  check(
    "reader cannot list the bucket",
    Boolean(listed.error) || (listed.data ?? []).length === 0,
    listed.error?.message ?? `${(listed.data ?? []).length} entries returned`,
  );

  // --- 8. expiry ----------------------------------------------------------
  section("8. Expiry");
  const { data: brief } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, 1);
  if (brief?.signedUrl) {
    const fresh = await fetch(brief.signedUrl);
    check("a one-second link works immediately", fresh.status === 200, `status=${fresh.status}`);
    await sleep(2500);
    const stale = await fetch(brief.signedUrl);
    check("the same link is refused once expired", stale.status >= 400, `status=${stale.status}`);
  } else {
    fail("mint a one-second link");
  }

  console.log(`\nDocument left behind: ${documentId}`);
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error(`\nUnexpected error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // Best effort. Users and the stored object go; the rows cannot.
  for (const undo of cleanup.reverse()) {
    try {
      await undo();
    } catch {
      /* residue is reported below; not worth failing the run over */
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(
    failed === 0
      ? 'Storage round trip works. Rows titled "SMOKE TEST" remain and cannot be deleted.'
      : "Storage round trip FAILED. Fix before deploying.",
  );
  process.exit(failed === 0 ? 0 : 1);
}
