"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/supabase/require-platform-admin";

function readText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function inviteUserAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const admin = createAdminClient();
  if (!admin) redirect("/admin/users?status=missing-secret");

  const email = readText(formData, "email").toLowerCase();
  const fullName = readText(formData, "fullName");
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length > 120) {
    redirect("/admin/users?status=invalid-input");
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: fullName ? { full_name: fullName } : {},
    ...(appUrl ? { redirectTo: `${appUrl}/auth/callback` } : {}),
  });
  if (error || !data.user) redirect("/admin/users?status=invite-failed");

  await admin.from("audit_logs").insert({
    actor_user_id: actor.userId,
    subject_user_id: data.user.id,
    action: "auth.user.invited",
    details: {},
  });
  redirect("/admin/users?status=invite-sent");
}

export async function setPlatformAdminAction(formData: FormData) {
  const actor = await requirePlatformAdmin();
  const admin = createAdminClient();
  if (!admin) redirect("/admin/users?status=missing-secret");

  const targetUserId = readText(formData, "userId");
  const operation = readText(formData, "operation");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    redirect("/admin/users?status=invalid-input");
  }

  if (operation === "grant") {
    const { error } = await admin.rpc("set_platform_admin", {
      target_user: targetUserId,
      actor_user: actor.userId,
      should_grant: true,
    });
    if (error) redirect("/admin/users?status=role-failed");
  } else if (operation === "revoke") {
    const { error } = await admin.rpc("set_platform_admin", {
      target_user: targetUserId,
      actor_user: actor.userId,
      should_grant: false,
    });
    if (error?.message.includes("last platform administrator")) redirect("/admin/users?status=last-admin");
    if (error) redirect("/admin/users?status=role-failed");
  } else {
    redirect("/admin/users?status=invalid-input");
  }
  redirect("/admin/users?status=role-updated");
}
