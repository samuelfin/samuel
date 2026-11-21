import "server-only";
import { requireStaffRole } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";

/**
 * People and the offices they hold.
 *
 * Read through the caller's own session, so row-level security decides what is
 * visible: an analyst sees the whole register including the review queue, a
 * reader sees only an approved person holding an approved role at an approved
 * company. The loaders throw rather than returning an empty list, because an
 * empty board and a broken query look identical on the page and "this company
 * has no directors" is a claim we should not make by accident.
 *
 * The role catalogue is a table rather than a constant here, so a new office is
 * a row and not a deployment, and the page can split executives from the board
 * without a hard-coded list.
 */

function reportFailure(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

export interface RoleOption {
  id: string;
  name: string;
  isExecutive: boolean;
  isBoard: boolean;
}

export interface PersonForDesk {
  id: string;
  slug: string;
  fullName: string;
  honorific: string | null;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewSelfApproved: boolean;
  reviewedAt: string | null;
  reviewedVersion: number | null;
  version: number;
  updatedAt: string;
}

export interface RoleForDesk {
  id: string;
  personId: string;
  personName: string;
  personSlug: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  roleCode: string;
  roleName: string;
  roleTitle: string | null;
  isActing: boolean;
  validFrom: string;
  validFromPrecision: string;
  validTo: string | null;
  validToPrecision: string | null;
  documentId: string | null;
  documentTitle: string | null;
  sourcePage: number | null;
  announcementId: string | null;
  announcementHeadline: string | null;
  lastConfirmedOn: string | null;
  lastConfirmedSourcePage: number | null;
  /** What confirmed the role, so a reviewer can check the confirmation too. */
  confirmationSource: string | null;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewSelfApproved: boolean;
  reviewedVersion: number | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  version: number;
  updatedAt: string;
}

export interface PersonVersion {
  version: number;
  slug: string;
  fullName: string;
  honorific: string | null;
  changeReason: string | null;
  changedAt: string;
}

export interface RoleVersion {
  version: number;
  roleCode: string;
  roleTitle: string | null;
  isActing: boolean;
  validFrom: string;
  validFromPrecision: string;
  validTo: string | null;
  validToPrecision: string | null;
  lastConfirmedOn: string | null;
  changeReason: string | null;
  changedAt: string;
}

const PERSON_COLUMNS =
  "id, slug, full_name, honorific, review_status, review_self_approved, reviewed_at, reviewed_version, updated_at";

/**
 * The person, the company and the office are embedded so the desk can show the
 * claim in words rather than three ids. Both sources are embedded for the same
 * reason: a role whose evidence cannot be named is not reviewable, and neither
 * is a confirmation.
 *
 * Every document and announcement embed carries a `!column` hint, and it has to.
 * company_roles holds two foreign keys to documents — the evidence and the
 * confirming source — and two to announcements, so a bare `documents(title)` is
 * ambiguous and PostgREST refuses the whole query with "more than one
 * relationship was found". That failure is invisible to the test suite, which
 * runs on PGlite and has no PostgREST in it at all; it showed up only against
 * the real project. The hint names the column rather than the constraint, so a
 * later migration renaming a constraint cannot quietly break it.
 */
const ROLE_COLUMNS =
  "id, person_id, company_id, role_code, role_title, is_acting, valid_from, valid_from_precision, " +
  "valid_to, valid_to_precision, document_id, source_page, announcement_id, last_confirmed_on, " +
  "last_confirmed_source_page, review_status, review_self_approved, reviewed_version, withdrawn_at, " +
  "withdrawal_reason, updated_at, " +
  "people(full_name, slug), companies(name, slug), person_role_catalogue(name), " +
  "documents!document_id(title), announcements!announcement_id(headline), " +
  "confirmation_document:documents!last_confirmed_document_id(title), " +
  "confirmation_announcement:announcements!last_confirmed_announcement_id(headline)";

interface PersonRow {
  id: string;
  slug: string;
  full_name: string;
  honorific: string | null;
  review_status: string;
  review_self_approved: boolean;
  reviewed_at: string | null;
  reviewed_version: number | null;
  updated_at: string;
}

type Embedded<T> = T | T[] | null;

interface RoleRow {
  id: string;
  person_id: string;
  company_id: string;
  role_code: string;
  role_title: string | null;
  is_acting: boolean;
  valid_from: string;
  valid_from_precision: string;
  valid_to: string | null;
  valid_to_precision: string | null;
  document_id: string | null;
  source_page: number | null;
  announcement_id: string | null;
  last_confirmed_on: string | null;
  last_confirmed_source_page: number | null;
  review_status: string;
  review_self_approved: boolean;
  reviewed_version: number | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  updated_at: string;
  people: Embedded<{ full_name: string; slug: string }>;
  companies: Embedded<{ name: string; slug: string }>;
  person_role_catalogue: Embedded<{ name: string }>;
  documents: Embedded<{ title: string }>;
  announcements: Embedded<{ headline: string }>;
  confirmation_document: Embedded<{ title: string }>;
  confirmation_announcement: Embedded<{ headline: string }>;
}

/** PostgREST returns a to-one embed as an object or a single-element array. */
function one<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toPerson(row: PersonRow, version: number): PersonForDesk {
  return {
    id: row.id,
    slug: row.slug,
    fullName: row.full_name,
    honorific: row.honorific,
    reviewStatus: row.review_status as PersonForDesk["reviewStatus"],
    reviewSelfApproved: row.review_self_approved,
    reviewedAt: row.reviewed_at,
    reviewedVersion: row.reviewed_version,
    version,
    updatedAt: row.updated_at,
  };
}

function toRole(row: RoleRow, version: number): RoleForDesk {
  const person = one(row.people);
  const company = one(row.companies);
  const office = one(row.person_role_catalogue);
  const document = one(row.documents);
  const announcement = one(row.announcements);
  const confirmDocument = one(row.confirmation_document);
  const confirmAnnouncement = one(row.confirmation_announcement);
  const confirmationSource = confirmDocument
    ? `${confirmDocument.title}, page ${row.last_confirmed_source_page}`
    : confirmAnnouncement
      ? `Announcement: ${confirmAnnouncement.headline}`
      : null;
  return {
    id: row.id,
    personId: row.person_id,
    personName: person?.full_name ?? "(unknown person)",
    personSlug: person?.slug ?? "",
    companyId: row.company_id,
    companyName: company?.name ?? "(unknown company)",
    companySlug: company?.slug ?? "",
    roleCode: row.role_code,
    roleName: office?.name ?? row.role_code,
    roleTitle: row.role_title,
    isActing: row.is_acting,
    validFrom: row.valid_from,
    validFromPrecision: row.valid_from_precision,
    validTo: row.valid_to,
    validToPrecision: row.valid_to_precision,
    documentId: row.document_id,
    documentTitle: document?.title ?? null,
    sourcePage: row.source_page,
    announcementId: row.announcement_id,
    announcementHeadline: announcement?.headline ?? null,
    lastConfirmedOn: row.last_confirmed_on,
    lastConfirmedSourcePage: row.last_confirmed_source_page,
    confirmationSource,
    reviewStatus: row.review_status as RoleForDesk["reviewStatus"],
    reviewSelfApproved: row.review_self_approved,
    reviewedVersion: row.reviewed_version,
    withdrawnAt: row.withdrawn_at,
    withdrawalReason: row.withdrawal_reason,
    version,
    updatedAt: row.updated_at,
  };
}

/** The offices a role may hold, in the order a filing lists them. */
export async function listRoleCatalogue(): Promise<RoleOption[]> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("person_role_catalogue")
    .select("id, name, is_executive, is_board")
    .order("sort_order");

  if (error || !data) reportFailure("the role catalogue", error);
  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    isExecutive: row.is_executive as boolean,
    isBoard: row.is_board as boolean,
  }));
}

/**
 * Version numbers come from the history tables, which the desk needs in order to
 * say "approved, with changes nobody has reviewed since". Fetched in one query
 * for the whole page rather than per row.
 */
async function personVersionMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, number>> {
  const latest = new Map<string, number>();
  if (ids.length === 0) return latest;
  const { data, error } = await supabase
    .from("person_versions")
    .select("person_id, version")
    .in("person_id", ids);
  if (error || !data) reportFailure("the person history", error);
  for (const row of data as Array<{ person_id: string; version: number }>) {
    const current = latest.get(row.person_id) ?? 0;
    if (row.version > current) latest.set(row.person_id, row.version);
  }
  return latest;
}

async function roleVersionMap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
): Promise<Map<string, number>> {
  const latest = new Map<string, number>();
  if (ids.length === 0) return latest;
  const { data, error } = await supabase
    .from("company_role_versions")
    .select("role_id, version")
    .in("role_id", ids);
  if (error || !data) reportFailure("the leadership history", error);
  for (const row of data as Array<{ role_id: string; version: number }>) {
    const current = latest.get(row.role_id) ?? 0;
    if (row.version > current) latest.set(row.role_id, row.version);
  }
  return latest;
}

/** Everyone on the register, newest change first. Analyst desk only. */
export async function listPeopleForDesk(limit = 200): Promise<PersonForDesk[]> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select(PERSON_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) reportFailure("the people register", error);
  const rows = data as unknown as PersonRow[];
  const versions = await personVersionMap(
    supabase,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toPerson(row, versions.get(row.id) ?? 0));
}

export async function getPersonForDesk(id: string): Promise<PersonForDesk | null> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("people").select(PERSON_COLUMNS).eq("id", id).maybeSingle();

  // A missing row is not a failure; a broken query is.
  if (error) reportFailure("that person", error);
  if (!data) return null;
  const row = data as unknown as PersonRow;
  const versions = await personVersionMap(supabase, [row.id]);
  return toPerson(row, versions.get(row.id) ?? 0);
}

export async function getPersonForDeskBySlug(slug: string): Promise<PersonForDesk | null> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .select(PERSON_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) reportFailure("that person", error);
  if (!data) return null;
  const row = data as unknown as PersonRow;
  const versions = await personVersionMap(supabase, [row.id]);
  return toPerson(row, versions.get(row.id) ?? 0);
}

/** Every role on the register, including pending and withdrawn ones. */
export async function listRolesForDesk(limit = 300): Promise<RoleForDesk[]> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_roles")
    .select(ROLE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) reportFailure("the leadership register", error);
  const rows = data as unknown as RoleRow[];
  const versions = await roleVersionMap(
    supabase,
    rows.map((r) => r.id),
  );
  return rows.map((row) => toRole(row, versions.get(row.id) ?? 0));
}

export async function getRoleForDesk(id: string): Promise<RoleForDesk | null> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_roles").select(ROLE_COLUMNS).eq("id", id).maybeSingle();

  if (error) reportFailure("that role", error);
  if (!data) return null;
  const row = data as unknown as RoleRow;
  const versions = await roleVersionMap(supabase, [row.id]);
  return toRole(row, versions.get(row.id) ?? 0);
}

export async function listPersonVersions(personId: string): Promise<PersonVersion[]> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("person_versions")
    .select("version, slug, full_name, honorific, change_reason, changed_at")
    .eq("person_id", personId)
    .order("version", { ascending: false });

  if (error || !data) reportFailure("that person's history", error);
  return (data as Array<Record<string, unknown>>).map((row) => ({
    version: row.version as number,
    slug: row.slug as string,
    fullName: row.full_name as string,
    honorific: (row.honorific as string | null) ?? null,
    changeReason: (row.change_reason as string | null) ?? null,
    changedAt: row.changed_at as string,
  }));
}

export async function listRoleVersions(roleId: string): Promise<RoleVersion[]> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_role_versions")
    .select(
      "version, role_code, role_title, is_acting, valid_from, valid_from_precision, valid_to, " +
        "valid_to_precision, last_confirmed_on, change_reason, changed_at",
    )
    .eq("role_id", roleId)
    .order("version", { ascending: false });

  if (error || !data) reportFailure("that role's history", error);
  // The projection is built by concatenation, which PostgREST's generated types
  // cannot follow, so the row shape is asserted rather than inferred.
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    version: row.version as number,
    roleCode: row.role_code as string,
    roleTitle: (row.role_title as string | null) ?? null,
    isActing: row.is_acting as boolean,
    validFrom: row.valid_from as string,
    validFromPrecision: row.valid_from_precision as string,
    validTo: (row.valid_to as string | null) ?? null,
    validToPrecision: (row.valid_to_precision as string | null) ?? null,
    lastConfirmedOn: (row.last_confirmed_on as string | null) ?? null,
    changeReason: (row.change_reason as string | null) ?? null,
    changedAt: row.changed_at as string,
  }));
}
