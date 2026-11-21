"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  reviewPersonAction,
  reviewRoleAction,
  saveRoleAction,
  savePersonAction,
  withdrawRoleAction,
  type PeopleActionState,
} from "@/app/admin/people/actions";
// Values come from the pure validation module: this is a client component, and
// lib/data/people is server-only. The shapes below are type-only imports, erased
// at compile time, so they never pull that module into the bundle.
import { formatTenure, formatTenureDate, isConfirmationStale, slugifyName } from "@/lib/people/validation";
import type { PersonForDesk, RoleForDesk, RoleOption } from "@/lib/data/people";
import type { CompanyForDesk } from "@/lib/data/companies";
import type { CitableSource } from "@/lib/data/editorial";

const EMPTY: PeopleActionState = {};

function Message({ state }: { state: PeopleActionState }) {
  if (state.error) return <p className="auth-message" role="alert">{state.error}</p>;
  if (state.notice) return <p className="auth-message" role="status">{state.notice}</p>;
  return null;
}

export function PersonForm({ person }: { person?: PersonForDesk }) {
  const [state, action, pending] = useActionState(savePersonAction, EMPTY);

  // The address is suggested from the name until it is edited by hand, and left
  // alone afterwards — an existing person's address is load-bearing, because it
  // is the page anything has already linked to.
  const [slug, setSlug] = useState(person?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(person));

  const editing = Boolean(person);

  return (
    <form action={action} className="auth-form">
      {person ? <input type="hidden" name="personId" value={person.id} /> : null}

      <label>
        Full name
        <input
          name="fullName"
          required
          maxLength={200}
          defaultValue={person?.fullName ?? ""}
          placeholder="As the filing gives it"
          onChange={(event) => {
            if (!slugTouched) setSlug(slugifyName(event.target.value));
          }}
        />
        <small>Spelled as the company&apos;s own filing spells it, diacritics included.</small>
      </label>

      <label>
        Title <small>Optional — Chief, Dr, Alhaji, HRM</small>
        <input name="honorific" maxLength={40} defaultValue={person?.honorific ?? ""} />
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
          placeholder="ada-okonkwo"
        />
        <small>
          Their page will be /people/{slug || "…"}
          {editing ? ". Changing it moves the page." : "."} Two people can share a name: if this
          address is taken, add something that distinguishes them.
        </small>
      </label>

      {editing ? (
        <label>
          Why this is changing
          <input
            name="changeReason"
            required
            maxLength={500}
            placeholder="Married name, per the 2026 annual report"
          />
          <small>Kept as part of this person&apos;s history.</small>
        </label>
      ) : null}

      <p className="form-note">
        Only name, title and the offices held are recorded. No date of birth, address, photograph or
        anything else about them personally.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save change" : "Create person"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function ReviewPerson({ person }: { person: PersonForDesk }) {
  const [state, action, pending] = useActionState(reviewPersonAction, EMPTY);
  const [rejecting, setRejecting] = useState(false);

  return (
    <form action={action} className="withdraw-form">
      <input type="hidden" name="personId" value={person.id} />
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
            {pending ? "Recording…" : person.reviewStatus === "approved" ? "Re-approve" : "Approve"}
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

export function PersonRow({ person }: { person: PersonForDesk }) {
  const unreviewed = person.reviewStatus === "approved" && (person.reviewedVersion ?? 0) < person.version;

  return (
    <article className="review-row">
      <div className="review-row-main">
        <strong>
          {person.honorific ? `${person.honorific} ` : ""}
          {person.fullName}
        </strong>
        <p className="review-row-meta">
          /people/{person.slug} · version {person.version}
        </p>
        {unreviewed ? (
          <p className="review-row-meta">
            Approved, but the record has changed since anyone read it. Re-approve to record that the
            current version has been checked.
          </p>
        ) : null}
      </div>
      <div className="review-row-actions">
        {person.reviewSelfApproved ? (
          <span className="self-approved-flag" title="Reviewed by the person who wrote the record">
            SELF-APPROVED
          </span>
        ) : null}
        {unreviewed ? <span className="role-scope">UNREVIEWED CHANGES</span> : null}
        <span className="role-scope">{person.reviewStatus.toUpperCase()}</span>
        <Link className="correct-link" href={`/admin/people?person=${person.id}`}>
          Edit
        </Link>
        <ReviewPerson person={person} />
      </div>
    </article>
  );
}

export function RoleForm({
  role,
  people,
  companies,
  offices,
  sources,
  defaultPersonId,
}: {
  role?: RoleForDesk;
  people: PersonForDesk[];
  companies: CompanyForDesk[];
  offices: RoleOption[];
  sources: CitableSource[];
  defaultPersonId?: string;
}) {
  const [state, action, pending] = useActionState(saveRoleAction, EMPTY);
  const [sourceKind, setSourceKind] = useState(role?.announcementId ? "announcement" : "document");
  const [confirming, setConfirming] = useState(Boolean(role?.lastConfirmedOn));
  const [confirmKind, setConfirmKind] = useState("document");

  const editing = Boolean(role);
  const documents = sources.filter((s) => s.kind === "document");
  const announcements = sources.filter((s) => s.kind === "announcement");

  // The subject of an approved claim is fixed: changing who it is about is a new
  // statement about a different person, and belongs on the withdrawal path.
  const subjectLocked = editing && role?.reviewStatus === "approved";

  return (
    <form action={action} className="auth-form">
      {role ? <input type="hidden" name="roleId" value={role.id} /> : null}

      {subjectLocked ? (
        <>
          <input type="hidden" name="personId" value={role?.personId ?? ""} />
          <input type="hidden" name="companyId" value={role?.companyId ?? ""} />
          <input type="hidden" name="roleCode" value={role?.roleCode ?? ""} />
          <p className="form-note">
            {role?.personName} · {role?.roleName} · {role?.companyName}. Who, where and which office
            cannot be changed on an approved role — that would be a claim about someone a reviewer
            never read. Withdraw it and record the correct one instead.
          </p>
        </>
      ) : (
        <>
          <label>
            Person
            <select name="personId" required defaultValue={role?.personId ?? defaultPersonId ?? ""}>
              <option value="">Choose a person</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.reviewStatus === "approved" ? "" : ` (${p.reviewStatus})`}
                </option>
              ))}
            </select>
          </label>

          <label>
            Company
            <select name="companyId" required defaultValue={role?.companyId ?? ""}>
              <option value="">Choose a company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.symbol ? ` (${c.symbol})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Office
            <select name="roleCode" required defaultValue={role?.roleCode ?? ""}>
              <option value="">Choose an office</option>
              {offices.map((office) => (
                <option key={office.id} value={office.id}>
                  {office.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      <label>
        Title as reported <small>Optional, if the filing words it differently</small>
        <input
          name="roleTitle"
          maxLength={200}
          defaultValue={role?.roleTitle ?? ""}
          placeholder="Group Managing Director/CEO"
        />
      </label>

      <label className="checkbox-label">
        <input type="checkbox" name="isActing" defaultChecked={role?.isActing ?? false} />
        Acting appointment
      </label>

      <label>
        Appointed
        <input
          name="validFrom"
          required
          maxLength={10}
          defaultValue={role?.validFrom?.slice(0, 10) ?? ""}
          placeholder="2015, 2015-06 or 2015-06-12"
        />
        <small>
          Type only what the filing says. &ldquo;2015&rdquo; is recorded as a year and shown as a
          year — it is never turned into a date the source does not give.
        </small>
      </label>

      <label>
        Left <small>Blank if they still hold the office</small>
        <input
          name="validTo"
          maxLength={10}
          defaultValue={role?.validTo?.slice(0, 10) ?? ""}
          placeholder="2022 or 2022-03-31"
        />
      </label>

      <fieldset className="source-fieldset">
        <legend>Evidence</legend>
        <p className="form-note">
          Every role cites one source a reader can open and check. An announcement needs no page; a
          document does.
        </p>
        <label>
          Kind
          <select name="sourceKind" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
            <option value="document">A document page</option>
            <option value="announcement">An announcement</option>
          </select>
        </label>

        {sourceKind === "document" ? (
          <>
            <label>
              Document
              <select name="documentId" defaultValue={role?.documentId ?? ""}>
                <option value="">Choose a document</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Page
              <input
                name="sourcePage"
                inputMode="numeric"
                maxLength={6}
                defaultValue={role?.sourcePage ?? ""}
                placeholder="118"
              />
            </label>
          </>
        ) : (
          <label>
            Announcement
            <select name="announcementId" defaultValue={role?.announcementId ?? ""}>
              <option value="">Choose an announcement</option>
              {announcements.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="source-fieldset">
        <legend>Last confirmed</legend>
        <p className="form-note">
          A board list in last year&apos;s annual report is evidence that someone held office then,
          not that they hold it now. Recording when the role was last checked is what keeps the
          register from going quietly stale.
        </p>
        <label className="checkbox-label">
          <input type="checkbox" checked={confirming} onChange={(e) => setConfirming(e.target.checked)} />
          Record a confirmation
        </label>

        {confirming ? (
          <>
            <label>
              Confirmed on
              <input
                name="lastConfirmedOn"
                maxLength={10}
                defaultValue={role?.lastConfirmedOn?.slice(0, 10) ?? ""}
                placeholder="2026-03-31"
              />
              <small>In full. There is no precision recorded for this one.</small>
            </label>
            <label>
              Confirmed by
              <select
                name="confirmSourceKind"
                value={confirmKind}
                onChange={(e) => setConfirmKind(e.target.value)}
              >
                <option value="document">A document page</option>
                <option value="announcement">An announcement</option>
              </select>
            </label>
            {confirmKind === "document" ? (
              <>
                <label>
                  Document
                  <select name="confirmDocumentId" defaultValue="">
                    <option value="">Choose a document</option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Page
                  <input name="confirmSourcePage" inputMode="numeric" maxLength={6} placeholder="7" />
                </label>
              </>
            ) : (
              <label>
                Announcement
                <select name="confirmAnnouncementId" defaultValue="">
                  <option value="">Choose an announcement</option>
                  {announcements.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : null}
      </fieldset>

      {editing ? (
        <label>
          Why this is changing
          <input
            name="changeReason"
            required
            maxLength={500}
            placeholder="Retirement date added from the 2024 annual report"
          />
        </label>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : editing ? "Save change" : "Record role"}
      </button>
      <Message state={state} />
    </form>
  );
}

export function ReviewRole({ role }: { role: RoleForDesk }) {
  const [state, action, pending] = useActionState(reviewRoleAction, EMPTY);
  const [rejecting, setRejecting] = useState(false);

  if (role.withdrawnAt) return null;

  return (
    <form action={action} className="withdraw-form">
      <input type="hidden" name="roleId" value={role.id} />
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
            {pending ? "Recording…" : role.reviewStatus === "approved" ? "Re-approve" : "Approve"}
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

export function WithdrawRole({ role }: { role: RoleForDesk }) {
  const [state, action, pending] = useActionState(withdrawRoleAction, EMPTY);
  const [open, setOpen] = useState(false);

  if (role.withdrawnAt) return null;

  return (
    <form action={action} className="withdraw-form">
      <input type="hidden" name="roleId" value={role.id} />
      {open ? (
        <>
          <input name="reason" required maxLength={500} placeholder="Why this was never true" />
          <button type="submit" disabled={pending}>
            {pending ? "Withdrawing…" : "Confirm withdrawal"}
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          Withdraw
        </button>
      )}
      <Message state={state} />
    </form>
  );
}

export function RoleRow({ role }: { role: RoleForDesk }) {
  const unreviewed = role.reviewStatus === "approved" && (role.reviewedVersion ?? 0) < role.version;
  const stale = isConfirmationStale(role.validTo, role.lastConfirmedOn);

  const source = role.documentTitle
    ? `${role.documentTitle}, page ${role.sourcePage}`
    : role.announcementHeadline
      ? `Announcement: ${role.announcementHeadline}`
      : "No source recorded";

  return (
    <article className="review-row">
      <div className="review-row-main">
        <strong>
          {role.personName} — {role.roleName}
          {role.isActing ? " (acting)" : ""}
        </strong>
        <p>
          {role.companyName} ·{" "}
          {formatTenure(role.validFrom, role.validFromPrecision, role.validTo, role.validToPrecision)}
        </p>
        {role.roleTitle && role.roleTitle !== role.roleName ? (
          <p className="review-row-meta">Reported as: {role.roleTitle}</p>
        ) : null}
        <p className="review-row-meta">{source}</p>
        <p className="review-row-meta">
          {role.lastConfirmedOn
            ? `Last confirmed: ${formatTenureDate(role.lastConfirmedOn, "day")}`
            : "Never confirmed"}
          {/* Named, not just dated: a reviewer has to be able to check the
              confirmation as well as the original evidence. */}
          {role.confirmationSource ? ` — ${role.confirmationSource}` : ""}
          {" · version "}
          {role.version}
        </p>
        {role.withdrawnAt ? <p className="review-row-meta">Withdrawn: {role.withdrawalReason}</p> : null}
        {unreviewed ? (
          <p className="review-row-meta">Approved, but the role has changed since anyone read it.</p>
        ) : null}
      </div>
      <div className="review-row-actions">
        {role.reviewSelfApproved ? (
          <span className="self-approved-flag" title="Reviewed by the person who recorded the role">
            SELF-APPROVED
          </span>
        ) : null}
        {stale && !role.withdrawnAt ? (
          <span className="role-scope" title="A current role nobody has confirmed in twelve months">
            NEEDS CONFIRMING
          </span>
        ) : null}
        {unreviewed ? <span className="role-scope">UNREVIEWED CHANGES</span> : null}
        <span className="role-scope">{role.withdrawnAt ? "WITHDRAWN" : role.reviewStatus.toUpperCase()}</span>
        {role.withdrawnAt ? null : (
          <Link className="correct-link" href={`/admin/people?role=${role.id}`}>
            Edit
          </Link>
        )}
        <ReviewRole role={role} />
        <WithdrawRole role={role} />
      </div>
    </article>
  );
}
