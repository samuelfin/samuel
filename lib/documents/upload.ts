import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffRole } from "@/lib/auth/staff";
import {
  DOCUMENT_BUCKET,
  isAllowedMimeType,
  normalizeSourceUri,
  storagePathFor,
  validateUpload,
  type DocumentKind,
  type LicenceClass,
} from "./validation";

/**
 * The first ingestion path: a staff member uploads an official document.
 *
 * Two rules shape this. The checksum is computed here from the bytes actually
 * stored, never taken from the browser — it is the document's identity, what
 * deduplicates uploads and what later observations cite. And the file reaches
 * storage before any row is written, so a document row always has an object
 * behind it; the reverse order could approve a document that does not exist.
 *
 * Nothing uploaded here is visible to readers. The document lands pending and
 * stays invisible until a reviewer approves it.
 */

export interface UploadInput {
  file: File;
  title: string;
  kind: DocumentKind | string;
  licenceClass: LicenceClass | string;
  providerId: string;
  datasetId: string;
  companyId?: string | null;
  sourceUri?: string | null;
  publishedAt?: string | null;
  periodEnd?: string | null;
}

export type UploadOutcome = { ok: true; documentId: string } | { ok: false; error: string };

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadSourceDocument(input: UploadInput): Promise<UploadOutcome> {
  const staff = await requireStaffRole(["analyst", "editor"]);

  const mimeType = input.file.type;
  const sizeBytes = input.file.size;

  const validation = validateUpload({
    title: input.title,
    kind: input.kind,
    licenceClass: input.licenceClass,
    mimeType,
    sizeBytes,
    sourceUri: input.sourceUri,
  });
  if (!validation.ok) return { ok: false, error: validation.error };
  if (!isAllowedMimeType(mimeType)) return { ok: false, error: "Upload a PDF, CSV or Excel file." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Document storage is not configured." };

  const bytes = await input.file.arrayBuffer();
  // Re-check the real length: File.size is reported by the browser.
  if (bytes.byteLength !== sizeBytes) {
    return { ok: false, error: "The file changed while it was being read. Try again." };
  }

  const sha256 = await sha256Hex(bytes);
  const storagePath = storagePathFor(sha256, mimeType);

  const { error: storageError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });

  // The path is the checksum, so a collision means these exact bytes are already
  // stored. Keep going: the database decides whether that is a duplicate document.
  const alreadyStored =
    storageError !== null && /exists|duplicate|409/i.test(storageError.message ?? "");
  if (storageError && !alreadyStored) {
    return { ok: false, error: "The file could not be stored." };
  }

  const { data, error } = await admin.rpc("record_uploaded_document", {
    actor_user: staff.userId,
    p_dataset_id: input.datasetId,
    p_provider_id: input.providerId,
    p_kind: input.kind,
    p_title: input.title.trim(),
    p_storage_path: storagePath,
    p_sha256: sha256,
    p_mime_type: mimeType,
    p_size_bytes: sizeBytes,
    p_licence_class: input.licenceClass,
    p_company_id: input.companyId ?? null,
    p_source_uri: normalizeSourceUri(input.sourceUri),
    p_published_at: input.publishedAt || null,
    p_period_end: input.periodEnd || null,
  });

  if (error) {
    // 23505 is documents.sha256 or source_records (dataset_id, content_sha256):
    // the same bytes are already recorded, which is a duplicate, not a failure of
    // the upload. The object is shared with the existing document, so it stays.
    if (error.code === "23505") {
      return { ok: false, error: "That document is already in the library." };
    }

    // Any other failure leaves no row pointing at the object. Nothing would ever
    // reference it again, and the bucket is not listable, so it could never be
    // found or reclaimed — remove it. Only safe when this call stored it: if the
    // bytes were already there, another document owns them.
    if (!alreadyStored) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    }

    if (error.code === "42501") {
      return { ok: false, error: "You may not upload documents." };
    }
    return { ok: false, error: "The document could not be recorded." };
  }

  return { ok: true, documentId: data as string };
}
