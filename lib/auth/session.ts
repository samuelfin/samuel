import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Data access layer for the signed-in user. Pages, layouts and data services call
 * these helpers instead of reading Supabase auth directly, so the session check
 * happens next to every data read (not only in the layout, which does not
 * re-render on client navigation).
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isPlatformAdmin: boolean;
  /** "local_preview" exists only in development when Supabase is not configured. */
  mode: "authenticated" | "local_preview";
}

const LOCAL_PREVIEW_USER: SessionUser = {
  id: "local-preview",
  email: "",
  name: "Local preview",
  isPlatformAdmin: false,
  mode: "local_preview",
};

/** Local preview lets developers see the terminal before Supabase exists. Never in production. */
export function isLocalPreviewAllowed(): boolean {
  return process.env.NODE_ENV === "development" && !isSupabaseConfigured();
}

function readName(claims: Record<string, unknown>, email: string): string {
  const metadata = claims.user_metadata;
  if (metadata && typeof metadata === "object") {
    const fullName = (metadata as Record<string, unknown>).full_name;
    if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  }
  if (typeof claims.name === "string" && claims.name.trim()) return claims.name.trim();
  return email.split("@")[0] || "SFI user";
}

/** The current user, or null. Memoised per request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Auth-dependent output must never be prerendered at build time — otherwise a build
  // without Supabase settings would bake a setup redirect into static HTML.
  await connection();
  if (!isSupabaseConfigured()) return isLocalPreviewAllowed() ? LOCAL_PREVIEW_USER : null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  const email = typeof claims.email === "string" ? claims.email : "";
  return {
    id: claims.sub,
    email,
    name: readName(claims as Record<string, unknown>, email),
    isPlatformAdmin: isAdmin === true,
    mode: "authenticated",
  };
});

/** The current user; redirects to sign-in (or setup) when there is none. */
export async function requireUser(): Promise<SessionUser> {
  await connection();
  if (!isSupabaseConfigured() && !isLocalPreviewAllowed()) redirect("/login?setup=1");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
