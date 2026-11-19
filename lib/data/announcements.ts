import "server-only";
import { requireStaffRole } from "@/lib/auth/staff";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Announcements: the first records readers see that came the whole way through
 * upload, review and publication.
 *
 * Everything is read through the caller's own session, so row-level security
 * decides what is visible. Readers get published and withdrawn rows; staff also
 * see superseded versions.
 *
 * These throw rather than returning an empty list on failure. An empty feed and
 * a broken query look identical to a reader, and "nothing was announced" is a
 * claim about the world we should not make by accident.
 */

function reportFailure(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

export type AnnouncementStatus = "published" | "superseded" | "withdrawn";

export interface Announcement {
  id: string;
  /** The approved document this rests on; a correction must cite the same one. */
  documentId: string;
  headline: string;
  summary: string | null;
  category: string;
  companyName: string | null;
  sourceUri: string;
  announcedAt: string;
  publishedAt: string;
  isPriceSensitive: boolean;
  status: AnnouncementStatus;
  version: number;
  /** Set from version 2 onward: why the earlier version was replaced. */
  correctionReason: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  selfPublished: boolean;
}

interface Row {
  id: string;
  document_id: string;
  headline: string;
  summary: string | null;
  category: string;
  source_uri: string;
  announced_at: string;
  published_at: string;
  is_price_sensitive: boolean;
  status: string;
  version: number;
  correction_reason: string | null;
  withdrawn_at: string | null;
  withdrawal_reason: string | null;
  self_published: boolean;
  companies: { name: string } | { name: string }[] | null;
}

const COLUMNS =
  "id, document_id, headline, summary, category, source_uri, announced_at, published_at, is_price_sensitive, " +
  "status, version, correction_reason, withdrawn_at, withdrawal_reason, self_published, companies(name)";

function toAnnouncement(row: Row): Announcement {
  // A to-one embed arrives as an object, but some shapes send an array.
  const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  return {
    id: row.id,
    documentId: row.document_id,
    headline: row.headline,
    summary: row.summary,
    category: row.category,
    companyName: company?.name ?? null,
    sourceUri: row.source_uri,
    announcedAt: row.announced_at,
    publishedAt: row.published_at,
    isPriceSensitive: row.is_price_sensitive,
    status: row.status as AnnouncementStatus,
    version: row.version,
    correctionReason: row.correction_reason,
    withdrawnAt: row.withdrawn_at,
    withdrawalReason: row.withdrawal_reason,
    selfPublished: row.self_published,
  };
}

/**
 * The reader's feed. Row-level security already hides superseded versions, but
 * the status filter is stated here too: depending on a policy for correctness
 * without saying so is how a later policy change goes unnoticed.
 */
export async function listPublishedAnnouncements(limit = 50): Promise<Announcement[]> {
  const user = await requireUser();
  // Local preview runs without Supabase, where createClient() throws. There is
  // no database to read and nothing has been published, so say so rather than
  // taking the whole page down.
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select(COLUMNS)
    .in("status", ["published", "withdrawn"])
    .order("announced_at", { ascending: false })
    .limit(limit);

  if (error || !data) reportFailure("announcements", error);
  return (data as unknown as Row[]).map(toAnnouncement);
}

/** Everything, including superseded versions. Staff only. */
export async function listAllAnnouncements(limit = 50): Promise<Announcement[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select(COLUMNS)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error || !data) reportFailure("the announcement record", error);
  return (data as unknown as Row[]).map(toAnnouncement);
}

export interface PublishableDocument {
  id: string;
  title: string;
  kind: string;
  sourceUri: string | null;
  publishedAt: string | null;
  reviewedAt: string | null;
  /** False when the document has no public link, which blocks publication. */
  canPublish: boolean;
}

/**
 * Approved documents with no live announcement — the publishing queue.
 *
 * Documents without a public source link are listed rather than hidden, with
 * `canPublish` false, so the reason they cannot be used is visible instead of
 * their simply being absent.
 */
export async function listPublishableDocuments(limit = 50): Promise<PublishableDocument[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();

  // Documents already announced are excluded in the query, not afterwards.
  // Filtering a limited page would silently drop older unpublished approvals
  // off the end of the queue as the published set grew.
  const { data: live, error: liveError } = await supabase
    .from("announcements")
    .select("document_id")
    .eq("status", "published");

  if (liveError || !live) reportFailure("existing announcements", liveError);

  const taken = live
    .map((row) => row.document_id as string)
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));

  let query = supabase
    .from("documents")
    .select("id, title, kind, source_uri, published_at, reviewed_at")
    .eq("review_status", "approved");

  if (taken.length > 0) {
    query = query.not("id", "in", `(${taken.join(",")})`);
  }

  const { data: documents, error } = await query
    .order("reviewed_at", { ascending: false })
    .limit(limit);

  if (error || !documents) reportFailure("approved documents", error);

  return documents
    .map((d) => ({
      id: d.id as string,
      title: d.title as string,
      kind: d.kind as string,
      sourceUri: (d.source_uri as string | null) ?? null,
      publishedAt: (d.published_at as string | null) ?? null,
      reviewedAt: (d.reviewed_at as string | null) ?? null,
      canPublish: Boolean(d.source_uri),
    }));
}
