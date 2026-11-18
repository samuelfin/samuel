import { redirect } from "next/navigation";
import TerminalDashboard from "@/components/terminal-dashboard";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
export default async function HomePage() {
  if (!isSupabaseConfigured()) redirect("/login?setup=1");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  const userName = typeof data.claims.name === "string"
    ? data.claims.name
    : email.split("@")[0] || "SFI User";
  return <TerminalDashboard userName={userName} isPlatformAdmin={Boolean(isAdmin)} />;
}
