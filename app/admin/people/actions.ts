"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffRole } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCompanyRole, validatePerson } from "@/lib/people/validation";

/**
 * Server actions for the leadership desk.
 *
 * Each re-checks the caller's role: a server action is a public endpoint, and
 * rendering a form only for analysts proves nothing about who posts to it. The
 * database checks again inside every function, which is what actually holds.
 *
 * These write statements about named private individuals, so the messages matter
 * more than usual — an analyst who cannot tell why a save was refused is an
 * analyst who will record the claim some other way.
 */

export interface PeopleActionState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function flag(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function explainPerson(error: { code?: string; message?: string; details?: string }): string {
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "42501") return "You may not edit the people register.";
  if (error.code === "23505") {
    // The identity decision, surfaced. Two people really do share a name, and
    // the desk has to say so rather than quietly coining "-2" for a real person.
    return "Another person already uses that web address. If this is a different individual of the same name, give them a distinct address.";
  }
  if (error.code === "23503") return "That person no longer exists.";
  if (error.code === "23514") {
    if (/nothing changed/i.test(detail)) return "Nothing changed, so there was nothing to record.";
    return error.message ?? "That is not allowed.";
  }
  return "The record could not be saved.";
}

function explainRole(error: { code?: string; message?: string; details?: string }): string {
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "42501") {
    if (/withdraw it and record the correct one/i.test(detail)) {
      return "An approved role cannot be moved to another person, company or office. Withdraw it and record the correct one, so the register says plainly that it was wrong.";
    }
    if (/withdrawn/i.test(detail)) {
      return "That role has been withdrawn. Record a new one rather than reviving it.";
    }
    if (/other than the person/i.test(detail)) {
      return "Someone other than the person who recorded this role has to review it.";
    }
    return "You may not record leadership.";
  }
  if (error.code === "23505") {
    return "That person already holds that office at that company from that date. Check the date, or edit the existing role.";
  }
  if (error.code === "23503") {
    if (/No such role:/i.test(detail)) return "That office is not in the catalogue.";
    if (/No such person/i.test(detail)) return "That person is not on the register.";
    if (/No such company/i.test(detail)) return "That company is not on the register.";
    return "Something this role refers to no longer exists.";
  }
  if (error.code === "23514") {
    if (/nothing changed/i.test(detail)) return "Nothing changed, so there was nothing to record.";
    // The function's own messages are already written for a person to read.
    return error.message ?? "That is not allowed.";
  }
  return "The role could not be saved.";
}

/** Paths a change to leadership can show up on. */
function revalidateLeadership(companySlug?: string | null, personSlug?: string | null) {
  revalidatePath("/admin/people");
  revalidatePath("/people");
  if (personSlug) revalidatePath(`/people/${personSlug}`);
  if (companySlug) revalidatePath(`/companies/${companySlug}`);
}

export async function savePersonAction(
  _prev: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const staff = await requireStaffRole(["analyst"]);

  const personId = field(form, "personId");
  if (personId && !UUID.test(personId)) return { error: "That is not a person we can edit." };

  const validation = validatePerson({
    fullName: field(form, "fullName"),
    slug: field(form, "slug"),
    honorific: field(form, "honorific"),
    changeReason: field(form, "changeReason"),
    isEdit: Boolean(personId),
  });
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { data: savedId, error } = await admin.rpc("upsert_person", {
    actor_user: staff.userId,
    p_full_name: validation.fullName,
    p_person_id: personId || null,
    p_slug: validation.slug,
    p_honorific: validation.honorific,
    p_change_reason: validation.changeReason,
  });

  if (error) return { error: explainPerson(error) };

  revalidateLeadership(null, validation.slug);

  // Creation moves to the new person's own view. Leaving the form in create mode
  // is how a second submit becomes a duplicate — and for a person a duplicate is
  // worse than a nuisance, because merging two records that turn out to be
  // different people is the one mistake this register must not make.
  if (!personId && typeof savedId === "string") {
    redirect(`/admin/people?person=${savedId}`);
  }

  return {
    notice: personId
      ? "Saved. The change is recorded in this person's history."
      : "Created, and waiting for review.",
  };
}

export async function reviewPersonAction(
  _prev: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const staff = await requireStaffRole(["analyst"]);

  const personId = field(form, "personId");
  const decision = field(form, "decision");
  const reason = field(form, "reason");

  if (!UUID.test(personId)) return { error: "Choose a person to review." };
  if (decision !== "approved" && decision !== "rejected") return { error: "Approve or reject it." };
  if (decision === "rejected" && !reason) return { error: "Say why the record is being rejected." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("review_person", {
    target_person: personId,
    actor_user: staff.userId,
    p_decision: decision,
    p_reason: reason || null,
  });

  if (error) return { error: explainPerson(error) };

  revalidateLeadership();
  return {
    notice:
      decision === "approved"
        ? "Approved. Their approved roles can now be seen."
        : "Rejected. Readers cannot see this person.",
  };
}

export async function saveRoleAction(
  _prev: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const staff = await requireStaffRole(["analyst"]);

  const roleId = field(form, "roleId");
  if (roleId && !UUID.test(roleId)) return { error: "That is not a role we can edit." };

  const validation = validateCompanyRole({
    personId: field(form, "personId"),
    companyId: field(form, "companyId"),
    roleCode: field(form, "roleCode"),
    roleTitle: field(form, "roleTitle"),
    isActing: flag(form, "isActing"),
    validFrom: field(form, "validFrom"),
    validTo: field(form, "validTo"),
    sourceKind: field(form, "sourceKind"),
    documentId: field(form, "documentId"),
    sourcePage: field(form, "sourcePage"),
    announcementId: field(form, "announcementId"),
    lastConfirmedOn: field(form, "lastConfirmedOn"),
    confirmSourceKind: field(form, "confirmSourceKind"),
    confirmDocumentId: field(form, "confirmDocumentId"),
    confirmSourcePage: field(form, "confirmSourcePage"),
    confirmAnnouncementId: field(form, "confirmAnnouncementId"),
    changeReason: field(form, "changeReason"),
    isEdit: Boolean(roleId),
  });
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("upsert_company_role", {
    actor_user: staff.userId,
    p_person_id: validation.personId,
    p_company_id: validation.companyId,
    p_role_code: validation.roleCode,
    p_valid_from: validation.validFrom,
    p_role_id: roleId || null,
    p_role_title: validation.roleTitle,
    p_is_acting: validation.isActing,
    p_valid_from_precision: validation.validFromPrecision,
    p_valid_to: validation.validTo,
    p_valid_to_precision: validation.validToPrecision,
    p_document_id: validation.documentId,
    p_source_page: validation.sourcePage,
    p_announcement_id: validation.announcementId,
    p_last_confirmed_on: validation.lastConfirmedOn,
    p_last_confirmed_document_id: validation.confirmDocumentId,
    p_last_confirmed_source_page: validation.confirmSourcePage,
    p_last_confirmed_announcement_id: validation.confirmAnnouncementId,
    p_change_reason: validation.changeReason,
  });

  if (error) return { error: explainRole(error) };

  revalidateLeadership();
  return {
    notice: roleId
      ? "Saved. The change is recorded in this role's history."
      : "Recorded, and waiting for review.",
  };
}

export async function reviewRoleAction(
  _prev: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const staff = await requireStaffRole(["analyst"]);

  const roleId = field(form, "roleId");
  const decision = field(form, "decision");
  const reason = field(form, "reason");

  if (!UUID.test(roleId)) return { error: "Choose a role to review." };
  if (decision !== "approved" && decision !== "rejected") return { error: "Approve or reject it." };
  if (decision === "rejected" && !reason) return { error: "Say why the role is being rejected." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("review_company_role", {
    target_role: roleId,
    actor_user: staff.userId,
    p_decision: decision,
    p_reason: reason || null,
  });

  if (error) return { error: explainRole(error) };

  revalidateLeadership();
  return {
    notice:
      decision === "approved"
        ? "Approved. It now shows on the company's page."
        : "Rejected. Readers cannot see it.",
  };
}

export async function withdrawRoleAction(
  _prev: PeopleActionState,
  form: FormData,
): Promise<PeopleActionState> {
  const staff = await requireStaffRole(["analyst"]);

  const roleId = field(form, "roleId");
  const reason = field(form, "reason");

  if (!UUID.test(roleId)) return { error: "Choose a role to withdraw." };
  if (!reason) return { error: "Say why the role is being withdrawn. It stays in the record." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("withdraw_company_role", {
    target_role: roleId,
    actor_user: staff.userId,
    p_reason: reason,
  });

  if (error) return { error: explainRole(error) };

  revalidateLeadership();
  return {
    notice: "Withdrawn. Readers no longer see it, and the reason is kept in the role's history.",
  };
}
