import "server-only";
import { requireStaffRole } from "@/lib/auth/staff";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { EditorialKind } from "@/lib/editorial/validation";

/**
 * Editorial reads, through the caller's own session so row-level security
 * decides what is visible: readers get published and withdrawn items, staff also
 * see drafts and superseded versions.
 *
 * These throw rather than returning an empty list on failure, for the same
 * reason as announcements — "nothing was published" is a claim about the world.
 */

function reportFailure(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

export type EditorialStatus = "draft" | "published" | "superseded" | "withdrawn";

export interface EditorialCitation {
  id: string;
  claim: string;
  sourcePage: number | null;
  documentTitle: string | null;
  documentSourceUri: string | null;
  announcementHeadline: string | null;
  announcementSourceUri: string | null;
}

export interface EditorialItem {
  id: string;
  kind: EditorialKind;
  slug: string;
  title: string;
  standfirst: string | null;
  bodyText: string | null;
  videoId: string | null;
  guestName: string | null;
  status: EditorialStatus;
  version: number;
  correctionReason: string | null;
  publishedAt: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  selfReviewed: boolean;
  aiAssisted: boolean;
  aiModel: string | null;
  updatedAt: string;
}

interface Row {
  id: string;
  kind: string;
  slug: string;
  title: string;
  standfirst: string | null;
  body_text: string | null;
  video_id: string | null;
  guest_name: string | null;
  status: string;
  version: number;
  correction_reason: string | null;
  published_at: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  self_reviewed: boolean;
  ai_assisted: boolean;
  ai_model: string | null;
  updated_at: string;
}

interface CitationRow {
  id: string;
  claim: string;
  source_page: number | null;
  documents: { title: string; source_uri: string | null } | { title: string; source_uri: string | null }[] | null;
  announcements: { headline: string; source_uri: string } | { headline: string; source_uri: string }[] | null;
}

const COLUMNS =
  "id, kind, slug, title, standfirst, body_text, video_id, guest_name, status, version, " +
  "correction_reason, published_at, withdrawn_at, withdrawal_reason, self_reviewed, ai_assisted, ai_model, updated_at";

const CITATION_COLUMNS =
  "id, claim, source_page, documents(title, source_uri), announcements(headline, source_uri)";

function toItem(row: Row): EditorialItem {
  return {
    id: row.id,
    kind: row.kind as EditorialKind,
    slug: row.slug,
    title: row.title,
    standfirst: row.standfirst,
    bodyText: row.body_text,
    videoId: row.video_id,
    guestName: row.guest_name,
    status: row.status as EditorialStatus,
    version: row.version,
    correctionReason: row.correction_reason,
    publishedAt: row.published_at,
    withdrawnAt: row.withdrawn_at,
    withdrawalReason: row.withdrawal_reason,
    selfReviewed: row.self_reviewed,
    aiAssisted: row.ai_assisted,
    aiModel: row.ai_model,
    updatedAt: row.updated_at,
  };
}

function toCitation(row: CitationRow): EditorialCitation {
  const doc = Array.isArray(row.documents) ? row.documents[0] : row.documents;
  const ann = Array.isArray(row.announcements) ? row.announcements[0] : row.announcements;
  return {
    id: row.id,
    claim: row.claim,
    sourcePage: row.source_page ?? null,
    documentTitle: doc?.title ?? null,
    documentSourceUri: doc?.source_uri ?? null,
    announcementHeadline: ann?.headline ?? null,
    announcementSourceUri: ann?.source_uri ?? null,
  };
}

/** The reader's list: what is live, newest first. */
export async function listLiveEditorial(limit = 50): Promise<EditorialItem[]> {
  const user = await requireUser();
  // Local preview runs without Supabase, where createClient() throws.
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editorial_items")
    .select(COLUMNS)
    .in("status", ["published", "withdrawn"])
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error || !data) reportFailure("editorial", error);
  return (data as unknown as Row[]).map(toItem);
}

/** One item by its address, with the sources it cites. Null when there is none. */
export async function getEditorialBySlug(
  slug: string,
): Promise<{ item: EditorialItem; citations: EditorialCitation[] } | null> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editorial_items")
    .select(COLUMNS)
    .eq("slug", slug)
    .in("status", ["published", "withdrawn"])
    .maybeSingle();

  // A missing row is not a failure; a broken query is.
  if (error) reportFailure("that article", error);
  if (!data) return null;

  const item = toItem(data as unknown as Row);

  const { data: cited, error: citationError } = await supabase
    .from("editorial_citations")
    .select(CITATION_COLUMNS)
    .eq("item_id", item.id)
    .order("created_at", { ascending: true });

  if (citationError || !cited) reportFailure("its sources", citationError);

  return { item, citations: (cited as unknown as CitationRow[]).map(toCitation) };
}

/** Everything, including drafts and superseded versions. Staff only. */
/**
 * SFI's own writing about one company. Empty until an author attaches an item to
 * an issuer, which the editorial desk's company selector does.
 */
export async function listEditorialForCompany(companyId: string, limit = 25): Promise<EditorialItem[]> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editorial_items")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .in("status", ["published", "withdrawn"])
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error || !data) reportFailure("that company's research", error);
  return (data as unknown as Row[]).map(toItem);
}

export async function listAllEditorial(limit = 60): Promise<EditorialItem[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editorial_items")
    .select(COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) reportFailure("the editorial record", error);
  return (data as unknown as Row[]).map(toItem);
}

export interface CitableSource {
  id: string;
  label: string;
  kind: "document" | "announcement";
}

/** What a draft may cite: approved documents and published announcements. */
export async function listCitableSources(limit = 50): Promise<CitableSource[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();

  const [documents, announcements] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title")
      .eq("review_status", "approved")
      // The citation guard also requires a licence a reader could act on, so an
      // 'unverified' document is not citable. Offering one here would hand the
      // writer a source the trigger then refuses with a bare 23514.
      .neq("licence_class", "unverified")
      .order("reviewed_at", { ascending: false })
      .limit(limit),
    supabase
      .from("announcements")
      .select("id, headline")
      .eq("status", "published")
      .order("announced_at", { ascending: false })
      .limit(limit),
  ]);

  if (documents.error || !documents.data) reportFailure("approved documents", documents.error);
  if (announcements.error || !announcements.data) reportFailure("published announcements", announcements.error);

  return [
    ...documents.data.map((d) => ({ id: d.id as string, label: d.title as string, kind: "document" as const })),
    ...announcements.data.map((a) => ({
      id: a.id as string,
      label: a.headline as string,
      kind: "announcement" as const,
    })),
  ];
}

export async function listCitationsFor(itemId: string): Promise<EditorialCitation[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("editorial_citations")
    .select(CITATION_COLUMNS)
    .eq("item_id", itemId)
    .order("created_at", { ascending: true });

  if (error || !data) reportFailure("citations", error);
  return (data as unknown as CitationRow[]).map(toCitation);
}
