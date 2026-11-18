import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";

/**
 * Server-side guard for administration pages and actions. Local preview users are
 * never administrators, so /admin always requires a real Supabase session.
 */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  if (user.mode !== "authenticated" || !user.isPlatformAdmin) redirect("/");
  return { userId: user.id, email: user.email, name: user.name };
}
