import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, requireUser } from "@/lib/auth/session";

/**
 * Internal staff roles, held separately from platform administration so that an
 * editor does not acquire control of licence terms or admin grants.
 *
 * Roles are read through the user's own session, so row-level security decides
 * what is visible: a person sees the roles they hold and nothing else.
 */

// financial_analyst is deliberately distinct from analyst: the analyst role runs
// the company and leadership registers, and entering or checking a balance sheet
// is a different job. A role missing from this list is filtered out of
// getStaffRoles, so whoever held it would appear to hold nothing.
export const STAFF_ROLES = ["editor", "analyst", "fact_checker", "publisher", "financial_analyst"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles the current user holds. Empty for local preview and for readers. */
export const getStaffRoles = cache(async (): Promise<StaffRole[]> => {
  const user = await getSessionUser();
  if (!user || user.mode !== "authenticated") return [];

  const supabase = await createClient();
  // Scoped to this user explicitly. The policy also admits a platform admin to the
  // whole roster, so without this filter an admin's own role list would be every
  // staff member's roles — and anything gating on roles alone would be wrong.
  const { data, error } = await supabase.from("platform_staff").select("role").eq("user_id", user.id);
  if (error || !data) return [];
  return data
    .map((row) => row.role as StaffRole)
    .filter((role) => (STAFF_ROLES as readonly string[]).includes(role));
});

export interface StaffContext {
  userId: string;
  email: string;
  name: string;
  roles: StaffRole[];
  isPlatformAdmin: boolean;
}

/**
 * Guard for staff pages and actions. A platform administrator is admitted for
 * oversight, but holds no staff role unless one was granted.
 */
export async function requireStaffRole(allowed: readonly StaffRole[]): Promise<StaffContext> {
  const user = await requireUser();
  if (user.mode !== "authenticated") redirect("/");

  const roles = await getStaffRoles();
  const permitted = user.isPlatformAdmin || roles.some((role) => allowed.includes(role));
  if (!permitted) redirect("/");

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    roles,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}
