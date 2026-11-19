import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { DOCUMENT_BUCKET } from "./validation";

/**
 * Handing a reader a source document.
 *
 * The bucket is closed to every client role, so the only way in is a signed URL
 * minted here with the service key. That makes authorisation this module's job,
 * and getting it wrong would expose licensed material.
 *
 * Rather than restate who may read what, the check reuses row-level security: the
 * document is fetched through the *caller's own* session. If RLS does not return
 * it, they may not have it, and no URL is minted. The policy stays the single
 * definition of access, and this cannot drift away from it.
 */

/**
 * Ten minutes. Browser PDF viewers stream with range requests and keep fetching
 * while the reader scrolls, so the link has to outlive the whole reading session,
 * not just the first byte — at two minutes a large prospectus failed mid-load.
 * Still short enough that a leaked URL is worth little, and every mint is logged.
 */
export const SIGNED_URL_TTL_SECONDS = 600;

export type SignedDocument =
  | { ok: true; url: string; title: string; mimeType: string; expiresInSeconds: number }
  | { ok: false; error: string };

export async function createSignedDocumentUrl(documentId: string): Promise<SignedDocument> {
  const user = await requireUser();
  if (user.mode !== "authenticated") {
    return { ok: false, error: "Sign in to open source documents." };
  }

  const supabase = await createClient();
  const { data: document, error } = await supabase
    .from("documents")
    .select("id, title, storage_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();

  // Indistinguishable on purpose: a reader must not learn that a document exists
  // but is withheld from them.
  if (error || !document) {
    return { ok: false, error: "That document is not available." };
  }

  if (!document.storage_path) {
    return { ok: false, error: "That document has no stored file." };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Document storage is not configured." };
  }

  const { data: signed, error: signError } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    return { ok: false, error: "That document could not be opened." };
  }

  // Licensed material: record who opened what. The blueprints require an audit
  // trail over source documents, and this is the only path to the bytes, so an
  // unrecorded access must not happen — if the log fails, the link is withheld
  // rather than handed out untracked.
  const { error: auditError } = await admin.from("audit_logs").insert({
    actor_user_id: user.id,
    action: "document.download",
    details: { document_id: document.id },
  });

  if (auditError) {
    return { ok: false, error: "That document could not be opened. Try again shortly." };
  }

  return {
    ok: true,
    url: signed.signedUrl,
    title: document.title,
    mimeType: document.mime_type,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  };
}
