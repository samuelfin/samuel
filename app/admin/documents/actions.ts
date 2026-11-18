"use server";

import { revalidatePath } from "next/cache";
import { requireStaffRole } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSignedDocumentUrl } from "@/lib/documents/storage";
import { uploadSourceDocument } from "@/lib/documents/upload";

/**
 * Server actions for the document desk.
 *
 * Every one of these re-checks the caller's role. A server action is a public
 * endpoint: that the button was only rendered for staff proves nothing about who
 * posts to it.
 */

export interface ActionState {
  error?: string;
  notice?: string;
  signedUrl?: string;
}

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
}

export async function uploadDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireStaffRole(["analyst", "editor"]);

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const result = await uploadSourceDocument({
    file,
    title: text(form, "title"),
    kind: text(form, "kind"),
    licenceClass: text(form, "licenceClass"),
    providerId: text(form, "providerId") || "issuer_ir",
    datasetId: text(form, "datasetId") || "companies.documents",
    sourceUri: text(form, "sourceUri") || null,
    publishedAt: text(form, "publishedAt") || null,
    periodEnd: text(form, "periodEnd") || null,
  });

  if (!result.ok) return { error: result.error };

  revalidatePath("/admin/documents");
  return { notice: "Uploaded. It is pending review and is not visible to readers." };
}

export async function reviewDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const staff = await requireStaffRole(["analyst", "editor"]);

  const documentId = text(form, "documentId");
  const decision = text(form, "decision");
  const reason = text(form, "reason");

  if (decision !== "approved" && decision !== "rejected") {
    return { error: "Choose approve or reject." };
  }
  // Checked here for a readable message; the database enforces it regardless.
  if (decision === "rejected" && !reason) {
    return { error: "Say why the document is being rejected." };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("review_document", {
    target_document: documentId,
    actor_user: staff.userId,
    new_status: decision,
    reason: reason || null,
  });

  if (error) {
    if (error.code === "42501") return { error: "You may not review documents." };
    if (error.code === "23514") return { error: "That decision is not available for this document." };
    return { error: "The decision could not be recorded." };
  }

  revalidatePath("/admin/documents");
  return { notice: decision === "approved" ? "Approved and published to readers." : "Rejected." };
}

/**
 * Mints a short-lived link to the stored file. The URL is returned to the caller
 * rather than redirected to, so the page can show how long it lasts.
 */
export async function openDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireStaffRole(["analyst", "editor"]);

  const signed = await createSignedDocumentUrl(text(form, "documentId"));
  if (!signed.ok) return { error: signed.error };

  return {
    signedUrl: signed.url,
    notice: `Link opens "${signed.title}" and expires in ${signed.expiresInSeconds} seconds.`,
  };
}
