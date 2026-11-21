#!/usr/bin/env node
// Seed the leadership register from a list.
//
//   node scripts/seed-leadership.mjs path/to/leadership.json [--approve]
//
// The file is a JSON array of people, each with the offices they hold. A person
// needs a name; an office needs a company, an office code, a start date and a
// source. Nothing is invented: a row that cannot be resolved to a real company
// and a real approved source is reported and skipped, never guessed at.
//
//   [
//     {
//       "name": "Ada Okonkwo",
//       "slug": "ada-okonkwo",
//       "honorific": "Dr",
//       "offices": [
//         {
//           "company": "example-cement",
//           "role": "gmd_ceo",
//           "title": "Group Managing Director/CEO",
//           "acting": false,
//           "from": "2015",
//           "to": null,
//           "documentTitle": "Example Cement annual report 2015",
//           "page": 118,
//           "confirmedOn": "2026-03-31",
//           "confirmDocumentTitle": "Example Cement annual report 2025",
//           "confirmPage": 7
//         }
//       ]
//     }
//   ]
//
// "from" and "to" carry their own precision, exactly as the desk does: "2015" is
// a year, "2015-06" a month, "2015-06-12" a day. Write only what the filing
// says — turning "appointed 2015" into a day in January would fabricate a
// precision the source does not have.
//
// A source is named by its title (or headline) and must already be approved and
// citable, or given directly as "documentId" / "announcementId". A title that
// matches nothing, or matches more than one document, is an error rather than a
// best guess: this writes claims about named private individuals.
//
// Writes go through upsert_person and upsert_company_role, so every record gets
// its version-1 history row and its audit entry exactly as one typed into the
// desk would. Re-running is safe: a person whose address already exists is left
// alone, and an office that already exists for that person, company, role and
// start date is reported as present.
//
// Without --approve everything stays pending, which is the honest default:
// somebody should read a claim about a person before readers see it. With it, the
// seeding analyst approves their own entries and each row is flagged
// self-approved, the same as any other self-review here.
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
  console.error("Usage: node scripts/seed-leadership.mjs <leadership.json> [--approve]");
  process.exit(2);
}

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const key = envValue("SUPABASE_SECRET_KEY");
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(2);
}

let entries;
try {
  entries = JSON.parse(readFileSync(listPath, "utf8"));
} catch (error) {
  console.error(`Could not read ${listPath}: ${error.message}`);
  process.exit(2);
}
if (!Array.isArray(entries)) {
  console.error("The file must hold a JSON array of people.");
  process.exit(2);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

// Act as a real analyst, so the history and the audit trail name a person rather
// than an anonymous process.
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

// Reference data, read once.
const [
  { data: companies },
  { data: offices },
  { data: documents },
  { data: announcements },
  { data: people },
] = await Promise.all([
  admin.from("companies").select("id, slug, name"),
  admin.from("person_role_catalogue").select("id"),
  admin
    .from("documents")
    .select("id, title")
    .eq("review_status", "approved")
    .neq("licence_class", "unverified"),
  admin.from("announcements").select("id, headline").eq("status", "published"),
  admin.from("people").select("id, slug"),
]);

const companyBySlug = new Map((companies ?? []).map((c) => [c.slug, c]));
const officeCodes = new Set((offices ?? []).map((o) => o.id));
const personBySlug = new Map((people ?? []).map((p) => [p.slug, p.id]));

/** Titles are not unique, so an ambiguous match is an error, not a guess. */
function resolveByTitle(rows, field, wanted) {
  const needle = String(wanted).trim();
  const matches = (rows ?? []).filter((row) => row[field].trim() === needle);
  if (matches.length === 1) return { id: matches[0].id };
  if (matches.length === 0) return { error: `nothing approved is titled "${needle}"` };
  return { error: `"${needle}" matches ${matches.length} records; give the id instead` };
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const TENURE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/** Values are trimmed into a cleaned value, and the cleaned value is sent. */
function text(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The shape the desk derives, repeated here because this bypasses the form. */
function tenure(raw, label) {
  const value = text(raw);
  if (!value) return { error: `${label} is required` };
  if (!TENURE.test(value)) return { error: `${label} must be 2015, 2015-06 or 2015-06-12` };
  const [y, m, d] = value.split("-");
  if (Number(y) < 1800 || Number(y) > 2100) return { error: `${label} is not a plausible year` };
  if (m !== undefined && (Number(m) < 1 || Number(m) > 12)) return { error: `${label} has no such month` };
  if (d === undefined) {
    return m === undefined
      ? { date: `${y}-01-01`, precision: "year" }
      : { date: `${y}-${m}-01`, precision: "month" };
  }
  const parsed = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== Number(y) ||
    parsed.getUTCMonth() + 1 !== Number(m) ||
    parsed.getUTCDate() !== Number(d)
  ) {
    return { error: `${label} is not a date the calendar has` };
  }
  return { date: `${y}-${m}-${d}`, precision: "day" };
}

let createdPeople = 0;
let createdOffices = 0;
let skipped = 0;
let failed = 0;

for (const raw of entries) {
  const name = text(raw?.name);
  if (!name) {
    console.log("  skip  (an entry with no name)");
    failed += 1;
    continue;
  }
  if (CONTROL.test(name)) {
    console.log(`  FAIL  ${name} — the name contains a line break or control character`);
    failed += 1;
    continue;
  }

  const slug =
    text(raw.slug) ??
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  let personId = personBySlug.get(slug);
  if (personId) {
    console.log(`  have  ${name} (/people/${slug})`);
    skipped += 1;
  } else {
    const { data: id, error } = await admin.rpc("upsert_person", {
      actor_user: analyst,
      p_full_name: name,
      p_person_id: null,
      p_slug: slug,
      p_honorific: text(raw.honorific),
      p_change_reason: null,
    });
    if (error) {
      console.log(`  FAIL  ${name} — ${error.message}`);
      failed += 1;
      continue;
    }
    personId = id;
    personBySlug.set(slug, id);
    createdPeople += 1;
    console.log(`  ok    ${name} → /people/${slug}`);

    if (approve) {
      const { error: reviewError } = await admin.rpc("review_person", {
        target_person: personId,
        actor_user: analyst,
        p_decision: "approved",
        p_reason: null,
      });
      if (reviewError) console.log(`  part  ${name} created but not approved — ${reviewError.message}`);
    }
  }

  for (const office of raw.offices ?? []) {
    const company = companyBySlug.get(text(office.company) ?? "");
    if (!company) {
      console.log(`  FAIL  ${name}: no company at /companies/${office.company}`);
      failed += 1;
      continue;
    }
    const roleCode = text(office.role);
    if (!roleCode || !officeCodes.has(roleCode)) {
      console.log(`  FAIL  ${name} at ${company.name}: "${office.role}" is not an office code`);
      failed += 1;
      continue;
    }

    const from = tenure(office.from, "from");
    if (from.error) {
      console.log(`  FAIL  ${name} at ${company.name}: ${from.error}`);
      failed += 1;
      continue;
    }
    let to = { date: null, precision: null };
    if (text(office.to)) {
      to = tenure(office.to, "to");
      if (to.error) {
        console.log(`  FAIL  ${name} at ${company.name}: ${to.error}`);
        failed += 1;
        continue;
      }
      if (to.date < from.date) {
        console.log(`  FAIL  ${name} at ${company.name}: the office cannot end before it began`);
        failed += 1;
        continue;
      }
    }

    // Exactly one source, resolved to something already approved.
    let documentId = text(office.documentId);
    let announcementId = text(office.announcementId);
    if (!documentId && text(office.documentTitle)) {
      const found = resolveByTitle(documents, "title", office.documentTitle);
      if (found.error) {
        console.log(`  FAIL  ${name} at ${company.name}: ${found.error}`);
        failed += 1;
        continue;
      }
      documentId = found.id;
    }
    if (!announcementId && text(office.announcementHeadline)) {
      const found = resolveByTitle(announcements, "headline", office.announcementHeadline);
      if (found.error) {
        console.log(`  FAIL  ${name} at ${company.name}: ${found.error}`);
        failed += 1;
        continue;
      }
      announcementId = found.id;
    }
    if (Boolean(documentId) === Boolean(announcementId)) {
      console.log(
        `  FAIL  ${name} at ${company.name}: cite either a document page or an announcement, and exactly one`,
      );
      failed += 1;
      continue;
    }
    const page = documentId ? Number(office.page) : null;
    if (documentId && (!Number.isInteger(page) || page < 1)) {
      console.log(`  FAIL  ${name} at ${company.name}: give the page the office appears on`);
      failed += 1;
      continue;
    }

    // The confirmation, if there is one, needs its own full date and source.
    let confirmedOn = null;
    let confirmDocumentId = null;
    let confirmAnnouncementId = null;
    let confirmPage = null;
    if (text(office.confirmedOn)) {
      const confirmed = tenure(office.confirmedOn, "confirmedOn");
      if (confirmed.error || confirmed.precision !== "day") {
        console.log(`  FAIL  ${name} at ${company.name}: give confirmedOn in full, as 2026-03-31`);
        failed += 1;
        continue;
      }
      confirmedOn = confirmed.date;

      confirmDocumentId = text(office.confirmDocumentId);
      confirmAnnouncementId = text(office.confirmAnnouncementId);
      if (!confirmDocumentId && text(office.confirmDocumentTitle)) {
        const found = resolveByTitle(documents, "title", office.confirmDocumentTitle);
        if (found.error) {
          console.log(`  FAIL  ${name} at ${company.name}: ${found.error}`);
          failed += 1;
          continue;
        }
        confirmDocumentId = found.id;
      }
      if (!confirmAnnouncementId && text(office.confirmAnnouncementHeadline)) {
        const found = resolveByTitle(announcements, "headline", office.confirmAnnouncementHeadline);
        if (found.error) {
          console.log(`  FAIL  ${name} at ${company.name}: ${found.error}`);
          failed += 1;
          continue;
        }
        confirmAnnouncementId = found.id;
      }
      if (Boolean(confirmDocumentId) === Boolean(confirmAnnouncementId)) {
        console.log(`  FAIL  ${name} at ${company.name}: a confirmation needs exactly one source`);
        failed += 1;
        continue;
      }
      confirmPage = confirmDocumentId ? Number(office.confirmPage) : null;
      if (confirmDocumentId && (!Number.isInteger(confirmPage) || confirmPage < 1)) {
        console.log(`  FAIL  ${name} at ${company.name}: give the confirming page`);
        failed += 1;
        continue;
      }
    }

    const { data: roleId, error } = await admin.rpc("upsert_company_role", {
      actor_user: analyst,
      p_person_id: personId,
      p_company_id: company.id,
      p_role_code: roleCode,
      p_valid_from: from.date,
      p_role_id: null,
      p_role_title: text(office.title),
      p_is_acting: office.acting === true,
      p_valid_from_precision: from.precision,
      p_valid_to: to.date,
      p_valid_to_precision: to.precision,
      p_document_id: documentId,
      p_source_page: page,
      p_announcement_id: announcementId,
      p_last_confirmed_on: confirmedOn,
      p_last_confirmed_document_id: confirmDocumentId,
      p_last_confirmed_source_page: confirmPage,
      p_last_confirmed_announcement_id: confirmAnnouncementId,
      p_change_reason: null,
    });

    if (error) {
      // A duplicate tenure is "already present", not a failure to report.
      if (error.code === "23505") {
        console.log(`  have  ${name}: ${roleCode} at ${company.name}`);
        skipped += 1;
      } else {
        console.log(`  FAIL  ${name}: ${roleCode} at ${company.name} — ${error.message}`);
        failed += 1;
      }
      continue;
    }

    createdOffices += 1;
    console.log(`  ok    ${name}: ${roleCode} at ${company.name}`);

    if (approve) {
      const { error: reviewError } = await admin.rpc("review_company_role", {
        target_role: roleId,
        actor_user: analyst,
        p_decision: "approved",
        p_reason: null,
      });
      if (reviewError) {
        console.log(`  part  ${name}: ${roleCode} recorded but not approved — ${reviewError.message}`);
      }
    }
  }
}

console.log(
  `\n${createdPeople} people and ${createdOffices} offices created, ${skipped} already present, ${failed} failed.`,
);
if (!approve && createdPeople + createdOffices > 0) {
  console.log("They are pending review. Approve them on /admin/people, or re-run with --approve.");
}
if (approve && createdPeople + createdOffices > 0) {
  console.log("Approved by the seeding analyst, so each is flagged self-approved in the desk.");
}
process.exitCode = failed > 0 ? 1 : 0;
