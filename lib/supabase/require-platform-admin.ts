import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
export async function requirePlatformAdmin() {
  if (!isSupabaseConfigured()) redirect("/login?setup=1");
  const supabase = await createClient();
  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) redirect("/login");
  const { data: isAdmin, error: roleError } = await supabase.rpc("is_platform_admin");
  if (roleError || !isAdmin) redirect("/");
  return {
    userId: claims.claims.sub,
    email: typeof claims.claims.email === "string" ? claims.claims.email : "",
    name: typeof claims.claims.name === "string" ? claims.claims.name : "SFI Administrator",
  };
}
