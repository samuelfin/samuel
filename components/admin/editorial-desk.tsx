"use client";

import { useActionState, useState } from "react";
import {
  addCitationAction,
  publishEditorialAction,
  removeCitationAction,
  saveDraftAction,
  withdrawEditorialAction,
  type EditorialActionState,
} from "@/app/admin/editorial/actions";
import {
  EDITORIAL_KINDS,
  EDITORIAL_KIND_LABELS,
  MAX_STANDFIRST,
  MAX_TITLE,
  VIDEO_DISCLAIMER,
} from "@/lib/editorial/validation";
import type { CitableSource, EditorialCitation, EditorialItem } from "@/lib/data/editorial";
import { CompanyPicker } from "@/components/admin/company-picker";
import type { CompanyOption } from "@/lib/data/companies";

const EMPTY: EditorialActionState = {};

function Message({ state }: { state: EditorialActionState }) {
  if (state.error) return <p className="auth-message" role="alert">{state.error}</p>;
  if (state.notice) return <p className="auth-message" role="status">{state.notice}</p>;
  return null;
}

export function DraftForm({
  item,
  companies,
  correcting,
}: {
  item?: EditorialItem;
  companies: CompanyOption[];
  correcting?: EditorialItem;
}) {
  const [state, action, pending] = useActionState(saveDraftAction, EMPTY);
  const [kind, setKind] = useState<string>(item?.kind ?? correcting?.kind ?? "article");
  const [aiAssisted, setAiAssisted] = useState(item?.aiAssisted ?? false);
  const isVideo = kind === "video";

  return (
    <form action={action} className="auth-form">
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
      {correcting ? <input type="hidden" name="supersedesId" value={correcting.id} /> : null}

      {correcting ? (
        <>
          <p className="panel-note">
            Correcting <strong>{correcting.title}</strong>. It keeps the same web address; the original is
            kept and marked superseded.
          </p>
          <label>
            What was wrong
            <input
              name="correctionReason"
              required
              maxLength={2000}
              defaultValue={item?.correctionReason ?? ""}
              placeholder="Misstated the operating margin"
            />
          </label>
        </>
      ) : null}

      <label>
        Kind
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {EDITORIAL_KINDS.map((k) => (
            <option key={k} value={k}>{EDITORIAL_KIND_LABELS[k]}</option>
          ))}
        </select>
      </label>

      <label>
        Web address <small>Lowercase words joined by hyphens</small>
        <input
          name="slug"
          required
          defaultValue={item?.slug ?? correcting?.slug ?? ""}
          readOnly={Boolean(correcting)}
          placeholder="mtn-q3-2026-results"
        />
      </label>

      <label>
        Title
        <input name="title" required maxLength={MAX_TITLE} defaultValue={item?.title ?? ""} />
      </label>

      <CompanyPicker
        companies={companies}
        defaultValue={item?.companyId ?? null}
        hint="Optional — leave blank for a market-wide piece"
      />

      <label>
        Standfirst <small>Optional. One sentence under the title.</small>
        <input name="standfirst" maxLength={MAX_STANDFIRST} defaultValue={item?.standfirst ?? ""} />
      </label>

      {isVideo ? (
        <>
          <label>
            YouTube link or video id
            <input
              name="video"
              required
              defaultValue={item?.videoId ?? ""}
              placeholder="https://www.youtube.com/watch?v=…"
            />
          </label>
          <label>
            Guest
            <input name="guestName" required maxLength={120} defaultValue={item?.guestName ?? ""} />
          </label>
          <p className="panel-note">Every video carries this notice to readers: &ldquo;{VIDEO_DISCLAIMER}&rdquo;</p>
        </>
      ) : (
        <label>
          Body <small>Plain prose. Leave a blank line between paragraphs.</small>
          <textarea name="body" rows={12} required defaultValue={item?.bodyText ?? ""} />
        </label>
      )}

      <label className="checkbox-row">
        <input
          name="aiAssisted"
          type="checkbox"
          checked={aiAssisted}
          onChange={(e) => setAiAssisted(e.target.checked)}
        />
        <span>AI-assisted</span>
      </label>

      {aiAssisted ? (
        <label>
          Which model <small>Readers are shown an &ldquo;AI-assisted&rdquo; label</small>
          <input name="aiModel" required maxLength={120} defaultValue={item?.aiModel ?? ""} placeholder="claude-opus-5" />
        </label>
      ) : null}

      <button className="auth-submit" disabled={pending}>
        {pending ? "Saving…" : item ? "Save draft" : "Create draft"}<span>→</span>
      </button>

      <Message state={state} />
    </form>
  );
}

export function CitationManager({
  itemId,
  citations,
  sources,
}: {
  itemId: string;
  citations: EditorialCitation[];
  sources: CitableSource[];
}) {
  const [state, action, pending] = useActionState(addCitationAction, EMPTY);
  const [removeState, removeAction] = useActionState(removeCitationAction, EMPTY);

  return (
    <div>
      {citations.length === 0 ? (
        <p className="panel-note">
          No sources yet. An article or analysis cannot be published until it cites at least one.
        </p>
      ) : (
        <ul className="citation-list">
          {citations.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.claim}</strong>
                <span>
                  {c.documentTitle ?? c.announcementHeadline}
                  {c.sourcePage ? `, page ${c.sourcePage}` : ""}
                </span>
              </div>
              <form action={removeAction}>
                <input type="hidden" name="citationId" value={c.id} />
                <button>Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <Message state={removeState} />

      {sources.length === 0 ? (
        <p className="panel-note">
          Nothing can be cited yet: approve a document or publish an announcement first.
        </p>
      ) : (
        <form action={action} className="auth-form">
          <input type="hidden" name="itemId" value={itemId} />
          <label>
            What this supports
            <input name="claim" required maxLength={500} placeholder="Revenue rose 18% year on year" />
          </label>
          <label>
            Source
            <select name="source" required defaultValue="">
              <option value="" disabled>Choose a source…</option>
              {sources.map((s) => (
                <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                  {s.kind === "document" ? "Document" : "Announcement"} — {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Page <small>Optional, for a document</small>
            <input name="sourcePage" type="number" min={1} step={1} />
          </label>
          <button className="auth-submit" disabled={pending}>
            {pending ? "Adding…" : "Add source"}<span>→</span>
          </button>
          <Message state={state} />
        </form>
      )}
    </div>
  );
}

export function PublishItem({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(publishEditorialAction, EMPTY);
  return (
    <form action={action} className="review-decision">
      <input type="hidden" name="itemId" value={itemId} />
      <button disabled={pending}>{pending ? "Publishing…" : "Publish"}</button>
      <Message state={state} />
    </form>
  );
}

export function WithdrawItem({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(withdrawEditorialAction, EMPTY);
  const [open, setOpen] = useState(false);

  return (
    <form action={action} className="review-decision">
      <input type="hidden" name="itemId" value={itemId} />
      {open ? (
        <>
          <label>
            Reason for withdrawal
            <input name="reason" required maxLength={2000} placeholder="Guest requested removal" />
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
