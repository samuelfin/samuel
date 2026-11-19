import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { PublishAnnouncementForm, WithdrawAnnouncement } from "@/components/admin/announcement-desk";
import { requireStaffRole } from "@/lib/auth/staff";
import { ANNOUNCEMENT_CATEGORY_LABELS, type AnnouncementCategory } from "@/lib/announcements/validation";
import { listAllAnnouncements, listPublishableDocuments } from "@/lib/data/announcements";

export const metadata: Metadata = { title: "Announcements" };

function formatWat(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

export default async function AnnouncementDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ correct?: string }>;
}) {
  const staff = await requireStaffRole(["analyst", "editor"]);
  const { correct } = await searchParams;
  const [documents, announcements] = await Promise.all([
    listPublishableDocuments(),
    listAllAnnouncements(),
  ]);

  const blocked = documents.filter((d) => !d.canPublish);
  const ready = documents.filter((d) => d.canPublish);

  // A correction republishes the same document, so it is offered from the record
  // below rather than from the queue, where that document no longer appears.
  const target = correct ? announcements.find((a) => a.id === correct && a.status === "published") : undefined;
  const correcting = target
    ? { announcementId: target.id, documentId: target.documentId, headline: target.headline }
    : undefined;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link>
        <div className="admin-context">SFI PLATFORM <span>DESK</span></div>
        <div className="admin-nav-label">RESEARCH DESK</div>
        <Link className="admin-nav" href="/admin/documents"><i>▤</i> Document review</Link>
        <Link className="admin-nav active" href="/admin/announcements"><i>◈</i> Announcements</Link>
        {staff.isPlatformAdmin ? <Link className="admin-nav" href="/admin"><i>▦</i> Administration</Link> : null}
        <Link className="admin-nav" href="/news"><i>▣</i> News feed</Link>
        <div className="admin-sidebar-foot"><span className="secure-indicator" /> STAFF SESSION ACTIVE<br /><small>Roles are verified server-side on every action.</small></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><span>Samuel Terminal</span><b>/</b><strong>Announcements</strong></div>
          <div className="admin-user">
            <span className="admin-avatar">{staff.name.slice(0, 1).toUpperCase()}</span>
            <span>{staff.name}</span>
            <form action={signOut}><button>Sign out</button></form>
          </div>
        </header>

        <div className="admin-content">
          <div className="admin-title-row">
            <div>
              <div className="admin-eyebrow">PUBLISHING · SFI</div>
              <h1>Announcements<span>.</span></h1>
              <p>Publish what an approved document says. Readers are sent to the issuer&apos;s own page, never to our stored copy.</p>
            </div>
            <span className="admin-role-pill">
              {staff.roles.length ? staff.roles.join(" · ").toUpperCase() : "PLATFORM ADMIN"}
            </span>
          </div>

          <div className="admin-panels">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>{correcting ? "CORRECT" : "PUBLISH"}</span><h2>{correcting ? "Publish a correction" : "From an approved document"}</h2></div>
                <span className="admin-count">{ready.length} READY</span>
              </div>
              <PublishAnnouncementForm documents={documents} correcting={correcting} />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>BLOCKED</span><h2>Approved, but not publishable</h2></div>
                <span className="admin-count">{blocked.length}</span>
              </div>
              {blocked.length === 0 ? (
                <p className="panel-note">Every approved document carries a public source link.</p>
              ) : (
                <div className="review-list">
                  {blocked.map((d) => (
                    <article className="review-row" key={d.id}>
                      <div className="review-row-main">
                        <strong>{d.title}</strong>
                        <p className="review-row-meta">
                          No public source link, so a reader could not be shown where it came from.
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="admin-panel audit-panel">
            <div className="admin-panel-heading">
              <div><span>RECORD</span><h2>Published announcements</h2></div>
              <span className="admin-count">{announcements.length}</span>
            </div>
            {announcements.length === 0 ? (
              <p className="panel-note">Nothing has been published yet.</p>
            ) : (
              <div className="review-list">
                {announcements.map((a) => (
                  <article className="review-row" key={a.id}>
                    <div className="review-row-main">
                      <strong>{a.headline}</strong>
                      <p>
                        {ANNOUNCEMENT_CATEGORY_LABELS[a.category as AnnouncementCategory] ?? a.category}
                        {a.companyName ? ` · ${a.companyName}` : ""}
                        {a.version > 1 ? ` · version ${a.version}` : ""}
                      </p>
                      <p className="review-row-meta">
                        Announced {formatWat(a.announcedAt)} · published {formatWat(a.publishedAt)}
                        {a.status === "withdrawn" ? ` · withdrawn ${formatWat(a.withdrawnAt)}` : ""}
                      </p>
                      {a.status === "withdrawn" && a.withdrawalReason ? (
                        <p className="review-row-meta">Withdrawn because: {a.withdrawalReason}</p>
                      ) : null}
                    </div>
                    <div className="review-row-actions">
                      {a.selfPublished ? (
                        <span className="self-approved-flag" title="Published by the person who approved the source document">
                          SELF-PUBLISHED
                        </span>
                      ) : null}
                      {a.isPriceSensitive ? <span className="role-scope">PRICE SENSITIVE</span> : null}
                      {a.status === "published" ? (
                        <>
                          <Link className="correct-link" href={`/admin/announcements?correct=${a.id}`}>
                            Correct
                          </Link>
                          <WithdrawAnnouncement announcementId={a.id} />
                        </>
                      ) : (
                        <span className="role-scope">{a.status}</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="panel-note">
              Announcements are never edited or deleted. A correction publishes a new version and
              marks the old one superseded; a withdrawal keeps the announcement visible to readers,
              labelled as withdrawn, with the reason given.
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
