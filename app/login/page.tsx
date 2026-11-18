import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) redirect("/");
  }

  const params = await searchParams;
  return <LoginForm configured={configured} setupRequired={params.setup === "1"} />;
}
