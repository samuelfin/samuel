import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { PersonForm, PersonRow, RoleForm, RoleRow } from "@/components/admin/leadership-desk";
import { requireStaffRole } from "@/lib/auth/staff";
import { listCompaniesForDesk } from "@/lib/data/companies";
import { listCitableSources } from "@/lib/data/editorial";
import {
  getPersonForDesk,
  getRoleForDesk,
  listPeopleForDesk,
  listPersonVersions,
  listRoleCatalogue,
  listRoleVersions,
  listRolesForDesk,
} from "@/lib/data/people";
import { formatTenure, isConfirmationStale } from "@/lib/people/validation";

export const metadata: Metadata = { title: "Leadership" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatWat(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

export default async function LeadershipDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ person?: string; role?: string }>;
}) {
  const staff = await requireStaffRole(["analyst"]);
  const { person: personParam, role: roleParam } = await searchParams;
  const personId = personParam && UUID.test(personParam) ? personParam : undefined;
  const roleId = roleParam && UUID.test(roleParam) ? roleParam : undefined;

  const [people, roles, offices, companies, sources] = await Promise.all([
    listPeopleForDesk(),
    listRolesForDesk(),
    listRoleCatalogue(),
    listCompaniesForDesk(),
    listCitableSources(),
  ]);

  const editingPerson = personId ? await getPersonForDesk(personId) : null;
  const editingRole = roleId ? await getRoleForDesk(roleId) : null;
  const personHistory = editingPerson ? await listPersonVersions(editingPerson.id) : [];
  const roleHistory = editingRole ? await listRoleVersions(editingRole.id) : [];

  const live = roles.filter((r) => !r.withdrawnAt);
  const pendingPeople = people.filter((p) => p.reviewStatus === "pending");
  const pendingRoles = live.filter((r) => r.reviewStatus === "pending");
  const stale = live.filter(
    (r) => r.reviewStatus === "approved" && isConfirmationStale(r.validTo, r.lastConfirmedOn),
  );
  const approvedRoles = live.filter((r) => r.reviewStatus === "approved");
  const withdrawn = roles.filter((r) => r.withdrawnAt);

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">S<span>•</span></span>
          <span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span>
        </Link>
        <div className="admin-context">SFI PLATFORM <span>DESK</span></div>
        <div className="admin-nav-label">RESEARCH DESK</div>
        <Link className="admin-nav" href="/admin/companies"><i>▢</i> Companies</Link>
        <Link className="admin-nav active" href="/admin/people"><i>☰</i> Leadership</Link>
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
          <div><span>Samuel Terminal</span><b>/</b><strong>Leadership</strong></div>
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
              <h1>Leadership<span>.</span></h1>
              <p>
                Who runs these companies, and since when. Every office cites the filing page or the
                announcement that evidences it, because this is the one part of the register that
                makes claims about named private individuals.
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
                  <span>{editingPerson ? "EDIT" : "ADD"}</span>
                  <h2>{editingPerson ? editingPerson.fullName : "A person"}</h2>
                </div>
                {editingPerson ? (
                  <Link className="correct-link" href="/admin/people">Add another instead</Link>
                ) : (
                  <span className="admin-count">{people.length} ON REGISTER</span>
                )}
              </div>
              {/* Keyed to the person, so switching between two edits remounts the
                  form rather than carrying the first one's values into the second —
                  the stale-state defect found in the editorial desk at stage 2c. */}
              <PersonForm key={editingPerson?.id ?? "new-person"} person={editingPerson ?? undefined} />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>{editingRole ? "EDIT" : "ADD"}</span>
                  <h2>{editingRole ? "This office" : "An office held"}</h2>
                </div>
                {editingRole ? (
                  <Link className="correct-link" href="/admin/people">Add another instead</Link>
                ) : (
                  <span className="admin-count">{live.length} RECORDED</span>
                )}
              </div>
              {people.length === 0 ? (
                <p className="panel-note">
                  Add a person first. An office is held by somebody, so there is nothing to record
                  until there is a name to record it against.
                </p>
              ) : (
                <RoleForm
                  key={editingRole?.id ?? "new-role"}
                  role={editingRole ?? undefined}
                  people={people}
                  companies={companies}
                  offices={offices}
                  sources={sources}
                  defaultPersonId={editingPerson?.id}
                />
              )}
            </section>
          </div>

          <div className="admin-panels">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>REVIEW</span><h2>Waiting to be checked</h2></div>
                <span className="admin-count">{pendingPeople.length + pendingRoles.length}</span>
              </div>
              {pendingPeople.length === 0 && pendingRoles.length === 0 ? (
                <p className="panel-note">
                  Nothing is waiting. A new person or a newly recorded office starts here.
                </p>
              ) : (
                <div className="review-list">
                  {pendingPeople.map((p) => (
                    <PersonRow person={p} key={p.id} />
                  ))}
                  {pendingRoles.map((r) => (
                    <RoleRow role={r} key={r.id} />
                  ))}
                </div>
              )}
              <p className="panel-note">
                Self-review is recorded rather than blocked while the desk is one person. A person
                and each office they hold are reviewed separately: the office is the claim that has
                to be checked against a page.
              </p>
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>STALE</span><h2>Needs confirming</h2></div>
                <span className="admin-count">{stale.length}</span>
              </div>
              {stale.length === 0 ? (
                <p className="panel-note">
                  Every current office has been confirmed within the last twelve months.
                </p>
              ) : (
                <div className="review-list">
                  {stale.map((r) => (
                    <RoleRow role={r} key={r.id} />
                  ))}
                </div>
              )}
              <p className="panel-note">
                A current office nobody has confirmed in twelve months. Last year&apos;s annual
                report is evidence that someone held the office then, not that they hold it now — so
                an unconfirmed role is the register asserting something it has not re-checked.
              </p>
            </section>
          </div>

          {editingPerson && personHistory.length > 0 ? (
            <section className="admin-panel audit-panel">
              <div className="admin-panel-heading">
                <div><span>HISTORY</span><h2>How this record has changed</h2></div>
                <span className="admin-count">
                  {personHistory.length} VERSION{personHistory.length === 1 ? "" : "S"}
                </span>
              </div>
              <div className="review-list">
                {personHistory.map((version) => (
                  <article className="review-row" key={version.version}>
                    <div className="review-row-main">
                      <strong>
                        Version {version.version} · {version.honorific ? `${version.honorific} ` : ""}
                        {version.fullName}
                      </strong>
                      <p className="review-row-meta">/people/{version.slug}</p>
                      <p className="review-row-meta">
                        {formatWat(version.changedAt)}
                        {version.changeReason ? ` — ${version.changeReason}` : ""}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {editingRole && roleHistory.length > 0 ? (
            <section className="admin-panel audit-panel">
              <div className="admin-panel-heading">
                <div><span>HISTORY</span><h2>How this office has changed</h2></div>
                <span className="admin-count">
                  {roleHistory.length} VERSION{roleHistory.length === 1 ? "" : "S"}
                </span>
              </div>
              <div className="review-list">
                {roleHistory.map((version) => (
                  <article className="review-row" key={version.version}>
                    <div className="review-row-main">
                      <strong>
                        Version {version.version} · {version.roleTitle ?? version.roleCode}
                        {version.isActing ? " (acting)" : ""}
                      </strong>
                      <p className="review-row-meta">
                        {formatTenure(
                          version.validFrom,
                          version.validFromPrecision,
                          version.validTo,
                          version.validToPrecision,
                        )}
                      </p>
                      <p className="review-row-meta">
                        {formatWat(version.changedAt)}
                        {version.changeReason ? ` — ${version.changeReason}` : ""}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="admin-panel audit-panel">
            <div className="admin-panel-heading">
              <div><span>REGISTER</span><h2>Published offices</h2></div>
              <span className="admin-count">{approvedRoles.length}</span>
            </div>
            {approvedRoles.length === 0 ? (
              <p className="panel-note">
                No office has been approved yet, so no company page shows its leadership.
              </p>
            ) : (
              <div className="review-list">
                {approvedRoles.map((r) => (
                  <RoleRow role={r} key={r.id} />
                ))}
              </div>
            )}
          </section>

          {withdrawn.length > 0 ? (
            <section className="admin-panel audit-panel">
              <div className="admin-panel-heading">
                <div><span>WITHDRAWN</span><h2>Claims we no longer stand behind</h2></div>
                <span className="admin-count">{withdrawn.length}</span>
              </div>
              <div className="review-list">
                {withdrawn.map((r) => (
                  <RoleRow role={r} key={r.id} />
                ))}
              </div>
              <p className="panel-note">
                A withdrawn office leaves the published record and stays here. That is the opposite
                of a withdrawn announcement, which readers still see labelled — for a statement
                about a person, continuing to publish a claim we know is wrong is itself the harm.
                Nothing is deleted: the reason and the history remain.
              </p>
            </section>
          ) : null}

          <footer className="admin-footer">
            <span>Samuel Terminal <b>·</b> Research desk</span>
            <span>Role-gated access <i /></span>
          </footer>
        </div>
      </section>
    </main>
  );
}
