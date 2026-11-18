import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function AdminPage() {
  if (!isSupabaseConfigured()) redirect("/login?setup=1");

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error || !isAdmin) redirect("/");

  const userId = claims.claims.sub;
  const displayName = typeof claims.claims.name === "string" ? claims.claims.name : "SFI Administrator";

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link>
        <div className="admin-context">SFI PLATFORM <span>ADMIN</span></div>
        <div className="admin-nav-label">CONTROL ROOM</div>
        <Link className="admin-nav active" href="/admin"><i>▦</i> Overview</Link>
        <Link className="admin-nav" href="/admin/users"><i>♙</i> User management</Link>
        <a className="admin-nav disabled" href="#data" aria-disabled="true"><i>◈</i> Data providers <small>Later</small></a>
        <a className="admin-nav disabled" href="#research" aria-disabled="true"><i>▤</i> Research review <small>Later</small></a>
        <a className="admin-nav disabled" href="#system" aria-disabled="true"><i>⚙</i> System settings <small>Later</small></a>
        <div className="admin-sidebar-foot"><span className="secure-indicator" /> ADMIN SESSION ACTIVE<br /><small>Access is role-verified server-side.</small></div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar"><div><span>Samuel Terminal</span><b>/</b><strong>Administration</strong></div><div className="admin-user"><span className="admin-avatar">{displayName.slice(0, 1).toUpperCase()}</span><span>{displayName}</span><form action={signOut}><button>Sign out</button></form></div></header>
        <div className="admin-content">
          <div className="admin-title-row"><div><div className="admin-eyebrow">PLATFORM OPERATIONS · SFI</div><h1>Administration<span>.</span></h1><p>Manage access, source readiness and platform controls.</p></div><span className="admin-role-pill">PLATFORM ADMIN</span></div>
          <div className="admin-setup-callout"><span className="admin-info">i</span><div><strong>Supabase access control is active for this workspace.</strong><p>Invite teammates and manage platform access. Market data remains unavailable until provider terms and credentials are configured.</p></div><Link href="/admin/users">Manage users <span>→</span></Link></div>
          <div className="admin-status-grid">
            <article className="admin-status-card"><span className="admin-card-icon">◉</span><div><small>AUTHENTICATION</small><strong>Supabase Auth</strong><span className="connection-state"><i /> Configured by environment</span></div></article>
            <article className="admin-status-card"><span className="admin-card-icon">▤</span><div><small>DATABASE</small><strong>PostgreSQL</strong><span className="connection-state"><i /> Migration ready</span></div></article>
            <article className="admin-status-card"><span className="admin-card-icon">◈</span><div><small>MARKET DATA</small><strong>No providers connected</strong><span className="connection-state muted"><i /> No licensed feed configured</span></div></article>
          </div>
          <div className="admin-panels">
            <section className="admin-panel"><div className="admin-panel-heading"><div><span>ACCESS CONTROL</span><h2>Platform roles</h2></div><span className="admin-count">3 ROLES</span></div><div className="role-list"><div className="role-row"><span className="role-symbol owner">A</span><div><strong>Platform administrator</strong><p>System-level controls and approvals</p></div><span className="role-scope">PLATFORM</span></div><div className="role-row"><span className="role-symbol analyst">R</span><div><strong>Research analyst</strong><p>Research and data review permissions</p></div><span className="role-scope">WORKSPACE</span></div><div className="role-row"><span className="role-symbol viewer">V</span><div><strong>Viewer</strong><p>Read-only access to permitted content</p></div><span className="role-scope">WORKSPACE</span></div></div><p className="panel-note">Role enforcement is backed by PostgreSQL row-level security policies.</p></section>
            <section className="admin-panel"><div className="admin-panel-heading"><div><span>DATA OPERATIONS</span><h2>Provider readiness</h2></div><Link href="/">View terminal <span>→</span></Link></div><div className="provider-empty"><span className="provider-orbit">◌</span><strong>No provider integrations configured</strong><p>Market and macro data stay unavailable until SFI approves provider terms, credentials and redistribution rights.</p><span className="provider-gate">DATA ACCESS GATE · CLOSED</span></div></section>
          </div>
          <section className="admin-panel audit-panel"><div className="admin-panel-heading"><div><span>SECURITY</span><h2>Session and audit controls</h2></div><span className="admin-count">FOUNDATION</span></div><div className="audit-strip"><div><small>AUTHENTICATED USER</small><strong>{displayName}</strong></div><div><small>USER ID</small><code>{userId}</code></div><div><small>ACCESS CHECK</small><strong className="access-confirmed"><i /> Server verified</strong></div></div></section>
          <footer className="admin-footer"><span>Samuel Terminal <b>·</b> SFI Administration</span><span>Role-gated access <i /></span></footer>
        </div>
      </section>
    </main>
  );
}
