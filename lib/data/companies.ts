import "server-only";
import { requireUser } from "@/lib/auth/session";
import { requireStaffRole } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import { notConnected } from "@/lib/providers/registry";
import type { ListingStatus } from "@/lib/companies/validation";
import type { DataResult, Observation, ReportingPeriod } from "@/lib/market-data/types";

/**
 * Nigerian listed companies — the centre of the product.
 *
 * Everything is read through the caller's own session, so row-level security
 * decides what is visible: a reader sees approved companies, staff also see the
 * review queue. The loaders throw rather than returning an empty list, because
 * an empty directory and a broken query look identical on the page, and "there
 * are no companies" is a claim we should not make by accident. Pages catch and
 * report per panel.
 *
 * The ticker is not a column. It lives on the company's equity instrument in
 * instrument_identifiers with effective dates, so a rename is recorded rather
 * than overwritten. It is read through an embed and picked in TypeScript rather
 * than filtered in the query: filtering an embedded resource changes which
 * parent rows come back, and a company whose symbol had just been closed would
 * silently vanish from the directory.
 */

function reportFailure(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

/**
 * The listing vocabulary and the board suggestions live in the validation module,
 * which is pure: the registry form is a client component and cannot import
 * anything from here, because this module is server-only. They are re-exported so
 * server-side callers have one obvious place to import from.
 */
export {
  LISTING_STATUSES,
  LISTING_STATUS_LABELS,
  NGX_BOARDS,
  slugify,
  type ListingStatus,
} from "@/lib/companies/validation";

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface CompanyProfile {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  sectorId: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  listingStatus: ListingStatus;
  listingBoard: string | null;
  /** The current NGX symbol, or null for a company that has not listed. */
  symbol: string | null;
}

export interface CompanyForDesk extends CompanyProfile {
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  reviewSelfApproved: boolean;
  /** True when the profile has changed since anyone reviewed it. */
  hasUnreviewedChanges: boolean;
  version: number;
}

export interface CompanyProfileVersion {
  version: number;
  name: string;
  slug: string;
  listingStatus: string;
  listingBoard: string | null;
  symbol: string | null;
  changeReason: string | null;
  changedAt: string;
}

export interface StatementValue {
  lineItem: string;
  period: ReportingPeriod;
  value: Observation;
}

export interface CompanyDocument {
  id: string;
  title: string;
  kind: string;
  publishedAt: string | null;
  reviewedAt: string | null;
  sourceUri: string | null;
}

interface IdentifierRow {
  scheme: string;
  value: string;
  valid_to: string | null;
}

interface InstrumentRow {
  asset_class: string;
  instrument_identifiers: IdentifierRow[] | null;
}

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  sector_id: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  listing_status: string;
  listing_board: string | null;
  review_status?: string;
  reviewed_at?: string | null;
  reviewed_version?: number | null;
  review_self_approved?: boolean;
  sectors: { name: string } | { name: string }[] | null;
  instruments: InstrumentRow[] | null;
}

const PROFILE_COLUMNS =
  "id, slug, name, legal_name, sector_id, industry, description, website, listing_status, listing_board, " +
  "sectors(name), instruments(asset_class, instrument_identifiers(scheme, value, valid_to))";

const DESK_COLUMNS = `${PROFILE_COLUMNS}, review_status, reviewed_at, reviewed_version, review_self_approved`;

/** The live NGX symbol on the company's equity instrument, if it has one. */
function currentSymbol(row: CompanyRow): string | null {
  for (const instrument of row.instruments ?? []) {
    if (instrument.asset_class !== "equity") continue;
    for (const identifier of instrument.instrument_identifiers ?? []) {
      if (identifier.scheme === "ngx_symbol" && identifier.valid_to === null) return identifier.value;
    }
  }
  return null;
}

function toProfile(row: CompanyRow): CompanyProfile {
  // A to-one embed arrives as an object, but some shapes send an array.
  const sector = Array.isArray(row.sectors) ? row.sectors[0] : row.sectors;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    sectorId: row.sector_id,
    sector: sector?.name ?? null,
    industry: row.industry,
    description: row.description,
    website: row.website,
    listingStatus: row.listing_status as ListingStatus,
    listingBoard: row.listing_board,
    symbol: currentSymbol(row),
  };
}

/** NGX symbols are upper-case letters/digits, sometimes with a dot. Returns null if malformed. */
export function normalizeSymbol(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const symbol = decoded.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{1,14}$/.test(symbol) ? symbol : null;
}

/** Company web addresses are lowercase words joined by single hyphens. */
export function normalizeSlug(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const slug = decoded.trim().toLowerCase();
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 120 ? slug : null;
}

// ---------------------------------------------------------------------------
// Reader-facing
// ---------------------------------------------------------------------------

/** The directory. Row-level security limits this to approved companies. */
export async function listCompanies(limit = 200): Promise<CompanyProfile[]> {
  const user = await requireUser();
  // Local preview runs without Supabase, where createClient() throws.
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(PROFILE_COLUMNS)
    .eq("review_status", "approved")
    .order("name")
    .limit(limit);

  if (error || !data) reportFailure("the company directory", error);
  return (data as unknown as CompanyRow[]).map(toProfile);
}

/** One company by its web address, or null when there is no such approved company. */
export async function getCompanyBySlug(slug: string): Promise<CompanyProfile | null> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("companies")
    .select(PROFILE_COLUMNS)
    .eq("slug", slug)
    .eq("review_status", "approved")
    .maybeSingle();

  if (error) reportFailure("that company", error);
  return data ? toProfile(data as unknown as CompanyRow) : null;
}

/**
 * The web address of the approved company currently carrying this symbol, so
 * /companies/DANGCEM can send a reader to the company's own page. An analyst
 * types the ticker; the address is the slug.
 */
export async function slugForSymbol(symbol: string): Promise<string | null> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instrument_identifiers")
    .select("value, instruments!inner(asset_class, companies!inner(slug, review_status))")
    .eq("scheme", "ngx_symbol")
    .eq("value", symbol)
    .is("valid_to", null)
    .limit(1);

  if (error) reportFailure("that symbol", error);

  type Embedded = { slug: string; review_status: string };
  type Row = {
    instruments:
      | { asset_class: string; companies: Embedded | Embedded[] | null }
      | Array<{ asset_class: string; companies: Embedded | Embedded[] | null }>
      | null;
  };
  const row = (data as unknown as Row[] | null)?.[0];
  if (!row) return null;
  const instrument = Array.isArray(row.instruments) ? row.instruments[0] : row.instruments;
  if (!instrument || instrument.asset_class !== "equity") return null;
  const company = Array.isArray(instrument.companies) ? instrument.companies[0] : instrument.companies;
  return company?.review_status === "approved" ? company.slug : null;
}

/**
 * The address a company has now, given one it used to have. Renaming a company
 * moves its page, and every link already shared would otherwise break.
 *
 * The history this reads is staff-only, so the question goes through a function
 * that answers only this one thing, and only for approved companies.
 */
export async function currentSlugForFormerSlug(formerSlug: string): Promise<string | null> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("company_slug_for_former_slug", { former: formerSlug });
  // A failure here means a reader sees "not found" rather than a redirect, which
  // is the right way round: never invent a destination.
  if (error) return null;
  return typeof data === "string" && data.length > 0 ? data : null;
}

/** The approved documents behind a company, newest first. */
export async function getCompanyDocuments(companyId: string, limit = 50): Promise<CompanyDocument[]> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  // Row-level security already hides unapproved and unverified-licence
  // documents; the filter is restated so the page does not depend on a policy
  // for correctness without saying so.
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, kind, published_at, reviewed_at, source_uri")
    .eq("company_id", companyId)
    .eq("review_status", "approved")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error || !data) reportFailure("that company's documents", error);
  return data.map((d) => ({
    id: d.id as string,
    title: d.title as string,
    kind: d.kind as string,
    publishedAt: (d.published_at as string | null) ?? null,
    reviewedAt: (d.reviewed_at as string | null) ?? null,
    sourceUri: (d.source_uri as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Staff-facing
// ---------------------------------------------------------------------------

/** The registry desk: every company, whatever its review state. */
export async function listCompaniesForDesk(limit = 200): Promise<CompanyForDesk[]> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();

  const { data, error } = await supabase.from("companies").select(DESK_COLUMNS).order("name").limit(limit);
  if (error || !data) reportFailure("the company registry", error);
  const rows = data as unknown as CompanyRow[];

  // The latest version per company, to show which profiles have changed since
  // anyone read them.
  const { data: versionRows, error: versionError } = await supabase
    .from("company_profile_versions")
    .select("company_id, version");
  if (versionError || !versionRows) reportFailure("the profile history", versionError);

  const latest = new Map<string, number>();
  for (const row of versionRows as Array<{ company_id: string; version: number }>) {
    const seen = latest.get(row.company_id) ?? 0;
    if (row.version > seen) latest.set(row.company_id, row.version);
  }

  return rows.map((row) => withReviewState(row, latest.get(row.id) ?? 0));
}

function withReviewState(row: CompanyRow, version: number): CompanyForDesk {
  const reviewed = row.reviewed_version ?? 0;
  return {
    ...toProfile(row),
    reviewStatus: (row.review_status ?? "pending") as ReviewStatus,
    reviewedAt: row.reviewed_at ?? null,
    reviewSelfApproved: Boolean(row.review_self_approved),
    // Approved, but carrying changes nobody has read. The company stays visible
    // — a typo fix must not delist it — so this is how the desk shows that the
    // recorded review is behind the profile.
    hasUnreviewedChanges: row.review_status === "approved" && version > reviewed,
    version,
  };
}

/** One company for the edit form, whatever its review state. */
export async function getCompanyForDesk(id: string): Promise<CompanyForDesk | null> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();

  const { data, error } = await supabase.from("companies").select(DESK_COLUMNS).eq("id", id).maybeSingle();
  if (error) reportFailure("that company", error);
  if (!data) return null;

  const { data: versionRows, error: versionError } = await supabase
    .from("company_profile_versions")
    .select("version")
    .eq("company_id", id)
    .order("version", { ascending: false })
    .limit(1);
  if (versionError) reportFailure("the profile history", versionError);

  const version = (versionRows as Array<{ version: number }> | null)?.[0]?.version ?? 0;
  return withReviewState(data as unknown as CompanyRow, version);
}

/** How a company's profile has changed, newest first. Staff only. */
export async function listProfileVersions(companyId: string): Promise<CompanyProfileVersion[]> {
  await requireStaffRole(["analyst"]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("company_profile_versions")
    .select("version, name, slug, listing_status, listing_board, ngx_symbol, change_reason, changed_at")
    .eq("company_id", companyId)
    .order("version", { ascending: false });

  if (error || !data) reportFailure("that company's history", error);
  return data.map((v) => ({
    version: v.version as number,
    name: v.name as string,
    slug: v.slug as string,
    listingStatus: v.listing_status as string,
    listingBoard: (v.listing_board as string | null) ?? null,
    symbol: (v.ngx_symbol as string | null) ?? null,
    changeReason: (v.change_reason as string | null) ?? null,
    changedAt: v.changed_at as string,
  }));
}

export interface SectorOption {
  id: string;
  name: string;
}

export async function listSectors(): Promise<SectorOption[]> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase.from("sectors").select("id, name").order("name");
  if (error || !data) reportFailure("sectors", error);
  return data.map((s) => ({ id: s.id as string, name: s.name as string }));
}

export interface CompanyOption {
  id: string;
  name: string;
  symbol: string | null;
}

/**
 * Approved companies, for the issuer selector on the document, announcement and
 * editorial desks. Only approved ones: attaching a record to a company readers
 * cannot see would hide the record along with it.
 */
export async function listApprovedCompanies(limit = 300): Promise<CompanyOption[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("companies")
    .select("id, name, instruments(asset_class, instrument_identifiers(scheme, value, valid_to))")
    .eq("review_status", "approved")
    .order("name")
    .limit(limit);

  if (error || !data) reportFailure("companies", error);
  return (data as unknown as CompanyRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    symbol: currentSymbol(row),
  }));
}

// ---------------------------------------------------------------------------
// Not yet connected
// ---------------------------------------------------------------------------

/**
 * Financial statements are entered by an analyst, each figure citing a document
 * and a page. That is stage 3b onward; until then the company page says so
 * rather than showing an empty table that implies a feed exists.
 */
export async function getFinancialStatements(
  companyId: string,
  basis: "annual" | "interim",
): Promise<DataResult<StatementValue[]>> {
  await requireUser();
  void companyId;
  void basis;
  return notConnected("companies.financials");
}
