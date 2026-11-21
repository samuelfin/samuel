"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { reviewCompanyAction, saveCompanyAction, type CompanyActionState } from "@/app/admin/companies/actions";
// Values come from the pure validation module: this is a client component, and
// lib/data/companies is server-only. The shapes below are type-only imports,
// erased at compile time, so they never pull that module into the bundle.
import { LISTING_STATUSES, LISTING_STATUS_LABELS, NGX_BOARDS, slugify } from "@/lib/companies/validation";
import type { CompanyForDesk, SectorOption } from "@/lib/data/companies";

const EMPTY: CompanyActionState = {};

function Message({ state }: { state: CompanyActionState }) {
  if (state.error) return <p className="auth-message" role="alert">{state.error}</p>;
  if (state.notice) return <p className="auth-message" role="status">{state.notice}</p>;
  return null;
}

export function CompanyForm({
  company,
  sectors,
}: {
  /** Absent when creating. */
  company?: CompanyForDesk;
  sectors: SectorOption[];
}) {
  const [state, action, pending] = useActionState(saveCompanyAction, EMPTY);

  // The address is suggested from the name while it has not been edited by hand,
  // and left alone once it has — an existing company's address is load-bearing,
  // because it is the page readers have already linked to.
  const [slug, setSlug] = useState(company?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(company));
  const [listingStatus, setListingStatus] = useState<string>(company?.listingStatus ?? "listed");

  const editing = Boolean(company);
  const symbolRequired = listingStatus === "listed";

  return (
    <form action={action} className="auth-form">
      {company ? <input type="hidden" name="companyId" value={company.id} /> : null}

      <label>
        Name
        <input
          name="name"
          required
          maxLength={200}
          defaultValue={company?.name ?? ""}
          placeholder="Dangote Cement Plc"
          onChange={(event) => {
            if (!slugTouched) setSlug(slugify(event.target.value));
          }}
        />
      </label>

      <label>
        Registered name <small>Optional, if it differs from the trading name</small>
        <input name="legalName" maxLength={200} defaultValue={company?.legalName ?? ""} />
      </label>

      <label>
        Web address
        <input
          name="slug"
          value={slug}
          maxLength={120}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
          placeholder="dangote-cement"
        />
        <small>
          The company page will be /companies/{slug || "…"}
          {editing ? ". Changing it moves the page; the old address keeps working." : "."}
        </small>
      </label>

      <label>
        Listing status
        <select
          name="listingStatus"
          required
          value={listingStatus}
          onChange={(event) => setListingStatus(event.target.value)}
        >
          {LISTING_STATUSES.map((status) => (
            <option key={status} value={status}>
              {LISTING_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <small>
          Pre-listing is a company with an offer under way that has not listed yet, so it has no
          ticker.
        </small>
      </label>

      <label>
        NGX symbol {symbolRequired ? null : <small>Optional at this listing status</small>}
        <input
          name="ngxSymbol"
          maxLength={15}
          required={symbolRequired}
          defaultValue={company?.symbol ?? ""}
          placeholder="DANGCEM"
          style={{ textTransform: "uppercase" }}
        />
        {editing && company?.symbol ? (
          <small>
            Changing this retires {company.symbol} with today&apos;s date and records the new symbol
            from today. The old one stays in the company&apos;s history.
          </small>
        ) : null}
      </label>

      <label>
        Sector
        <select name="sectorId" defaultValue={company?.sectorId ?? ""}>
          <option value="">Not recorded</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Industry <small>Optional, more specific than the sector</small>
        <input name="industry" maxLength={120} defaultValue={company?.industry ?? ""} placeholder="Cement" />
      </label>

      <label>
        Listing board <small>Optional</small>
        <input
          name="listingBoard"
          maxLength={60}
          defaultValue={company?.listingBoard ?? ""}
          list="ngx-boards"
          placeholder="Main Board"
        />
        <datalist id="ngx-boards">
          {NGX_BOARDS.map((board) => (
            <option key={board} value={board} />
          ))}
        </datalist>
        <small>
          NGX closed the Alternative Securities Market (ASeM) on 1 July 2025 and moved eligible
          companies to the Growth Board. ASeM can still be recorded for a company delisted before
          then.
        </small>
      </label>

      <label>
        Website <small>Optional</small>
        <input
          name="website"
          type="url"
          maxLength={500}
          defaultValue={company?.website ?? ""}
          placeholder="https://www.example.com"
        />
      </label>

      <label>
        What the business does <small>Optional</small>
        <textarea name="description" rows={4} maxLength={4000} defaultValue={company?.description ?? ""} />
      </label>

      {editing ? (
        <label>
          Why this is changing
          <input
            name="changeReason"
            required
            maxLength={500}
            placeholder="Renamed at the 2026 annual general meeting"
          />
          <small>Kept as part of the company&apos;s history, so the change can be explained later.</small>
        </label>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save change" : "Create company"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function ReviewCompany({ company }: { company: CompanyForDesk }) {
  const [state, action, pending] = useActionState(reviewCompanyAction, EMPTY);
  const [rejecting, setRejecting] = useState(false);

  return (
    <form action={action} className="withdraw-form">
      <input type="hidden" name="companyId" value={company.id} />
      {rejecting ? (
        <>
          <input type="hidden" name="decision" value="rejected" />
          <input name="reason" required maxLength={500} placeholder="Why it is being rejected" />
          <button type="submit" disabled={pending}>
            {pending ? "Recording…" : "Confirm rejection"}
          </button>
          <button type="button" onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="submit" name="decision" value="approved" disabled={pending}>
            {pending ? "Recording…" : company.reviewStatus === "approved" ? "Re-approve" : "Approve"}
          </button>
          <button type="button" onClick={() => setRejecting(true)}>
            Reject
          </button>
        </>
      )}
      <Message state={state} />
    </form>
  );
}

export function CompanyRow({ company }: { company: CompanyForDesk }) {
  return (
    <article className="review-row">
      <div className="review-row-main">
        <strong>
          {company.name}
          {company.symbol ? <span className="sym"> {company.symbol}</span> : null}
        </strong>
        <p>
          {[company.sector, company.industry, company.listingBoard].filter(Boolean).join(" · ") ||
            "No sector recorded"}
        </p>
        <p className="review-row-meta">
          /companies/{company.slug} · {LISTING_STATUS_LABELS[company.listingStatus]} · version{" "}
          {company.version}
        </p>
        {company.hasUnreviewedChanges ? (
          <p className="review-row-meta">
            Approved, but the profile has changed since anyone read it. Re-approve to record that the
            current version has been checked.
          </p>
        ) : null}
      </div>
      <div className="review-row-actions">
        {company.reviewSelfApproved ? (
          <span className="self-approved-flag" title="Reviewed by the person who wrote the profile">
            SELF-APPROVED
          </span>
        ) : null}
        {company.hasUnreviewedChanges ? <span className="role-scope">UNREVIEWED CHANGES</span> : null}
        <span className="role-scope">{company.reviewStatus.toUpperCase()}</span>
        <Link className="correct-link" href={`/admin/companies?edit=${company.id}`}>
          Edit
        </Link>
        <ReviewCompany company={company} />
      </div>
    </article>
  );
}
