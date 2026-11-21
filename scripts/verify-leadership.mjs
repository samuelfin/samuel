#!/usr/bin/env node
// Verify the leadership register end to end against the real project.
//
//   node scripts/verify-leadership.mjs
//
// The test suite runs on PGlite, which applies every migration as one superuser
// and only ever switches to `authenticated`. It therefore cannot see two whole
// classes of fault: a function revoked from PUBLIC without being granted back to
// service_role, and anything PostgREST decides — an ambiguous embed, a function
// resolved by argument name. Stage 3b produced one of each. So the write path is
// exercised here through the same calls the application makes, against the same
// hosted Postgres it will run on.
//
// It writes real rows, because a verification that writes nothing cannot prove a
// write works. Three things keep that honest:
//
//   * One fixed identity, so re-running reuses it rather than accumulating.
//   * A name nobody could mistake for a real officer.
//   * An end state invisible to readers: the office is withdrawn and the person
//     is rejected. The script asserts that invisibility rather than assuming it.
//
// People and offices cannot be deleted by design — the guards refuse, because
// the register's history is the point — so "clean up" here means "leave it
// published to nobody", which is what a withdrawal and a rejection do.
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

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const secret = envValue("SUPABASE_SECRET_KEY");
const publishable = envValue("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
if (!url || !secret || !publishable) {
  console.error("Missing keys in .env.local");
  process.exit(2);
}

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(url, secret, options);

const START_SLUG = "sfi-verification-officer";
const MOVED_SLUG = "sfi-verification-officer-renamed";
const SUBJECT = "SFI Verification Subject";

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function fatal(message) {
  console.error(`\nCannot verify: ${message}`);
  process.exit(1);
}

/** Runs `fn` as a throwaway signed-in reader, then removes the account. */
async function asEphemeralReader(fn) {
  const email = `verify-leadership-${Date.now()}@example.test`;
  const password = `${Math.random().toString(36).slice(2)}Aa1!${Math.random().toString(36).slice(2)}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !created?.user) fatal(`could not create an ephemeral reader: ${error?.message}`);

  const reader = createClient(url, publishable, options);
  try {
    const { error: signInError } = await reader.auth.signInWithPassword({ email, password });
    if (signInError) fatal(`ephemeral reader could not sign in: ${signInError.message}`);
    return await fn(reader);
  } finally {
    await reader.auth.signOut();
    await admin.auth.admin.deleteUser(created.user.id);
  }
}

// --- what the register already holds -------------------------------------

const { data: staff } = await admin.from("platform_staff").select("user_id").eq("role", "analyst").limit(1);
if (!staff?.length) fatal("sfi-dev has no analyst to act as");
const analyst = staff[0].user_id;

const { data: company } = await admin
  .from("companies")
  .select("id, slug, name")
  .eq("review_status", "approved")
  .limit(1)
  .maybeSingle();
if (!company) fatal("sfi-dev has no approved company to attach an office to");

const { data: document } = await admin
  .from("documents")
  .select("id, title")
  .eq("review_status", "approved")
  .neq("licence_class", "unverified")
  .limit(1)
  .maybeSingle();
if (!document) fatal("sfi-dev has no approved, citable document to cite");

console.log(`Using company "${company.name}" and document "${document.title}".\n`);

// --- the subject, created once and reused ---------------------------------

const { data: existing } = await admin
  .from("people")
  .select("id, slug, review_status")
  .in("slug", [START_SLUG, MOVED_SLUG]);

let personId = existing?.[0]?.id ?? null;
const firstRun = !personId;

if (firstRun) {
  console.log("1. A person, an office and its evidence");
  const { data: id, error } = await admin.rpc("upsert_person", {
    actor_user: analyst,
    p_full_name: SUBJECT,
    p_person_id: null,
    p_slug: START_SLUG,
    p_honorific: "Dr",
    p_change_reason: null,
  });
  check("the person is created through upsert_person", !error && typeof id === "string", error?.message);
  if (error) fatal(error.message);
  personId = id;

  const { error: approveError } = await admin.rpc("review_person", {
    target_person: personId,
    actor_user: analyst,
    p_decision: "approved",
    p_reason: null,
  });
  check("the person is approved", !approveError, approveError?.message);

  // A year-precision appointment: the thing the schema exists to record.
  const { data: roleId, error: roleError } = await admin.rpc("upsert_company_role", {
    actor_user: analyst,
    p_person_id: personId,
    p_company_id: company.id,
    p_role_code: "gmd_ceo",
    p_valid_from: "2015-01-01",
    p_role_id: null,
    p_role_title: "Group Managing Director/CEO",
    p_is_acting: false,
    p_valid_from_precision: "year",
    p_valid_to: null,
    p_valid_to_precision: null,
    p_document_id: document.id,
    p_source_page: 118,
    p_announcement_id: null,
    p_last_confirmed_on: new Date().toISOString().slice(0, 10),
    p_last_confirmed_document_id: document.id,
    p_last_confirmed_source_page: 7,
    p_last_confirmed_announcement_id: null,
    p_change_reason: null,
  });
  check("the office is recorded with a year-precision appointment", !roleError, roleError?.message);
  if (roleError) fatal(roleError.message);

  const { data: stored } = await admin
    .from("company_roles")
    .select("valid_from, valid_from_precision, is_acting, last_confirmed_on, review_status")
    .eq("id", roleId)
    .maybeSingle();
  check(
    "the precision is stored as a year, not fabricated into a day",
    stored?.valid_from_precision === "year",
    `precision ${stored?.valid_from_precision}`,
  );
  check("it starts pending, as an unreviewed claim must", stored?.review_status === "pending");

  const { error: roleApprove } = await admin.rpc("review_company_role", {
    target_role: roleId,
    actor_user: analyst,
    p_decision: "approved",
    p_reason: null,
  });
  check("the office is approved", !roleApprove, roleApprove?.message);

  const { data: reviewed } = await admin
    .from("company_roles")
    .select("review_status, review_self_approved, reviewed_version")
    .eq("id", roleId)
    .maybeSingle();
  check("approval is recorded", reviewed?.review_status === "approved");
  check(
    "the same analyst reviewing their own entry is flagged",
    reviewed?.review_self_approved === true,
    `self_approved ${reviewed?.review_self_approved}`,
  );
  check("the reviewed version is recorded", reviewed?.reviewed_version === 1);

  console.log("\n2. The history and the audit trail");
  const { data: personVersions } = await admin
    .from("person_versions")
    .select("version, slug, full_name")
    .eq("person_id", personId)
    .order("version");
  check("the person has a version 1", personVersions?.[0]?.version === 1);
  check("it holds the name as entered", personVersions?.[0]?.full_name === SUBJECT);

  const { data: roleVersions } = await admin
    .from("company_role_versions")
    .select("version, valid_from_precision")
    .eq("role_id", roleId);
  check("the office has a version 1", roleVersions?.[0]?.version === 1);
  check("the snapshot carries the precision too", roleVersions?.[0]?.valid_from_precision === "year");

  const { data: audit } = await admin
    .from("audit_logs")
    .select("action")
    .in("action", ["person.created", "person.approved", "company_role.created", "company_role.approved"])
    .contains("details", { person_id: personId });
  check("the audit log records what happened", (audit?.length ?? 0) >= 2, `${audit?.length} entries`);

  console.log("\n3. What a real signed-in reader sees");
  const readerSees = await asEphemeralReader(async (reader) => {
    const { data: onCompany, error: readError } = await reader
      .from("company_roles")
      .select("id, people(full_name), person_role_catalogue(name)")
      .eq("company_id", company.id);
    return { rows: onCompany ?? [], error: readError };
  });
  check("the reader's leadership query runs", !readerSees.error, readerSees.error?.message);
  check(
    "the approved office is visible to a reader",
    readerSees.rows.some((row) => row.id === roleId),
    `${readerSees.rows.length} rows`,
  );

  console.log("\n4. A rename keeps the old address working");
  const { error: renameError } = await admin.rpc("upsert_person", {
    actor_user: analyst,
    p_full_name: SUBJECT,
    p_person_id: personId,
    p_slug: MOVED_SLUG,
    p_honorific: "Dr",
    p_change_reason: "Verification run: proving the former address resolves",
  });
  check("the person can be renamed with a reason", !renameError, renameError?.message);

  const { data: resolved } = await admin.rpc("person_slug_for_former_slug", { former: START_SLUG });
  check("the former address resolves to the new one", resolved === MOVED_SLUG, String(resolved));

  const { data: notFormer } = await admin.rpc("person_slug_for_former_slug", { former: MOVED_SLUG });
  check("the current address resolves to nothing", notFormer === null, String(notFormer));

  console.log("\n5. Withdrawing a claim removes it from the published record");
  const { error: withdrawError } = await admin.rpc("withdraw_company_role", {
    target_role: roleId,
    actor_user: analyst,
    p_reason: "Verification run: this office was never held by anybody",
  });
  check("the office can be withdrawn with a reason", !withdrawError, withdrawError?.message);

  const afterWithdraw = await asEphemeralReader(async (reader) => {
    const { data } = await reader.from("company_roles").select("id").eq("id", roleId);
    return data ?? [];
  });
  check("a reader no longer sees the withdrawn office", afterWithdraw.length === 0);

  const { data: survived } = await admin
    .from("company_role_versions")
    .select("version")
    .eq("role_id", roleId);
  check("its history survives the withdrawal", (survived?.length ?? 0) >= 1);

  const { error: reviveError } = await admin.rpc("review_company_role", {
    target_role: roleId,
    actor_user: analyst,
    p_decision: "approved",
    p_reason: null,
  });
  check("a withdrawn office cannot be re-approved", !!reviveError, "it was approved again");

  console.log("\n6. Leaving nothing a reader can see");
  const { error: rejectError } = await admin.rpc("review_person", {
    target_person: personId,
    actor_user: analyst,
    p_decision: "rejected",
    p_reason: "Verification record, not a real person",
  });
  check("the verification subject is rejected", !rejectError, rejectError?.message);
} else {
  console.log("A previous verification run left its subject behind; checking the end state only.\n");
}

// --- the end state, asserted on every run --------------------------------

console.log("\n7. The end state: published to nobody");
const { data: finalPerson } = await admin
  .from("people")
  .select("id, slug, review_status")
  .eq("id", personId)
  .maybeSingle();
check(
  "the subject is rejected, so no reader can see the name",
  finalPerson?.review_status === "rejected",
  `status ${finalPerson?.review_status}`,
);

const { data: finalRoles } = await admin
  .from("company_roles")
  .select("id, withdrawn_at")
  .eq("person_id", personId);
check(
  "every office recorded for it is withdrawn",
  (finalRoles?.length ?? 0) > 0 && finalRoles.every((row) => row.withdrawn_at !== null),
  `${finalRoles?.length} offices`,
);

const leftVisible = await asEphemeralReader(async (reader) => {
  const [{ data: visiblePeople }, { data: visibleRoles }] = await Promise.all([
    reader.from("people").select("id").eq("id", personId),
    reader.from("company_roles").select("id").eq("person_id", personId),
  ]);
  return { people: visiblePeople ?? [], roles: visibleRoles ?? [] };
});
check("a reader sees no verification person", leftVisible.people.length === 0);
check("a reader sees no verification office", leftVisible.roles.length === 0);

const { data: stillResolves } = await admin.rpc("person_slug_for_former_slug", { former: START_SLUG });
check(
  "the former address resolves to nothing, because nothing of it is published",
  stillResolves === null,
  String(stillResolves),
);

console.log(`\n${pass} passed, ${fail} failed.`);
if (firstRun) {
  console.log(
    `\nLeft on sfi-dev: one rejected person (${MOVED_SLUG}) and one withdrawn office. Neither is\n` +
      "visible to any reader. People and offices cannot be deleted by design, so re-running this\n" +
      "script reuses them rather than adding more.",
  );
}
process.exitCode = fail > 0 ? 1 : 0;
