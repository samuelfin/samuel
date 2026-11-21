import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { DocumentUploadForm, OpenDocumentButton, ReviewDecision } from "@/components/admin/document-desk";
import { requireStaffRole } from "@/lib/auth/staff";
import { listRecentlyReviewed, listReviewQueue, type ReviewQueueItem } from "@/lib/data/documents";
import { listApprovedCompanies } from "@/lib/data/companies";

export const metadata: Metadata = { title: "Document review" };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Dates are shown in West Africa Time, the market's clock. */
function formatWat(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(iso));
}

function DocumentRow({ item, decidable }: { item: ReviewQueueItem; decidable: boolean }) {
  return (
    <article className="review-row">
      <div className="review-row-main">
        <strong>{item.title}</strong>
        <p>
          {item.kind.replace(/_/g, " ")} · {item.licenceClass.replace(/_/g, " ")} · {formatSize(item.sizeBytes)}
        </p>
        <p className="review-row-meta">
          Uploaded {formatWat(item.createdAt)}
          {item.publishedAt ? ` · published ${formatWat(item.publishedAt)}` : ""}
          {item.sourceUri ? (
            <>
              {" · "}
              <a href={item.sourceUri} target="_blank" rel="noopener noreferrer">source</a>
            </>
          ) : null}
        </p>
      </div>
      <div className="review-row-actions">
        {item.selfApproved ? (
          <span className="self-approved-flag" title="Cleared by the person who uploaded it">
            SELF-APPROVED
          </span>
        ) : null}
        <OpenDocumentButton documentId={item.id} />
        {decidable ? <ReviewDecision documentId={item.id} /> : <span className="role-scope">{item.reviewStatus}</span>}
      </div>
    </article>
  );
}

export default async function DocumentReviewPage() {
  const staff = await requireStaffRole(["analyst", "editor"]);
  const [queue, recent, companies] = await Promise.all([
    listReviewQueue(),
    listRecentlyReviewed(),
    listApprovedCompanies(),
  ]);

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/"><span className="brand-mark">S<span>•</span></span><span className="brand-copy"><strong>SAMUEL</strong><small>FINANCIAL INTELLIGENCE</small></span></Link>
        <div className="admin-context">SFI PLATFORM <span>DESK</span></div>
        <div className="admin-nav-label">RESEARCH DESK</div>
        <Link className="admin-nav active" href="/admin/documents"><i>▤</i> Document review</Link>
        <Link className="admin-nav" href="/admin/announcements"><i>◈</i> Announcements</Link>
        {staff.isPlatformAdmin ? <Link className="admin-nav" href="/admin"><i>▦</i> Administration</Link> : null}
        <Link className="admin-nav" href="/"><i>◈</i> Terminal</Link>
        <div className="admin-sidebar-foot"><span className="secure-indicator" /> STAFF SESSION ACTIVE<br /><small>Roles are verified server-side on every action.</small></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><span>Samuel Terminal</span><b>/</b><strong>Document review</strong></div>
          <div className="admin-user">
            <span className="admin-avatar">{staff.name.slice(0, 1).toUpperCase()}</span>
            <span>{staff.name}</span>
            <form action={signOut}><button>Sign out</button></form>
          </div>
        </header>

        <div className="admin-content">
          <div className="admin-title-row">
            <div>
              <div className="admin-eyebrow">SOURCE LIBRARY · SFI</div>
              <h1>Document review<span>.</span></h1>
              <p>Upload official documents and decide what readers may see. Nothing is published without a decision recorded here.</p>
            </div>
            <span className="admin-role-pill">
              {staff.roles.length ? staff.roles.join(" · ").toUpperCase() : "PLATFORM ADMIN"}
            </span>
          </div>

          <div className="admin-panels">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>INGESTION</span><h2>Upload a document</h2></div>
                <span className="admin-count">MANUAL</span>
              </div>
              <DocumentUploadForm companies={companies} />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div><span>QUEUE</span><h2>Awaiting review</h2></div>
                <span className="admin-count">{queue.length} PENDING</span>
              </div>
              {queue.length === 0 ? (
                <div className="provider-empty">
                  <span className="provider-orbit">◌</span>
                  <strong>Nothing is waiting</strong>
                  <p>Uploaded documents appear here, oldest first, until a reviewer approves or rejects them.</p>
                </div>
              ) : (
                <div className="review-list">
                  {queue.map((item) => <DocumentRow key={item.id} item={item} decidable />)}
                </div>
              )}
            </section>
          </div>

          <section className="admin-panel audit-panel">
            <div className="admin-panel-heading">
              <div><span>RECORD</span><h2>Recently decided</h2></div>
              <span className="admin-count">{recent.length}</span>
            </div>
            {recent.length === 0 ? (
              <p className="panel-note">No decisions have been recorded yet.</p>
            ) : (
              <div className="review-list">
                {recent.map((item) => <DocumentRow key={item.id} item={item} decidable={false} />)}
              </div>
            )}
            <p className="panel-note">
              Every decision is append-only and names its reviewer. A rejection records a reason; a correction
              supersedes the original rather than replacing it. A document cleared by its own uploader is marked
              <strong> SELF-APPROVED</strong> — turn on <code>review.require_two_person</code> to refuse those
              outright once a second reviewer is in place.
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
