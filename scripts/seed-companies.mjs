#!/usr/bin/env node
// Seed the company register from a list, for the pilot.
//
//   node scripts/seed-companies.mjs path/to/companies.json [--approve]
//
// The file is a JSON array. Only `name` is required; a web address is derived
// from the name when none is given, and a listed company must carry its NGX
// symbol because a reader could not otherwise reach it.
//
//   [
//     {
//       "name": "Example Cement Plc",
//       "slug": "example-cement",
//       "ngxSymbol": "EXCEM",
//       "sectorId": "industrial_goods",
//       "industry": "Cement",
//       "listingStatus": "listed",
//       "listingBoard": "Main Board",
//       "website": "https://www.example.com",
//       "description": "What the business does."
//     }
//   ]
//
// Writes go through upsert_company_profile, so every company created here gets
// its version-1 history row and its audit entry exactly as one typed into the
// desk would. Re-running is safe: a company whose address already exists is
// reported as present and left alone rather than edited, because an edit needs a
// reason and "seeding" is not one.
//
// Without --approve the companies are left pending, which is the honest default:
// somebody should read a profile before readers see it. With it, the seeding
// analyst approves their own entries and each row is flagged self-approved, the
// same as any other self-review on this platform.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

function envValue(name) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  return line ? line.trim().slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

const [, , listPath, ...flags] = process.argv;
const approve = flags.includes("--approve");

if (!listPath) {
  console.error("Usage: node scripts/seed-companies.mjs <companies.json> [--approve]");
  process.exit(2);
}

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const key = envValue("SUPABASE_SECRET_KEY");
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(2);
}

let companies;
try {
  companies = JSON.parse(readFileSync(listPath, "utf8"));
} catch (error) {
  console.error(`Could not read ${listPath}: ${error.message}`);
  process.exit(2);
}
if (!Array.isArray(companies)) {
  console.error("The file must hold a JSON array of companies.");
  process.exit(2);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

// Act as a real analyst, so the history and the audit trail name a person
// rather than an anonymous process.
const { data: staff, error: staffError } = await admin
  .from("platform_staff")
  .select("user_id")
  .eq("role", "analyst")
  .limit(1);

if (staffError || !staff?.length) {
  console.error(`No analyst to act as: ${staffError?.message ?? "none found"}`);
  console.error("Grant someone the analyst role on the admin user page first.");
  process.exit(1);
}
const analyst = staff[0].user_id;

const { data: existing } = await admin.from("companies").select("id, slug, name");
const bySlug = new Map((existing ?? []).map((c) => [c.slug, c]));

let created = 0;
let skipped = 0;
let failed = 0;

for (const entry of companies) {
  const name = (entry.name ?? "").trim();
  if (!name) {
    console.log("  skip  (an entry with no name)");
    failed += 1;
    continue;
  }

  const slug =
    (entry.slug ?? "").trim() ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  if (bySlug.has(slug)) {
    console.log(`  have  ${name} (/companies/${slug})`);
    skipped += 1;
    continue;
  }

  const { data: id, error } = await admin.rpc("upsert_company_profile", {
    actor_user: analyst,
    p_name: name,
    p_slug: slug,
    p_listing_status: entry.listingStatus ?? "listed",
    p_legal_name: entry.legalName ?? null,
    p_sector_id: entry.sectorId ?? null,
    p_industry: entry.industry ?? null,
    p_description: entry.description ?? null,
    p_website: entry.website ?? null,
    p_listing_board: entry.listingBoard ?? null,
    p_ngx_symbol: entry.ngxSymbol ?? null,
  });

  if (error) {
    console.log(`  FAIL  ${name} — ${error.message}`);
    failed += 1;
    continue;
  }

  if (approve) {
    const { error: reviewError } = await admin.rpc("review_company", {
      target_company: id,
      actor_user: analyst,
      p_decision: "approved",
    });
    if (reviewError) {
      console.log(`  part  ${name} created but not approved — ${reviewError.message}`);
      created += 1;
      continue;
    }
  }

  console.log(`  ok    ${name}${entry.ngxSymbol ? ` (${entry.ngxSymbol})` : ""} → /companies/${slug}`);
  created += 1;
}

console.log(`\n${created} created, ${skipped} already present, ${failed} failed.`);
if (!approve && created > 0) {
  console.log("They are pending review. Approve them on /admin/companies, or re-run with --approve.");
}
if (approve && created > 0) {
  console.log("Approved by the seeding analyst, so each is flagged self-approved in the desk.");
}
process.exit(failed > 0 ? 1 : 0);
