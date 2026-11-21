"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffRole } from "@/lib/auth/staff";
import { approvedCompanyId } from "@/lib/data/companies";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CLAIM, validateEditorialItem } from "@/lib/editorial/validation";

/**
 * Server actions for the editorial desk.
 *
 * Each re-checks the caller's role. A server action is a public endpoint, and
 * rendering a form only for staff proves nothing about who posts to it; the
 * database checks again inside the publish and withdraw functions, and the
 * triggers hold regardless of either.
 */

export interface EditorialActionState {
  error?: string;
  notice?: string;
  itemId?: string;
}

function text(form: FormData, field: string): string {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function explain(error: { code?: string; message?: string }, fallback: string): string {
  if (error.code === "42501") {
    return /may not/i.test(error.message ?? "") ? "You may not do that." : (error.message ?? fallback);
  }
  if (error.code === "23505") return "That web address is already taken by a live item.";
  if (error.code === "23503") return "That item or source no longer exists.";
  if (error.code === "23514") return error.message ?? fallback;
  return fallback;
}

/** Create a draft, or save changes to one. Drafts are freely editable. */
export async function saveDraftAction(
  _prev: EditorialActionState,
  form: FormData,
): Promise<EditorialActionState> {
  const staff = await requireStaffRole(["analyst", "editor"]);

  const kind = text(form, "kind");
  const aiAssisted = form.get("aiAssisted") === "on";

  const validation = validateEditorialItem({
    kind,
    slug: text(form, "slug"),
    title: text(form, "title"),
    standfirst: text(form, "standfirst"),
    body: text(form, "body"),
    video: text(form, "video"),
    guestName: text(form, "guestName"),
    aiAssisted,
    aiModel: text(form, "aiModel"),
  });
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  // Which company this is about, so it reaches that company's page. Resolved
  // against the register rather than trusted: a posted id is not evidence that
  // the poster may attach anything to it. Empty means "not about one company",
  // which a market-wide piece legitimately is.
  const submittedCompany = text(form, "companyId");
  const companyId = submittedCompany ? await approvedCompanyId(submittedCompany) : null;
  if (submittedCompany && !companyId) return { error: "That is not a company on the register." };

  const isVideo = kind === "video";
  const row = {
    kind,
    slug: text(form, "slug"),
    title: text(form, "title"),
    standfirst: text(form, "standfirst") || null,
    body_text: isVideo ? null : text(form, "body"),
    video_id: validation.videoId,
    guest_name: isVideo ? text(form, "guestName") : null,
    company_id: companyId,
    ai_assisted: aiAssisted,
    ai_model: aiAssisted ? text(form, "aiModel") : null,
  };

  const existing = text(form, "itemId");

  // Only touch the correction pointer when the form actually carried it.
  // Editing a correction draft through a form that omits these fields would
  // otherwise clear them, leaving a draft that collides with the item it was
  // meant to replace and can never be published — or deleted.
  const correctionFields =
    form.has("supersedesId") || form.has("correctionReason")
      ? {
          supersedes_id: text(form, "supersedesId") || null,
          correction_reason: text(form, "correctionReason") || null,
        }
      : {};

  if (existing) {
    const { error } = await admin
      .from("editorial_items")
      .update({ ...row, ...correctionFields })
      .eq("id", existing);
    if (error) return { error: explain(error, "The draft could not be saved.") };
    revalidatePath("/admin/editorial");
    return { notice: "Draft saved.", itemId: existing };
  }

  const { data, error } = await admin
    .from("editorial_items")
    // The author is the signed-in staff member, never a submitted field.
    .insert({ ...row, ...correctionFields, author_id: staff.userId })
    .select("id")
    .single();

  if (error) return { error: explain(error, "The draft could not be created.") };

  revalidatePath("/admin/editorial");
  // Move to the draft's own view. Staying in create mode would turn a second
  // submit into a duplicate draft on the same slug, and drafts cannot be deleted.
  redirect(`/admin/editorial?edit=${data.id as string}`);
}

export async function addCitationAction(
  _prev: EditorialActionState,
  form: FormData,
): Promise<EditorialActionState> {
  await requireStaffRole(["analyst", "editor"]);

  const itemId = text(form, "itemId");
  const claim = text(form, "claim");
  // "document:<uuid>" or "announcement:<uuid>", so one control picks both.
  const [sourceKind, sourceId] = text(form, "source").split(":");
  const page = text(form, "sourcePage");

  if (!itemId || !sourceId) return { error: "Choose a source." };
  if (!claim) return { error: "Say what this source supports." };
  if (claim.length > MAX_CLAIM) return { error: `Keep the claim under ${MAX_CLAIM} characters.` };
  if (sourceKind !== "document" && sourceKind !== "announcement") return { error: "Choose a source." };

  const pageNumber = page ? Number(page) : null;
  if (pageNumber !== null && (!Number.isInteger(pageNumber) || pageNumber < 1)) {
    return { error: "A page number must be a whole number of at least 1." };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.from("editorial_citations").insert({
    item_id: itemId,
    claim,
    document_id: sourceKind === "document" ? sourceId : null,
    announcement_id: sourceKind === "announcement" ? sourceId : null,
    source_page: sourceKind === "document" ? pageNumber : null,
  });

  if (error) return { error: explain(error, "The citation could not be added.") };

  revalidatePath("/admin/editorial");
  return { notice: "Source added.", itemId };
}

export async function removeCitationAction(
  _prev: EditorialActionState,
  form: FormData,
): Promise<EditorialActionState> {
  await requireStaffRole(["analyst", "editor"]);

  const citationId = text(form, "citationId");
  if (!citationId) return { error: "Choose a citation to remove." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.from("editorial_citations").delete().eq("id", citationId);
  if (error) return { error: explain(error, "The citation could not be removed.") };

  revalidatePath("/admin/editorial");
  return { notice: "Source removed." };
}

export async function publishEditorialAction(
  _prev: EditorialActionState,
  form: FormData,
): Promise<EditorialActionState> {
  const staff = await requireStaffRole(["analyst", "editor"]);

  const itemId = text(form, "itemId");
  if (!itemId) return { error: "Choose an item to publish." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("publish_editorial_item", {
    target_item: itemId,
    actor_user: staff.userId,
  });

  if (error) return { error: explain(error, "It could not be published.") };

  revalidatePath("/admin/editorial");
  revalidatePath("/research");
  return { notice: "Published. It is now visible to readers." };
}

export async function withdrawEditorialAction(
  _prev: EditorialActionState,
  form: FormData,
): Promise<EditorialActionState> {
  const staff = await requireStaffRole(["analyst", "editor"]);

  const itemId = text(form, "itemId");
  const reason = text(form, "reason");
  if (!itemId) return { error: "Choose an item to withdraw." };
  // Checked here for a readable message; the database enforces it regardless.
  if (!reason) return { error: "Say why it is being withdrawn." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("withdraw_editorial_item", {
    target_item: itemId,
    actor_user: staff.userId,
    reason,
  });

  if (error) return { error: explain(error, "The withdrawal could not be recorded.") };

  revalidatePath("/admin/editorial");
  revalidatePath("/research");
  return { notice: "Withdrawn. It stays visible to readers, marked as withdrawn." };
}
