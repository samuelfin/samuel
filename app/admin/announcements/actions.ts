"use server";

import { revalidatePath } from "next/cache";
import { requireStaffRole } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateAnnouncement } from "@/lib/announcements/validation";

/**
 * Server actions for the announcement desk.
 *
 * Each re-checks the caller's role: a server action is a public endpoint, and
 * rendering a form only for staff proves nothing about who posts to it. The
 * database checks again inside publish_announcement and withdraw_announcement,
 * which is what actually holds.
 */

export interface AnnouncementActionState {
  error?: string;
  notice?: string;
}

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** Messages worth showing a person, rather than a SQLSTATE. */
function explain(error: { code?: string; message?: string }): string {
  if (error.code === "42501") return "You may not publish announcements.";
  if (error.code === "23505") return "That document already has a live announcement.";
  if (error.code === "23503") return "That document or announcement no longer exists.";
  if (error.code === "23514") {
    if (/source link/i.test(error.message ?? "")) {
      return "That document has no public source link, so readers could not be shown where it came from. Add the link to the document first.";
    }
    if (/approved document/i.test(error.message ?? "")) {
      return "That document is not approved, so nothing may be published from it.";
    }
    return error.message ?? "That is not allowed.";
  }
  return "The announcement could not be saved.";
}

export async function publishAnnouncementAction(
  _prev: AnnouncementActionState,
  form: FormData,
): Promise<AnnouncementActionState> {
  const staff = await requireStaffRole(["analyst", "editor"]);

  const documentId = text(form, "documentId");
  const supersedesId = text(form, "supersedesId");
  const correctionReason = text(form, "correctionReason");

  const validation = validateAnnouncement({
    documentId,
    category: text(form, "category"),
    headline: text(form, "headline"),
    announcedAt: text(form, "announcedAt"),
    summary: text(form, "summary"),
    isCorrection: Boolean(supersedesId),
    correctionReason,
  });
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("publish_announcement", {
    actor_user: staff.userId,
    p_document_id: documentId,
    p_category: text(form, "category"),
    p_headline: text(form, "headline"),
    p_announced_at: validation.announcedAtIso,
    p_summary: text(form, "summary") || null,
    p_is_price_sensitive: form.get("isPriceSensitive") === "on",
    // Deliberately not read from the form. The desk renders no issuer selector,
    // and accepting one here would let a poster attach an announcement to any
    // company. A validated selector arrives with the company directory.
    p_company_id: null,
    p_supersedes_id: supersedesId || null,
    p_correction_reason: correctionReason || null,
  });

  if (error) return { error: explain(error) };

  revalidatePath("/admin/announcements");
  revalidatePath("/news");
  return {
    notice: supersedesId
      ? "Correction published. Readers see the corrected version, labelled as corrected."
      : "Published. It is now visible in the terminal.",
  };
}

export async function withdrawAnnouncementAction(
  _prev: AnnouncementActionState,
  form: FormData,
): Promise<AnnouncementActionState> {
  const staff = await requireStaffRole(["analyst", "editor"]);

  const announcementId = text(form, "announcementId");
  const reason = text(form, "reason");

  if (!announcementId) return { error: "Choose an announcement to withdraw." };
  // Checked here for a readable message; the database enforces it regardless.
  if (!reason) return { error: "Say why the announcement is being withdrawn." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("withdraw_announcement", {
    target_announcement: announcementId,
    actor_user: staff.userId,
    reason,
  });

  if (error) {
    if (error.code === "42501") return { error: "You may not withdraw announcements." };
    if (error.code === "23514") return { error: error.message ?? "That announcement cannot be withdrawn." };
    return { error: "The withdrawal could not be recorded." };
  }

  revalidatePath("/admin/announcements");
  revalidatePath("/news");
  return { notice: "Withdrawn. It stays visible to readers, marked as withdrawn." };
}
