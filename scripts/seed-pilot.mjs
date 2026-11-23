#!/usr/bin/env node
// Seed the pilot universe: the 18 companies, their tickers, sectors and the
// statement template each is entered under. No figures.
//
//   node scripts/seed-pilot.mjs            # say what it would do, and change nothing
//   node scripts/seed-pilot.mjs --confirm  # write it
//
// It refuses to write without --confirm, because the pilot list is the identity
// five years of figures will hang off and the CEO signs it off before it lands.
// A dry run prints every company and template exactly as it would be written.
//
// What it writes, and what it does not. Companies go through
// upsert_company_profile, so each gets its version-1 history row and its audit
// entry exactly as one typed into the desk would, and the template assignment
// goes through assign_company_template. It writes no statements and no figures
// at all: a company with nothing verified reads "Pending verification", and
// seeding a plausible-looking number would be the one thing this platform must
// never do.
//
// Companies are left pending review by default. Somebody should read a profile
// before readers see it, and "the seed script wrote it" is not a review.
//
// Re-running is safe. A company whose address already exists is reported as
// present and left alone rather than edited, because an edit needs a reason and
// "seeding" is not one. A template already assigned is reported and skipped.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");

const PILOT = "scripts/pilot-companies.json";

function envValue(name) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${name}=`));
  return line ? line.trim().slice(name.length + 1).trim().replace(/^["']|["']$/g, "") : "";
}

/** Lowercase words joined by single hyphens, as upsert_company_profile derives it. */
function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const confirm = process.argv.includes("--confirm");
const approve = process.argv.includes("--approve");
const pilot = JSON.parse(readFileSync(PILOT, "utf8"));
const companies = pilot.companies;

// The earliest period the pilot covers, so a template assignment is in force for
// every year that will be entered. FY2021 means a reporting date in 2021, and a
// company with a March year-end reports for a period starting in 2020.
const TEMPLATE_FROM = "2020-01-01";

console.log("");
console.log(`Pilot universe — ${companies.length} companies, ${pilot.period.from} to ${pilot.period.to}`);
console.log(confirm ? "Writing." : "Dry run. Nothing will be written.");
console.log("");

if (!confirm) {
  for (const company of companies) {
    const changed = company.priorTicker && company.priorTicker !== company.ticker;
    console.log(
      `  ${company.ticker.padEnd(12)} ${company.name}` +
        `  [${company.sectorId} · ${company.template}]` +
        (changed ? `  (was ${company.priorName ?? company.name} / ${company.priorTicker})` : ""),
    );
  }
  console.log("");
  console.log("No figures are seeded, now or with --confirm.");
  console.log("Run `npm run verify:ngx` first, and `npm run seed:pilot -- --confirm` once it is signed off.");
  process.exit(0);
}

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const secret = envValue("SUPABASE_SECRET_KEY");
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(2);
}
const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

// The actor every row is attributed to. Read from platform_admins rather than
// passed in, so a seeded row carries a real person's id in its audit entry and
// its version history.
const { data: admins, error: adminError } = await admin
  .from("platform_admins")
  .select("user_id")
  .order("granted_at")
  .limit(1);
if (adminError || !admins || admins.length === 0) {
  console.error(`Could not find a platform administrator to attribute this to: ${adminError?.message ?? "none"}`);
  process.exit(2);
}
const actor = admins[0].user_id;

let created = 0;
let present = 0;
let assigned = 0;
let failed = 0;

for (const company of companies) {
  const slug = slugify(company.name);
  const { data: existing, error: lookupError } = await admin
    .from("companies")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (lookupError) {
    console.log(`  FAIL     ${company.ticker}: ${lookupError.message}`);
    failed += 1;
    continue;
  }

  let companyId = existing?.id ?? null;

  if (companyId) {
    console.log(`  present  ${company.ticker.padEnd(12)} ${existing.name} (left alone)`);
    present += 1;
  } else {
    const { data: newId, error } = await admin.rpc("upsert_company_profile", {
      actor_user: actor,
      p_name: company.name,
      p_slug: slug,
      p_listing_status: company.listingStatus ?? "listed",
      p_legal_name: null,
      p_sector_id: company.sectorId ?? null,
      p_industry: null,
      p_description: null,
      p_website: null,
      p_listing_board: null,
      p_change_reason: null,
      p_ngx_symbol: company.ticker,
      p_company_id: null,
    });
    if (error) {
      console.log(`  FAIL     ${company.ticker}: ${error.message}`);
      failed += 1;
      continue;
    }
    companyId = newId;
    created += 1;
    console.log(`  created  ${company.ticker.padEnd(12)} ${company.name}`);

    if (approve) {
      const { error: reviewError } = await admin.rpc("review_company", {
        target_company: companyId,
        actor_user: actor,
        p_decision: "approved",
      });
      if (reviewError) console.log(`           review failed: ${reviewError.message}`);
    }
  }

  const { data: assignment, error: assignmentLookup } = await admin
    .from("company_statement_templates")
    .select("template_id")
    .eq("company_id", companyId)
    .is("valid_to", null)
    .maybeSingle();
  if (assignmentLookup) {
    console.log(`           template lookup failed: ${assignmentLookup.message}`);
    failed += 1;
    continue;
  }

  if (assignment) {
    if (assignment.template_id !== company.template) {
      console.log(
        `           template is ${assignment.template_id}, the list says ${company.template} — left alone, change it on the desk`,
      );
    }
    continue;
  }

  const { error: assignError } = await admin.rpc("assign_company_template", {
    actor_user: actor,
    p_company_id: companyId,
    p_template_id: company.template,
    p_valid_from: TEMPLATE_FROM,
    p_note: "Pilot universe seed",
  });
  if (assignError) {
    console.log(`           template ${company.template} failed: ${assignError.message}`);
    failed += 1;
    continue;
  }
  assigned += 1;
  console.log(`           template ${company.template} from ${TEMPLATE_FROM}`);
}

console.log("");
console.log(`${created} created, ${present} already present, ${assigned} templates assigned, ${failed} failed.`);
console.log('No figures were written. Every company reads "Pending verification" until a year is entered and checked.');
if (!approve) {
  console.log("Companies are pending review: somebody should read each profile before readers see it.");
}
process.exit(failed === 0 ? 0 : 1);
