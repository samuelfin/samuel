import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { CompanyForm, CompanyRow } from "@/components/admin/company-desk";
import { requireStaffRole } from "@/lib/auth/staff";
import {
  getCompanyForDesk,
  listCompaniesForDesk,
  listProfileVersions,
  listSectors,
  LISTING_STATUS_LABELS,
  type ListingStatus,
} from "@/lib/data/companies";

export const metadata: Metadata = { title: "Companies" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatWat(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

function statusLabel(status: string): string {
  return LISTING_STATUS_LABELS[status as ListingStatus] ?? status;
}

export default async function CompanyDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const staff = await requireStaffRole(["analyst"]);
  const { edit } = await searchParams;
  const editId = edit && UUID.test(edit) ? edit : undefined;

  const [companies, sectors] = await Promise.all([listCompaniesForDesk(), listSectors()]);
  const editing = editId ? await getCompanyForDesk(editId) : null;
  const history = editing ? await listProfileVersions(editing.id) : [];

  const pending = companies.filter((c) => c.reviewStatus === "pending");
  const drifted = companies.filter((c) => c.hasUnreviewedChanges);
  const approved = companies.filter((c) => c.reviewStatus === "approved");

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">S<span>•</span></span>
          <span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span>
        </Link>
        <div className="admin-context">SFI PLATFORM <span>DESK</span></div>
        <div className="admin-nav-label">RESEARCH DESK</div>
        <Link className="admin-nav active" href="/admin/companies"><i>▢</i> Companies</Link>
        <Link className="admin-nav" href="/admin/documents"><i>▤</i> Document review</Link>
        <Link className="admin-nav" href="/admin/announcements"><i>◈</i> Announcements</Link>
        <Link className="admin-nav" href="/admin/editorial"><i>✎</i> Research</Link>
        {staff.isPlatformAdmin ? <Link className="admin-nav" href="/admin"><i>▦</i> Administration</Link> : null}
        <Link className="admin-nav" href="/companies"><i>▣</i> Company directory</Link>
        <div className="admin-sidebar-foot">
          <span className="secure-indicator" /> STAFF SESSION ACTIVE
          <br />
          <small>Roles are verified server-side on every action.</small>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><span>Samuel Terminal</span><b>/</b><strong>Companies</strong></div>
          <div className="admin-user">
            <span className="admin-avatar">{staff.name.slice(0, 1).toUpperCase()}</span>
            <span>{staff.name}</span>
            <form action={signOut}><button>Sign out</button></form>
          </div>
        </header>

        <div className="admin-content">
          <div className="admin-title-row">
            <div>
              <div className="admin-eyebrow">REGISTRY · SFI</div>
              <h1>Companies<span>.</span></h1>
              <p>
                Who the company is, what it is called, and where to find it. Everything else —
                documents, announcements, research and financials — hangs off these records.
              </p>
            </div>
            <span className="admin-role-pill">
              {staff.roles.length ? staff.roles.join(" · ").toUpperCase() : "PLATFORM ADMIN"}
            </span>
          </div>

          <div className="admin-panels">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>{editing ? "EDIT" : "ADD"}</span>
                  <h2>{editing ? editing.name : "A company"}</h2>
                </div>
                {editing ? (
                  <Link className="correct-link" href="/admin/companies">Add another instead</Link>
                ) : (
                  <span className="admin-count">{companies.length} ON REGISTER</span>
                )}
              </div>
              {/* Keyed to the company, so switching between two edits remounts the
                  form rather than carrying the first one's values into the second —
                  the stale-state defect found in the editorial desk at stage 2c. */}
              <CompanyForm key={editing?.id ?? "new"} company={editing ?? undefined} sectors={sectors} />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>REVIEW</span><h2>Waiting to be checked</h2></div>
                <span className="admin-count">{pending.length + drifted.length}</span>
              </div>
              {pending.length === 0 && drifted.length === 0 ? (
                <p className="panel-note">
                  Nothing is waiting. A new company starts here, and an approved one returns if its
                  profile changes.
                </p>
              ) : (
                <div className="review-list">
                  {[...pending, ...drifted].map((company) => (
                    <CompanyRow company={company} key={company.id} />
                  ))}
                </div>
              )}
              <p className="panel-note">
                Self-review is recorded rather than blocked while the desk is one person. An edit to
                an approved company keeps it in the directory — a corrected typo must not delist a
                company — but the review is shown as behind until someone checks the new version.
              </p>
            </section>
          </div>

          {editing && history.length > 0 ? (
            <section className="admin-panel audit-panel">
              <div className="admin-panel-heading">
                <div><span>HISTORY</span><h2>How this profile has changed</h2></div>
                <span className="admin-count">
                  {history.length} VERSION{history.length === 1 ? "" : "S"}
                </span>
              </div>
              <div className="review-list">
                {history.map((version) => (
                  <article className="review-row" key={version.version}>
                    <div className="review-row-main">
                      <strong>Version {version.version} · {version.name}</strong>
                      <p className="review-row-meta">
                        /companies/{version.slug} · {statusLabel(version.listingStatus)}
                        {version.symbol ? ` · ${version.symbol}` : ""}
                        {version.listingBoard ? ` · ${version.listingBoard}` : ""}
                      </p>
                      <p className="review-row-meta">
                        {formatWat(version.changedAt)}
                        {version.changeReason ? ` — ${version.changeReason}` : ""}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <p className="panel-note">
                Nothing here is ever edited or deleted. A company is never removed either; a
                delisting is a status, so the record of what was once listed survives.
              </p>
            </section>
          ) : null}

          <section className="admin-panel audit-panel">
            <div className="admin-panel-heading">
              <div><span>REGISTER</span><h2>In the directory</h2></div>
              <span className="admin-count">{approved.length}</span>
            </div>
            {approved.length === 0 ? (
              <p className="panel-note">
                No company has been approved yet, so the directory readers see is empty.
              </p>
            ) : (
              <div className="review-list">
                {approved.map((company) => (
                  <CompanyRow company={company} key={company.id} />
                ))}
              </div>
            )}
          </section>

          <footer className="admin-footer">
            <span>Samuel Terminal <b>·</b> Research desk</span>
            <span>Role-gated access <i /></span>
          </footer>
        </div>
      </section>
    </main>
  );
}
