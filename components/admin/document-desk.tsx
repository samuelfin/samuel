"use client";

import { useActionState, useState } from "react";
import {
  openDocumentAction,
  reviewDocumentAction,
  uploadDocumentAction,
  type ActionState,
} from "@/app/admin/documents/actions";
import { DOCUMENT_KINDS, LICENCE_CLASSES } from "@/lib/documents/validation";
import { CompanyPicker } from "@/components/admin/company-picker";
import type { CompanyOption } from "@/lib/data/companies";

const EMPTY: ActionState = {};

const KIND_LABELS: Record<string, string> = {
  annual_report: "Annual report",
  interim_report: "Interim report",
  financial_statements: "Financial statements",
  presentation: "Presentation",
  announcement: "Announcement",
  regulatory_filing: "Regulatory filing",
  statistical_release: "Statistical release",
  auction_result: "Auction result",
  circular: "Circular",
  other: "Other",
};

const LICENCE_LABELS: Record<string, string> = {
  licensed: "Licensed — contract permits display",
  public_official: "Public official source",
  issuer_document: "Issuer document",
  sfi_original: "SFI original",
  unverified: "Unverified — not shown to readers",
};

function Message({ state }: { state: ActionState }) {
  if (state.error) return <p className="auth-message" role="alert">{state.error}</p>;
  if (state.notice) return <p className="auth-message" role="status">{state.notice}</p>;
  return null;
}

export function DocumentUploadForm({ companies }: { companies: CompanyOption[] }) {
  const [state, action, pending] = useActionState(uploadDocumentAction, EMPTY);

  return (
    <form action={action} className="auth-form">
      <label>
        Title
        <input name="title" required maxLength={300} placeholder="MTN Nigeria FY2025 annual report" />
      </label>

      <CompanyPicker
        companies={companies}
        hint="Optional — leave blank for a regulator or statistics document"
      />

      <label>
        Document kind
        <select name="kind" defaultValue="annual_report">
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>{KIND_LABELS[kind] ?? kind}</option>
          ))}
        </select>
      </label>

      <label>
        How it may be used
        <select name="licenceClass" defaultValue="issuer_document">
          {LICENCE_CLASSES.map((licence) => (
            <option key={licence} value={licence}>{LICENCE_LABELS[licence] ?? licence}</option>
          ))}
        </select>
      </label>

      <label>
        Source link <small>Optional — where the document was published</small>
        <input name="sourceUri" type="url" placeholder="https://issuer.example/investor-relations/fy2025.pdf" />
      </label>

      <label>
        Published on <small>Optional</small>
        <input name="publishedAt" type="date" />
      </label>

      <label>
        File <small>PDF, CSV or Excel, up to 50 MB</small>
        <input
          name="file"
          type="file"
          required
          accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv"
        />
      </label>

      <button className="auth-submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload for review"}<span>→</span>
      </button>

      <Message state={state} />
      <p className="panel-note">
        An upload is not published. It stays invisible to readers until a reviewer approves it.
      </p>
    </form>
  );
}

export function ReviewDecision({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(reviewDocumentAction, EMPTY);
  const [rejecting, setRejecting] = useState(false);

  return (
    <form action={action} className="review-decision">
      <input type="hidden" name="documentId" value={documentId} />

      {rejecting ? (
        <>
          <label>
            Reason for rejection
            <input name="reason" required maxLength={2000} placeholder="Wrong issuer, unreadable scan, superseded…" />
          </label>
          <button name="decision" value="rejected" disabled={pending}>
            {pending ? "Recording…" : "Confirm rejection"}
          </button>
          <button type="button" onClick={() => setRejecting(false)} disabled={pending}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button name="decision" value="approved" disabled={pending}>
            {pending ? "Recording…" : "Approve"}
          </button>
          <button type="button" onClick={() => setRejecting(true)} disabled={pending}>
            Reject
          </button>
        </>
      )}

      <Message state={state} />
    </form>
  );
}

export function OpenDocumentButton({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(openDocumentAction, EMPTY);

  return (
    <form action={action} className="review-open">
      <input type="hidden" name="documentId" value={documentId} />
      <button disabled={pending}>{pending ? "Preparing…" : "Open file"}</button>

      {state.signedUrl && (
        // noreferrer matters: the signed URL must not leak through a Referer
        // header to anything the document itself might load.
        <a href={state.signedUrl} target="_blank" rel="noopener noreferrer">
          Open now
        </a>
      )}
      <Message state={state} />
    </form>
  );
}
