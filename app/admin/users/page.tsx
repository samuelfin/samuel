import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/supabase/require-platform-admin";
import { inviteUserAction, setPlatformAdminAction } from "@/app/admin/actions";

const statusMessages: Record<string, string> = {
  "invite-sent": "Invitation email sent.",
  "invite-failed": "The invitation could not be sent. Check the Auth email configuration and try again.",
  "invalid-input": "Review the email, name or user selection and try again.",
  "role-failed": "The role change could not be saved.",
  "role-updated": "Platform administrator access updated.",
  "last-admin": "The last platform administrator cannot be removed.",
};

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const actor = await requirePlatformAdmin();
  const params = await searchParams;
  const admin = createAdminClient();

  if (!admin) {
    return (
      <main className="admin-shell"><aside className="admin-sidebar"><Link className="brand" href="/"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link><div className="admin-context">SFI PLATFORM <span>ADMIN</span></div><Link className="admin-nav active" href="/admin/users">♙ &nbsp; User access</Link></aside><section className="admin-main"><header className="admin-topbar"><div><Link href="/admin">Administration</Link><b>/</b><strong>User access</strong></div><span className="admin-role-pill">PLATFORM ADMIN</span></header><div className="admin-content"><div className="admin-title-row"><div><div className="admin-eyebrow">IDENTITY · ACCESS CONTROL</div><h1>User access<span>.</span></h1><p>Invite colleagues and manage platform-level access.</p></div></div><div className="admin-setup-callout"><span className="admin-info">i</span><div><strong>Add the server-only Supabase secret to enable invitations.</strong><p>Set <code>SUPABASE_SECRET_KEY</code> in the local environment. It is used only by server actions and must never use a NEXT_PUBLIC_ prefix.</p></div></div><Link className="admin-back-link" href="/admin">← Back to administration</Link></div></section></main>
    );
  }

  const [{ data: usersData, error: usersError }, { data: rolesData, error: rolesError }, { data: auditData, error: auditError }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 100 }),
    admin.from("platform_admins").select("user_id, granted_at, granted_by"),
    admin.from("audit_logs").select("id, action, actor_user_id, subject_user_id, created_at").order("created_at", { ascending: false }).limit(8),
  ]);

  const adminIds = new Set((rolesData ?? []).map((role) => role.user_id));
  const users = usersData?.users ?? [];
  const message = params.status ? statusMessages[params.status] : undefined;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar"><Link className="brand" href="/"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link><div className="admin-context">SFI PLATFORM <span>ADMIN</span></div><div className="admin-nav-label">CONTROL ROOM</div><Link className="admin-nav" href="/admin">▦ &nbsp; Overview</Link><Link className="admin-nav active" href="/admin/users">♙ &nbsp; User access</Link><div className="admin-sidebar-foot"><span className="secure-indicator" /> ADMIN SESSION ACTIVE<br /><small>Verified on the server for each action.</small></div></aside>
      <section className="admin-main">
        <header className="admin-topbar"><div><Link href="/admin">Administration</Link><b>/</b><strong>User access</strong></div><div className="admin-user"><span>{actor.name}</span><span className="admin-role-pill">PLATFORM ADMIN</span></div></header>
        <div className="admin-content">
          <div className="admin-title-row"><div><div className="admin-eyebrow">IDENTITY · ACCESS CONTROL</div><h1>User access<span>.</span></h1><p>Invite team members and manage platform-level administrator access.</p></div><span className="admin-count">{users.length} USERS SHOWN</span></div>
          {message && <div className={`admin-flash ${params.status?.includes("failed") || params.status === "last-admin" ? "error" : ""}`} role="status">{message}</div>}
          {(rolesError || auditError) && <div className="admin-flash error" role="status">Some access history could not be loaded. Check the Phase 1 database migration and server key.</div>}
          <section className="admin-panel invite-panel"><div className="admin-panel-heading"><div><span>INVITE ONLY</span><h2>Invite a team member</h2></div><span className="admin-count">EMAIL</span></div><form className="invite-form" action={inviteUserAction}><label>Email address<input name="email" type="email" required maxLength={254} placeholder="name@company.com" /></label><label>Full name <small>Optional</small><input name="fullName" maxLength={120} placeholder="Name shown in the workspace" /></label><button className="invite-submit">Send invitation <span>→</span></button></form><p className="panel-note">Public registration is disabled. Invitees must confirm their email before accessing the terminal.</p></section>
          <section className="admin-panel user-list-panel"><div className="admin-panel-heading"><div><span>AUTHENTICATED ACCOUNTS</span><h2>Users</h2></div><span className="admin-count">FIRST 100</span></div><div className="user-table-wrap"><table className="user-table"><thead><tr><th>USER</th><th>STATUS</th><th>JOINED</th><th>PLATFORM ROLE</th></tr></thead><tbody>{usersError ? <tr><td colSpan={4} className="table-empty">Could not load accounts. Check the Supabase server secret and Auth configuration.</td></tr> : users.map((user) => { const isAdmin = adminIds.has(user.id); const metadataName = user.user_metadata?.full_name; const displayName = typeof metadataName === "string" ? metadataName : user.email || "Unnamed user"; return <tr key={user.id}><td><strong>{displayName}</strong><small>{user.email ?? user.id}</small></td><td><span className={`user-state ${user.email_confirmed_at ? "confirmed" : "pending"}`}>{user.email_confirmed_at ? "Confirmed" : "Invited"}</span></td><td>{new Date(user.created_at).toLocaleDateString("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" })}</td><td>{isAdmin ? <form action={setPlatformAdminAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="operation" value="revoke" /><button className="role-action revoke" disabled={adminIds.size <= 1}>Revoke admin</button></form> : <form action={setPlatformAdminAction}><input type="hidden" name="userId" value={user.id} /><input type="hidden" name="operation" value="grant" /><button className="role-action">Make admin</button></form>}</td></tr>; })}{!usersError && users.length === 0 && <tr><td colSpan={4} className="table-empty">No authenticated users yet. Invite the first team member above.</td></tr>}</tbody></table></div><p className="panel-note">Only platform administrators can grant this role. The last active platform administrator cannot be revoked.</p></section>
          <section className="admin-panel audit-panel"><div className="admin-panel-heading"><div><span>RECENT ACTIVITY</span><h2>Access audit</h2></div><span className="admin-count">LATEST 8</span></div><div className="audit-list">{(auditData ?? []).map((entry) => <div className="audit-list-row" key={entry.id}><span className="audit-event-dot" /><strong>{entry.action}</strong><code>{entry.subject_user_id ?? "Invitation"}</code><time>{new Date(entry.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</time></div>)}{!auditError && (!auditData || auditData.length === 0) && <p className="table-empty">Access changes will appear here.</p>}</div></section>
          <Link className="admin-back-link" href="/admin">← Back to administration</Link>
        </div>
      </section>
    </main>
  );
}
