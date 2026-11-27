#!/usr/bin/env node
// Bulk-source real issuer filings into the document desk's review queue.
//
//   node scripts/source-documents.mjs scripts/pilot-documents.json [--confirm]
//
// This automates the *first* ingestion stage ARCHITECTURE_AND_DATA_MODEL.md
// describes — "manual document upload with analyst review" — it does not add
// the second stage (a standing collector that detects and classifies on its
// own schedule). The difference that matters: this script runs once, against
// a list a person curated, and every document it writes lands exactly where a
// human clicking "Upload" in the document desk would leave it — `pending`,
// invisible to readers, provider_id fixed to issuer_ir, nothing approved.
// Nothing here writes an approved row. That stays a human decision in
// /admin/documents, same as every other document.
//
// The manifest is a JSON array:
//
//   [
//     {
//       "company": "Guaranty Trust Holding Company Plc",
//       "title": "GTCO FY2024 Annual Report",
//       "kind": "annual_report",
//       "url": "https://gtco-plc.files.svdcdn.com/.../GTCO-FY-2024-Annual-Report.pdf",
//       "publishedAt": "2025-03-31",
//       "periodEnd": "2024-12-31"
//     }
//   ]
//
// `company` is matched against companies.name case-insensitively; the entry is
// skipped with an error if there is no exact match, rather than guessing. Every
// document is recorded under provider_id 'issuer_ir' / dataset 'companies.documents'
// and licence_class 'issuer_document' — the same fixed values the desk's own
// upload form uses, so a batch run cannot attribute a filing to a licensed feed
// it never touched. `kind` must be one of DOCUMENT_KINDS in
// lib/documents/validation.ts (annual_report, interim_report,
// financial_statements, presentation, announcement, regulatory_filing,
// statistical_release, auction_result, circular, other).
//
// Without --confirm this only fetches, hashes and reports what it would do —
// no storage upload, no database write — matching seed:pilot's own default.
// With --confirm it uploads to the source-documents bucket and calls
// record_uploaded_document, the same RPC the manual upload action calls.
//
// Re-running is safe: documents.sha256 and source_records(dataset_id,
// content_sha256) are both unique, so the same bytes fetched twice are
// reported as already in the library rather than duplicated.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const DOCUMENT_BUCKET = "source-documents";
const MAX_DOCUMENT_BYTES = 52_428_800;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const EXTENSION_BY_MIME = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};
const DOCUMENT_KINDS = new Set([
  "annual_report",
  "interim_report",
  "financial_statements",
  "presentation",
  "announcement",
  "regulatory_filing",
  "statistical_release",
  "auction_result",
  "circular",
  "other",
]);

// Fixed, like app/admin/documents/actions.ts: a batch run cannot choose a
// provider any more than a person filling in the upload form can.
const PROVIDER_ID = "issuer_ir";
const DATASET_ID = "companies.documents";
const LICENCE_CLASS = "issuer_document";

function envValue(name) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  return line ? line.trim().slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const [, , manifestPath, ...flags] = process.argv;
const confirm = flags.includes("--confirm");

if (!manifestPath) {
  console.error("Usage: node scripts/source-documents.mjs <manifest.json> [--confirm]");
  process.exit(2);
}

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const key = envValue("SUPABASE_SECRET_KEY");
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`Could not read ${manifestPath}: ${error.message}`);
  process.exit(2);
}
if (!Array.isArray(manifest)) {
  console.error("The manifest must be a JSON array of document entries.");
  process.exit(2);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

// Act as a real person — record_uploaded_document accepts a platform admin or
// an analyst/editor and rejects anyone else, and the audit log should name a
// person, not an anonymous process. `--as <user id>` names the person who asked
// for this run; without it, the first analyst (then editor) is used.
const asIndex = flags.indexOf("--as");
const requestedActor = asIndex >= 0 ? flags[asIndex + 1] : null;
if (asIndex >= 0 && !/^[0-9a-f-]{36}$/i.test(requestedActor ?? "")) {
  console.error("--as takes the user id of the person running this import.");
  process.exit(2);
}

const { data: staff, error: staffError } = await admin
  .from("platform_staff")
  .select("user_id, role")
  .in("role", ["analyst", "editor"]);
if (staffError) {
  console.error(`Could not read staff roles: ${staffError.message}`);
  process.exit(1);
}

let actor;
if (requestedActor) {
  const { data: admins, error: adminError } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", requestedActor);
  if (adminError) {
    console.error(`Could not read platform admins: ${adminError.message}`);
    process.exit(1);
  }
  if (!admins?.length && !staff.some((s) => s.user_id === requestedActor)) {
    console.error("--as must name a platform admin, analyst or editor.");
    process.exit(1);
  }
  actor = requestedActor;
} else {
  if (!staff.length) {
    console.error("No analyst or editor to act as: none found");
    console.error("Grant someone that role, or pass --as <platform admin user id>.");
    process.exit(1);
  }
  actor = staff.find((s) => s.role === "analyst")?.user_id ?? staff[0].user_id;
}

const { data: companies, error: companiesError } = await admin.from("companies").select("id, name");
if (companiesError) {
  console.error(`Could not read the company register: ${companiesError.message}`);
  process.exit(1);
}
const byName = new Map((companies ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

function storagePathFor(sha256, mimeType) {
  return `${sha256.slice(0, 2)}/${sha256}.${EXTENSION_BY_MIME[mimeType]}`;
}

let sourced = 0;
let duplicate = 0;
let failed = 0;

for (const entry of manifest) {
  const label = entry.title ?? entry.url ?? "(unnamed entry)";

  if (!entry.company || !entry.title || !entry.kind || !entry.url) {
    console.log(`  FAIL  ${label} — needs company, title, kind and url`);
    failed += 1;
    continue;
  }
  if (!DOCUMENT_KINDS.has(entry.kind)) {
    console.log(`  FAIL  ${label} — "${entry.kind}" is not a recognised document kind`);
    failed += 1;
    continue;
  }
  const companyId = byName.get(entry.company.trim().toLowerCase());
  if (!companyId) {
    console.log(`  FAIL  ${label} — "${entry.company}" is not on the company register yet`);
    console.log("        Run verify:ngx and seed:pilot --confirm first.");
    failed += 1;
    continue;
  }

  let response;
  try {
    response = await fetch(entry.url, {
      redirect: "follow",
      headers: {
        // Several IR sites reject the default Node fetch UA outright.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/pdf,*/*",
      },
    });
  } catch (error) {
    console.log(`  FAIL  ${label} — could not reach ${entry.url} (${error.message})`);
    failed += 1;
    continue;
  }
  if (!response.ok) {
    console.log(`  FAIL  ${label} — ${entry.url} returned ${response.status}`);
    failed += 1;
    continue;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    console.log(`  FAIL  ${label} — the file was empty`);
    failed += 1;
    continue;
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    console.log(`  FAIL  ${label} — ${(bytes.length / 1_048_576).toFixed(1)} MB is over the 50 MB limit`);
    failed += 1;
    continue;
  }

  // Trust the bytes, not the server's Content-Type header — but still require
  // it to be a type the bucket and the database will accept.
  const reportedType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const mimeType = ALLOWED_MIME_TYPES.has(reportedType) ? reportedType : "application/pdf";
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    console.log(`  FAIL  ${label} — "${reportedType}" is not a kind of file this desk accepts`);
    failed += 1;
    continue;
  }
  // A PDF starts with "%PDF-"; this catches the common failure where an IR
  // link serves an HTML landing page instead of the actual file.
  if (mimeType === "application/pdf" && bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    console.log(`  FAIL  ${label} — the URL did not return an actual PDF (check the link by hand)`);
    failed += 1;
    continue;
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storagePath = storagePathFor(sha256, mimeType);

  if (!confirm) {
    console.log(`  would-source  ${label} → ${entry.company} (${(bytes.length / 1_048_576).toFixed(1)} MB, ${sha256.slice(0, 12)}…)`);
    sourced += 1;
    continue;
  }

  const { error: storageError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  const alreadyStored = storageError !== null && /exists|duplicate|409/i.test(storageError.message ?? "");
  if (storageError && !alreadyStored) {
    console.log(`  FAIL  ${label} — could not store the file (${storageError.message})`);
    failed += 1;
    continue;
  }

  const { error } = await admin.rpc("record_uploaded_document", {
    actor_user: actor,
    p_dataset_id: DATASET_ID,
    p_provider_id: PROVIDER_ID,
    p_kind: entry.kind,
    p_title: entry.title.trim(),
    p_storage_path: storagePath,
    p_sha256: sha256,
    p_mime_type: mimeType,
    p_size_bytes: bytes.length,
    p_licence_class: LICENCE_CLASS,
    p_company_id: companyId,
    p_source_uri: entry.url,
    p_published_at: entry.publishedAt ?? null,
    p_period_end: entry.periodEnd ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      console.log(`  have  ${label} — already in the library`);
      duplicate += 1;
      continue;
    }
    if (!alreadyStored) await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    console.log(`  FAIL  ${label} — ${error.message}`);
    failed += 1;
    continue;
  }

  console.log(`  ok    ${label} → ${entry.company}, pending review`);
  sourced += 1;
}

console.log(`\n${sourced} ${confirm ? "sourced" : "would be sourced"}, ${duplicate} already present, ${failed} failed.`);
if (!confirm && sourced > 0) {
  console.log("Dry run only — nothing was stored or written. Re-run with --confirm to do it for real.");
}
if (confirm && sourced > 0) {
  console.log("Pending review on /admin/documents — nothing is visible to readers yet.");
}
process.exit(failed > 0 ? 1 : 0);
