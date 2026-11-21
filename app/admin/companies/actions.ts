"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffRole } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCompany } from "@/lib/companies/validation";

/**
 * Server actions for the company registry desk.
 *
 * Each re-checks the caller's role: a server action is a public endpoint, and
 * rendering a form only for staff proves nothing about who posts to it. The
 * database checks again inside upsert_company_profile and review_company, which
 * is what actually holds.
 */

export interface CompanyActionState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Messages worth showing a person, rather than a SQLSTATE. */
function explain(error: { code?: string; message?: string; details?: string }): string {
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;

  if (error.code === "42501") return "You may not edit company profiles.";
  if (error.code === "23505") {
    // Two different collisions reach here; saying which one is the whole point.
    if (/slug/i.test(detail)) return "Another company already uses that web address. Choose a different one.";
    if (/instrument_identifiers|ngx_symbol/i.test(detail)) {
      return "Another company already holds that NGX symbol. Check it, or retire it from that company first.";
    }
    return "That conflicts with a company already on the register.";
  }
  if (error.code === "23503") {
    if (/sector/i.test(detail)) return "That sector is not in the catalogue.";
    return "That company no longer exists.";
  }
  if (error.code === "23514") {
    if (/nothing changed/i.test(detail)) return "Nothing changed, so there was nothing to record.";
    // These come from the function and are already written for a person.
    return error.message ?? "That is not allowed.";
  }
  return "The profile could not be saved.";
}

export async function saveCompanyAction(
  _prev: CompanyActionState,
  form: FormData,
): Promise<CompanyActionState> {
  const staff = await requireStaffRole(["analyst"]);

  const companyId = field(form, "companyId");
  if (companyId && !UUID.test(companyId)) return { error: "That is not a company we can edit." };

  const validation = validateCompany({
    name: field(form, "name"),
    slug: field(form, "slug"),
    listingStatus: field(form, "listingStatus"),
    legalName: field(form, "legalName"),
    sectorId: field(form, "sectorId"),
    industry: field(form, "industry"),
    description: field(form, "description"),
    website: field(form, "website"),
    listingBoard: field(form, "listingBoard"),
    ngxSymbol: field(form, "ngxSymbol"),
    changeReason: field(form, "changeReason"),
    isEdit: Boolean(companyId),
  });
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { data: savedId, error } = await admin.rpc("upsert_company_profile", {
    actor_user: staff.userId,
    p_name: validation.name,
    p_slug: validation.slug,
    p_listing_status: validation.listingStatus,
    p_company_id: companyId || null,
    p_legal_name: validation.legalName,
    p_sector_id: validation.sectorId,
    p_industry: validation.industry,
    p_description: validation.description,
    p_website: validation.website,
    p_listing_board: validation.listingBoard,
    p_ngx_symbol: validation.ngxSymbol,
    p_change_reason: validation.changeReason,
  });

  if (error) return { error: explain(error) };

  revalidatePath("/admin/companies");
  revalidatePath("/companies");
  revalidatePath(`/companies/${validation.slug}`);

  // Creation moves to the new company's own view. Leaving the form in create
  // mode is how a second submit becomes a duplicate — the mistake stage 2c made
  // with editorial drafts. redirect() throws, so nothing after it runs.
  if (!companyId && typeof savedId === "string") {
    redirect(`/admin/companies?edit=${savedId}`);
  }

  return {
    notice: companyId
      ? "Saved. The change is recorded in the company's history."
      : "Created, and waiting for review.",
  };
}

export async function reviewCompanyAction(
  _prev: CompanyActionState,
  form: FormData,
): Promise<CompanyActionState> {
  const staff = await requireStaffRole(["analyst"]);

  const companyId = field(form, "companyId");
  const decision = field(form, "decision");
  const reason = field(form, "reason");

  if (!UUID.test(companyId)) return { error: "Choose a company to review." };
  if (decision !== "approved" && decision !== "rejected") return { error: "Approve or reject it." };
  // Checked here for a readable message; the database enforces it regardless.
  if (decision === "rejected" && !reason) return { error: "Say why the profile is being rejected." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("review_company", {
    target_company: companyId,
    actor_user: staff.userId,
    p_decision: decision,
    p_reason: reason || null,
  });

  if (error) {
    if (error.code === "42501") {
      if (/other than the person/i.test(error.message ?? "")) {
        return { error: "Someone other than the person who wrote this profile has to review it." };
      }
      return { error: "You may not review company profiles." };
    }
    if (error.code === "23514") return { error: error.message ?? "That company cannot be reviewed." };
    if (error.code === "23503") return { error: "That company no longer exists." };
    return { error: "The review could not be recorded." };
  }

  revalidatePath("/admin/companies");
  revalidatePath("/companies");
  return {
    notice:
      decision === "approved" ? "Approved. It is now in the directory." : "Rejected. Readers cannot see it.",
  };
}
