/**
 * Upload rules, kept pure so they can be tested without a database or storage.
 *
 * Everything here is re-checked server-side. The browser's `accept` attribute and
 * the `File.type` it reports are conveniences, not controls: both are attacker
 * supplied. The storage bucket enforces the same mime and size limits again, and
 * the database enforces them a third time through check constraints.
 */

export const DOCUMENT_BUCKET = "source-documents";

/** Mirrors the bucket's allowed_mime_types and documents.mime_type. */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Mirrors the bucket's file_size_limit and documents.size_bytes. */
export const MAX_DOCUMENT_BYTES = 52_428_800;

export const DOCUMENT_KINDS = [
  "annual_report",
  "interim_report",
  "financial_statements",
  "presentation",
  "announcement",
  "regulatory_filing",
  "statistical_release",
  "auction_result",
  "circular",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const LICENCE_CLASSES = [
  "licensed",
  "public_official",
  "issuer_document",
  "sfi_original",
  "unverified",
] as const;

export type LicenceClass = (typeof LICENCE_CLASSES)[number];

const EXTENSION_BY_MIME: Record<AllowedMimeType, string> = {
  "application/pdf": "pdf",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export interface UploadCandidate {
  title: string;
  kind: string;
  licenceClass: string;
  mimeType: string;
  sizeBytes: number;
  sourceUri?: string | null;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateUpload(candidate: UploadCandidate): ValidationResult {
  const title = candidate.title.trim();
  if (title.length < 1 || title.length > 300) {
    return { ok: false, error: "Give the document a title of up to 300 characters." };
  }

  if (!(DOCUMENT_KINDS as readonly string[]).includes(candidate.kind)) {
    return { ok: false, error: "Choose a document kind." };
  }

  if (!(LICENCE_CLASSES as readonly string[]).includes(candidate.licenceClass)) {
    return { ok: false, error: "Choose how this document may be used." };
  }

  if (!isAllowedMimeType(candidate.mimeType)) {
    return { ok: false, error: "Upload a PDF, CSV or Excel file." };
  }

  if (!Number.isInteger(candidate.sizeBytes) || candidate.sizeBytes <= 0) {
    return { ok: false, error: "The file is empty." };
  }

  if (candidate.sizeBytes > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: "The file is larger than 50 MB." };
  }

  // documents.source_uri is constrained to http(s); reject anything else early and
  // with a readable message rather than letting a check constraint fail.
  const uri = candidate.sourceUri?.trim();
  if (uri) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return { ok: false, error: "The source link must be a full http or https URL." };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "The source link must be a full http or https URL." };
    }
  }

  return { ok: true };
}

/**
 * Where the object lives. The checksum names the file, so the same bytes always
 * land in the same place and a caller cannot choose a path — which rules out
 * traversal and collisions with another document's object.
 */
export function storagePathFor(sha256: string, mimeType: AllowedMimeType): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("A document path needs a lowercase hex sha256.");
  }
  return `${sha256.slice(0, 2)}/${sha256}.${EXTENSION_BY_MIME[mimeType]}`;
}
