import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { CitationManager, DraftForm, PublishItem, WithdrawItem } from "@/components/admin/editorial-desk";
import { requireStaffRole } from "@/lib/auth/staff";
import { EDITORIAL_KIND_LABELS } from "@/lib/editorial/validation";
import { listAllEditorial, listCitableSources, listCitationsFor } from "@/lib/data/editorial";
import { listApprovedCompanies } from "@/lib/data/companies";

export const metadata: Metadata = { title: "Editorial" };

function formatWat(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

export default async function EditorialDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; correct?: string }>;
}) {
  const staff = await requireStaffRole(["analyst", "editor"]);
  const { edit, correct } = await searchParams;

  const [items, sources, companies] = await Promise.all([
    listAllEditorial(),
    listCitableSources(),
    listApprovedCompanies(),
  ]);

  const editing = edit ? items.find((i) => i.id === edit && i.status === "draft") : undefined;
  const correcting = correct ? items.find((i) => i.id === correct && i.status === "published") : undefined;
  const citations = editing ? await listCitationsFor(editing.id) : [];

  const drafts = items.filter((i) => i.status === "draft");
  const live = items.filter((i) => i.status !== "draft");

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link>
        <div className="admin-context">SFI PLATFORM <span>DESK</span></div>
        <div className="admin-nav-label">RESEARCH DESK</div>
        <Link className="admin-nav" href="/admin/documents"><i>▤</i> Document review</Link>
        <Link className="admin-nav" href="/admin/announcements"><i>◈</i> Announcements</Link>
        <Link className="admin-nav active" href="/admin/editorial"><i>✎</i> Editorial</Link>
        {staff.isPlatformAdmin ? <Link className="admin-nav" href="/admin"><i>▦</i> Administration</Link> : null}
        <Link className="admin-nav" href="/research"><i>▣</i> Research feed</Link>
        <div className="admin-sidebar-foot"><span className="secure-indicator" /> STAFF SESSION ACTIVE<br /><small>Roles are verified server-side on every action.</small></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><span>Samuel Terminal</span><b>/</b><strong>Editorial</strong></div>
          <div className="admin-user">
            <span className="admin-avatar">{staff.name.slice(0, 1).toUpperCase()}</span>
            <span>{staff.name}</span>
            <form action={signOut}><button>Sign out</button></form>
          </div>
        </header>

        <div className="admin-content">
          <div className="admin-title-row">
            <div>
              <div className="admin-eyebrow">WRITING · SFI</div>
              <h1>Editorial<span>.</span></h1>
              <p>Articles and analysis that cite their evidence, and videos that link out to YouTube. A draft is editable; once published it is a matter of record.</p>
            </div>
            <span className="admin-role-pill">
              {staff.roles.length ? staff.roles.join(" · ").toUpperCase() : "PLATFORM ADMIN"}
            </span>
          </div>

          <div className="admin-panels">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>{correcting ? "CORRECT" : editing ? "EDIT" : "WRITE"}</span>
                  <h2>{correcting ? "Publish a correction" : editing ? "Edit draft" : "New draft"}</h2>
                </div>
                {editing || correcting ? (
                  <Link className="correct-link" href="/admin/editorial">Start fresh</Link>
                ) : null}
              </div>
              <DraftForm
                key={editing?.id ?? correcting?.id ?? "new"}
                item={editing}
                companies={companies}
                correcting={correcting}
              />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>SOURCES</span><h2>What it cites</h2></div>
                {editing ? <PublishItem itemId={editing.id} /> : null}
              </div>
              {editing ? (
                <CitationManager itemId={editing.id} citations={citations} sources={sources} />
              ) : (
                <p className="panel-note">
                  Open a draft to manage its sources. An article or analysis must cite at least one
                  approved document or published announcement before it can be published; a video need not.
                </p>
              )}
            </section>
          </div>

          <section className="admin-panel">
            <div className="admin-panel-heading">
              <div><span>DRAFTS</span><h2>In progress</h2></div>
              <span className="admin-count">{drafts.length}</span>
            </div>
            {drafts.length === 0 ? (
              <p className="panel-note">No drafts.</p>
            ) : (
              <div className="review-list">
                {drafts.map((i) => (
                  <article className="review-row" key={i.id}>
                    <div className="review-row-main">
                      <strong>{i.title}</strong>
                      <p>{EDITORIAL_KIND_LABELS[i.kind]} · /{i.slug}</p>
                      <p className="review-row-meta">Last saved {formatWat(i.updatedAt)}</p>
                    </div>
                    <div className="review-row-actions">
                      {i.aiAssisted ? <span className="self-approved-flag">AI-ASSISTED</span> : null}
                      <Link className="correct-link" href={`/admin/editorial?edit=${i.id}`}>Open</Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="admin-panel audit-panel">
            <div className="admin-panel-heading">
              <div><span>RECORD</span><h2>Published</h2></div>
              <span className="admin-count">{live.length}</span>
            </div>
            {live.length === 0 ? (
              <p className="panel-note">Nothing has been published yet.</p>
            ) : (
              <div className="review-list">
                {live.map((i) => (
                  <article className="review-row" key={i.id}>
                    <div className="review-row-main">
                      <strong>{i.title}</strong>
                      <p>
                        {EDITORIAL_KIND_LABELS[i.kind]} · /{i.slug}
                        {i.version > 1 ? ` · version ${i.version}` : ""} · {i.status}
                      </p>
                      <p className="review-row-meta">
                        Published {formatWat(i.publishedAt)}
                        {i.status === "withdrawn" ? ` · withdrawn ${formatWat(i.withdrawnAt)}` : ""}
                      </p>
                      {i.status === "withdrawn" && i.withdrawalReason ? (
                        <p className="review-row-meta">Withdrawn because: {i.withdrawalReason}</p>
                      ) : null}
                    </div>
                    <div className="review-row-actions">
                      {i.selfReviewed ? (
                        <span className="self-approved-flag" title="Published by its own author">SELF-REVIEWED</span>
                      ) : null}
                      {i.aiAssisted ? <span className="self-approved-flag">AI-ASSISTED</span> : null}
                      {i.status === "published" ? (
                        <>
                          <Link className="correct-link" href={`/admin/editorial?correct=${i.id}`}>Correct</Link>
                          <WithdrawItem itemId={i.id} />
                        </>
                      ) : (
                        <span className="role-scope">{i.status}</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="panel-note">
              Published writing is never edited or deleted. A correction publishes a new version at the
              same address and marks the old one superseded; a withdrawal keeps the item visible to
              readers, labelled, with the reason given.
            </p>
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
