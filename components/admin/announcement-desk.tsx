"use client";

import { useActionState, useState } from "react";
import {
  publishAnnouncementAction,
  withdrawAnnouncementAction,
  type AnnouncementActionState,
} from "@/app/admin/announcements/actions";
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_LABELS,
  MAX_HEADLINE,
} from "@/lib/announcements/validation";
import type { PublishableDocument } from "@/lib/data/announcements";

const EMPTY: AnnouncementActionState = {};

function Message({ state }: { state: AnnouncementActionState }) {
  if (state.error) return <p className="auth-message" role="alert">{state.error}</p>;
  if (state.notice) return <p className="auth-message" role="status">{state.notice}</p>;
  return null;
}

export function PublishAnnouncementForm({
  documents,
  correcting,
}: {
  documents: PublishableDocument[];
  correcting?: { announcementId: string; documentId: string; headline: string };
}) {
  const [state, action, pending] = useActionState(publishAnnouncementAction, EMPTY);
  const publishable = documents.filter((d) => d.canPublish);

  if (!correcting && publishable.length === 0) {
    return (
      <div className="provider-empty">
        <span className="provider-orbit">◌</span>
        <strong>Nothing to publish</strong>
        <p>
          Approved documents with a public source link appear here. Approve a document on the
          document desk first.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="auth-form">
      {correcting ? (
        <>
          <input type="hidden" name="supersedesId" value={correcting.announcementId} />
          <input type="hidden" name="documentId" value={correcting.documentId} />
          <p className="panel-note">
            Correcting <strong>{correcting.headline}</strong>. The original is kept and marked
            superseded; readers see this version labelled as corrected.
          </p>
          <label>
            What was wrong
            <input name="correctionReason" required maxLength={2000} placeholder="Transposed figure in the original" />
          </label>
        </>
      ) : (
        <label>
          Source document <small>Approved documents with a public link</small>
          <select name="documentId" required defaultValue="">
            <option value="" disabled>Choose a document…</option>
            {publishable.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        </label>
      )}

      <label>
        Category
        <select name="category" defaultValue="results">
          {ANNOUNCEMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{ANNOUNCEMENT_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </label>

      <label>
        Headline
        <input name="headline" required maxLength={MAX_HEADLINE} placeholder="Full-year results for the period ended 31 December 2025" />
      </label>

      <label>
        Summary <small>Optional. Plain description of what the document says.</small>
        <textarea name="summary" rows={3} maxLength={4000} />
      </label>

      <label>
        Announced by the issuer <small>When they said it, not when you are recording it</small>
        <input name="announcedAt" type="datetime-local" required />
      </label>

      <label className="checkbox-row">
        <input name="isPriceSensitive" type="checkbox" />
        <span>Price sensitive</span>
      </label>

      <button className="auth-submit" disabled={pending}>
        {pending ? "Publishing…" : correcting ? "Publish correction" : "Publish announcement"}<span>→</span>
      </button>

      <Message state={state} />
      <p className="panel-note">
        Publishing makes this visible to every signed-in reader, with a link to the issuer&apos;s own
        page. Correct it with a new version rather than editing; withdraw it if it should not have
        been published.
      </p>
    </form>
  );
}

export function WithdrawAnnouncement({ announcementId }: { announcementId: string }) {
  const [state, action, pending] = useActionState(withdrawAnnouncementAction, EMPTY);
  const [open, setOpen] = useState(false);

  return (
    <form action={action} className="review-decision">
      <input type="hidden" name="announcementId" value={announcementId} />
      {open ? (
        <>
          <label>
            Reason for withdrawal
            <input name="reason" required maxLength={2000} placeholder="Issuer retracted the release" />
          </label>
          <button disabled={pending}>{pending ? "Recording…" : "Confirm withdrawal"}</button>
          <button type="button" onClick={() => setOpen(false)} disabled={pending}>Cancel</button>
        </>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>Withdraw</button>
      )}
      <Message state={state} />
    </form>
  );
}
