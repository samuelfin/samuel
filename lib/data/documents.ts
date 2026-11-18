import "server-only";
import { requireStaffRole } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";

/**
 * The document review queue. Read through the staff member's own session, so
 * row-level security decides what is visible rather than this module.
 */

export interface ReviewQueueItem {
  id: string;
  title: string;
  kind: string;
  reviewStatus: "pending" | "approved" | "rejected" | "superseded";
  licenceClass: string;
  mimeType: string;
  sizeBytes: number;
  sourceUri: string | null;
  publishedAt: string | null;
  createdAt: string;
  /** Cleared by the person who uploaded it, with nobody else checking. */
  selfApproved: boolean;
}

export interface ReviewEvent {
  toStatus: string;
  reason: string | null;
  createdAt: string;
}

const COLUMNS =
  "id, title, kind, review_status, licence_class, mime_type, size_bytes, source_uri, published_at, created_at";

interface DocumentRow {
  id: string;
  title: string;
  kind: string;
  review_status: string;
  licence_class: string;
  mime_type: string;
  size_bytes: number;
  source_uri: string | null;
  published_at: string | null;
  created_at: string;
}

function toItem(row: DocumentRow, selfApproved: ReadonlySet<string>): ReviewQueueItem {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    reviewStatus: row.review_status as ReviewQueueItem["reviewStatus"],
    licenceClass: row.licence_class,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sourceUri: row.source_uri,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    selfApproved: selfApproved.has(row.id),
  };
}

/**
 * Which of these documents were cleared by their own uploader.
 *
 * Read from the review event rather than inferred by comparing uploaded_by with
 * reviewed_by: once a document is superseded, reviewed_by names whoever did that,
 * which would misreport who approved it. The event is the record.
 */
async function selfApprovedIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentIds: string[],
): Promise<ReadonlySet<string>> {
  if (documentIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("document_review_events")
    .select("document_id")
    .eq("self_approved", true)
    .in("document_id", documentIds);

  if (error || !data) return new Set();
  return new Set(data.map((row) => row.document_id as string));
}

/** Documents awaiting a decision, oldest first: the queue is worked front to back. */
export async function listReviewQueue(): Promise<ReviewQueueItem[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(COLUMNS)
    .eq("review_status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);

  if (error || !data) return [];
  // Nothing pending has been approved yet, so no event lookup is needed.
  return (data as DocumentRow[]).map((row) => toItem(row, new Set()));
}

/** Recently decided documents, so a reviewer can see the effect of their work. */
export async function listRecentlyReviewed(): Promise<ReviewQueueItem[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select(COLUMNS)
    .neq("review_status", "pending")
    .order("reviewed_at", { ascending: false })
    .limit(20);

  if (error || !data) return [];
  const rows = data as DocumentRow[];
  const selfApproved = await selfApprovedIds(supabase, rows.map((row) => row.id));
  return rows.map((row) => toItem(row, selfApproved));
}

export async function listReviewHistory(documentId: string): Promise<ReviewEvent[]> {
  await requireStaffRole(["analyst", "editor"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_review_events")
    .select("to_status, reason, created_at")
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map((row) => ({
    toStatus: row.to_status as string,
    reason: (row.reason as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}
