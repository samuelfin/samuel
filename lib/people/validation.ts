/**
 * What a person record and a leadership role may contain, checked before either
 * reaches the database.
 *
 * The database enforces all of this again — these are the readable messages, not
 * the boundary. This module is importable by client components, so it holds no
 * server-only dependency and no query.
 *
 * Where it is deliberately stricter than the column: a confirmation date must be
 * a full date, because `last_confirmed_on` has no precision column to record
 * anything less, and a name or title may not carry control characters.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ROLE_CODE = /^[a-z][a-z0-9_]{1,47}$/;
/** Control characters, including the newline and tab a browser would strip. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DATE_PRECISIONS = ["day", "month", "year"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** How long a current role may go unconfirmed before the desk flags it. */
export const CONFIRMATION_STALE_MONTHS = 12;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Lowercase words joined by single hyphens, derived from a person's name. */
export function slugifyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

/** A person's address from the route, or null when it could not be one. */
export function normalizePersonSlug(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const slug = decoded.trim().toLowerCase();
  return SLUG.test(slug) && slug.length >= 2 && slug.length <= 120 ? slug : null;
}

export interface TenureDate {
  date: string;
  precision: DatePrecision;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * A tenure boundary carries its own precision, and the shape of what was typed
 * records it. "2015" is a year, "2015-06" a month, "2015-06-12" a day.
 *
 * This is why there is no separate precision control on the form: a filing that
 * says "appointed 2015" gives a year, and asking the analyst to pick a precision
 * beside a full date field invites the two to disagree. Deriving it from the
 * input means the stored precision cannot contradict the stored date.
 */
export function parseTenureDate(raw: string): TenureDate | null {
  const text = (raw ?? "").trim();

  const year = /^(\d{4})$/.exec(text);
  if (year) {
    const value = Number(year[1]);
    if (value < 1800 || value > 2100) return null;
    return { date: `${year[1]}-01-01`, precision: "year" };
  }

  const month = /^(\d{4})-(\d{2})$/.exec(text);
  if (month) {
    const value = Number(month[1]);
    const monthNumber = Number(month[2]);
    if (value < 1800 || value > 2100) return null;
    if (monthNumber < 1 || monthNumber > 12) return null;
    return { date: `${month[1]}-${month[2]}-01`, precision: "month" };
  }

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) {
    const [, y, m, d] = day;
    if (Number(y) < 1800 || Number(y) > 2100) return null;
    // Reject a date the calendar does not have. 2020-02-31 rolls into March in
    // most date handling, which would silently store a different day from the
    // one the filing gives.
    const parsed = new Date(`${y}-${m}-${d}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    if (
      parsed.getUTCFullYear() !== Number(y) ||
      parsed.getUTCMonth() + 1 !== Number(m) ||
      parsed.getUTCDate() !== Number(d)
    ) {
      return null;
    }
    return { date: `${y}-${m}-${d}`, precision: "day" };
  }

  return null;
}

/** Render only what the source actually said. */
export function formatTenureDate(date: string | null, precision: string | null): string {
  if (!date) return "";
  const [y, m, d] = date.slice(0, 10).split("-");
  if (precision === "year") return y;
  if (precision === "month") return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** "2015 – 2022", or "June 2015 – present" while the role is current. */
export function formatTenure(
  from: string | null,
  fromPrecision: string | null,
  to: string | null,
  toPrecision: string | null,
): string {
  const start = formatTenureDate(from, fromPrecision);
  if (!to) return start ? `${start} – present` : "";
  return `${start} – ${formatTenureDate(to, toPrecision)}`;
}

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------

export interface PersonInput {
  fullName: string;
  slug?: string;
  honorific?: string;
  changeReason?: string;
  isEdit?: boolean;
}

export interface ValidPerson {
  ok: true;
  fullName: string;
  slug: string;
  honorific: string | null;
  changeReason: string | null;
}

export type PersonValidation = ValidPerson | { ok: false; error: string };

export function validatePerson(input: PersonInput): PersonValidation {
  const fullName = (input.fullName ?? "").trim();
  if (!fullName) return { ok: false, error: "Give the person's name." };
  if (fullName.length < 2) return { ok: false, error: "That name is too short." };
  if (fullName.length > 200) return { ok: false, error: "That name is too long; 200 characters at most." };
  if (CONTROL.test(fullName)) {
    return { ok: false, error: "The name cannot contain line breaks or control characters." };
  }

  const slug = slugifyName((input.slug ?? "").trim() || fullName);
  if (!slug || slug.length < 2) {
    return {
      ok: false,
      error: "That name gives no usable web address. Type one, using letters and hyphens.",
    };
  }
  if (slug.length > 120) return { ok: false, error: "That web address is too long; 120 characters at most." };
  if (!SLUG.test(slug)) {
    return { ok: false, error: "A web address is lowercase letters, digits and single hyphens." };
  }

  const honorific = clean(input.honorific);
  if (honorific) {
    if (CONTROL.test(honorific)) {
      return { ok: false, error: "The title cannot contain line breaks." };
    }
    if (honorific.length > 40) return { ok: false, error: "That title is too long; 40 characters at most." };
  }

  const changeReason = clean(input.changeReason);
  if (input.isEdit && !changeReason) {
    return {
      ok: false,
      error: "Say why the record is changing. It is kept as part of this person's history.",
    };
  }
  if (changeReason && changeReason.length > 500) {
    return { ok: false, error: "That reason is too long; 500 characters at most." };
  }

  return { ok: true, fullName, slug, honorific, changeReason };
}

// ---------------------------------------------------------------------------

export interface RoleInput {
  personId: string;
  companyId: string;
  roleCode: string;
  roleTitle?: string;
  isActing?: boolean;
  validFrom: string;
  validTo?: string;
  /** "document" or "announcement". */
  sourceKind: string;
  documentId?: string;
  sourcePage?: string;
  announcementId?: string;
  lastConfirmedOn?: string;
  confirmSourceKind?: string;
  confirmDocumentId?: string;
  confirmSourcePage?: string;
  confirmAnnouncementId?: string;
  changeReason?: string;
  isEdit?: boolean;
}

export interface ValidRole {
  ok: true;
  personId: string;
  companyId: string;
  roleCode: string;
  roleTitle: string | null;
  isActing: boolean;
  validFrom: string;
  validFromPrecision: DatePrecision;
  validTo: string | null;
  validToPrecision: DatePrecision | null;
  documentId: string | null;
  sourcePage: number | null;
  announcementId: string | null;
  lastConfirmedOn: string | null;
  confirmDocumentId: string | null;
  confirmSourcePage: number | null;
  confirmAnnouncementId: string | null;
  changeReason: string | null;
}

export type RoleValidation = ValidRole | { ok: false; error: string };

/** A page number as a person would type it, or null when it is not one. */
function pageNumber(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (!/^\d{1,6}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 ? value : null;
}

export function validateCompanyRole(input: RoleInput): RoleValidation {
  if (!isUuid(input.personId ?? "")) return { ok: false, error: "Choose the person." };
  if (!isUuid(input.companyId ?? "")) return { ok: false, error: "Choose the company." };

  const roleCode = (input.roleCode ?? "").trim();
  if (!ROLE_CODE.test(roleCode)) return { ok: false, error: "Choose the office from the list." };

  const roleTitle = clean(input.roleTitle);
  if (roleTitle) {
    if (CONTROL.test(roleTitle)) {
      return { ok: false, error: "The title as reported cannot contain line breaks." };
    }
    if (roleTitle.length < 2 || roleTitle.length > 200) {
      return { ok: false, error: "A title as reported is between 2 and 200 characters." };
    }
  }

  const from = parseTenureDate(input.validFrom ?? "");
  if (!from) {
    return {
      ok: false,
      error: "Give the start as a year, a month or a full date: 2015, 2015-06 or 2015-06-12.",
    };
  }

  let to: TenureDate | null = null;
  if (clean(input.validTo)) {
    to = parseTenureDate(input.validTo ?? "");
    if (!to) {
      return {
        ok: false,
        error: "Give the end as a year, a month or a full date, or leave it blank if the role is current.",
      };
    }
    if (to.date < from.date) return { ok: false, error: "The role cannot end before it began." };
  }

  // Exactly one source. The form offers the choice, so this reads the choice
  // rather than inferring it from whichever field happens to be filled.
  let documentId: string | null = null;
  let sourcePage: number | null = null;
  let announcementId: string | null = null;

  if (input.sourceKind === "document") {
    if (!isUuid(input.documentId ?? "")) return { ok: false, error: "Choose the document this comes from." };
    documentId = input.documentId as string;
    sourcePage = pageNumber(input.sourcePage);
    if (sourcePage === null) {
      return { ok: false, error: "Give the page the role appears on, so a reader can check it." };
    }
  } else if (input.sourceKind === "announcement") {
    if (!isUuid(input.announcementId ?? "")) {
      return { ok: false, error: "Choose the announcement this comes from." };
    }
    announcementId = input.announcementId as string;
  } else {
    return { ok: false, error: "Cite a document page or an announcement." };
  }

  let lastConfirmedOn: string | null = null;
  let confirmDocumentId: string | null = null;
  let confirmSourcePage: number | null = null;
  let confirmAnnouncementId: string | null = null;

  const confirmedRaw = clean(input.lastConfirmedOn);
  if (confirmedRaw) {
    const confirmed = parseTenureDate(confirmedRaw);
    // Stricter than a tenure boundary on purpose: there is no precision column
    // for this date, so a partial one would be stored as a day it does not mean.
    if (!confirmed || confirmed.precision !== "day") {
      return { ok: false, error: "Give the confirmation date in full, as 2026-03-31." };
    }
    if (confirmed.date < from.date) {
      return { ok: false, error: "The role cannot have been confirmed before it began." };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (confirmed.date > today) {
      return { ok: false, error: "The role cannot have been confirmed in the future." };
    }
    lastConfirmedOn = confirmed.date;

    if (input.confirmSourceKind === "document") {
      if (!isUuid(input.confirmDocumentId ?? "")) {
        return { ok: false, error: "Choose the document that confirms the role." };
      }
      confirmDocumentId = input.confirmDocumentId as string;
      confirmSourcePage = pageNumber(input.confirmSourcePage);
      if (confirmSourcePage === null) {
        return { ok: false, error: "Give the page the confirmation appears on." };
      }
    } else if (input.confirmSourceKind === "announcement") {
      if (!isUuid(input.confirmAnnouncementId ?? "")) {
        return { ok: false, error: "Choose the announcement that confirms the role." };
      }
      confirmAnnouncementId = input.confirmAnnouncementId as string;
    } else {
      return { ok: false, error: "Say what confirms the role: a document page or an announcement." };
    }
  } else if (
    input.confirmSourceKind === "document" ||
    input.confirmSourceKind === "announcement" ||
    clean(input.confirmDocumentId) ||
    clean(input.confirmAnnouncementId)
  ) {
    // A source with no date would assert that somebody checked without saying
    // when, which is the half of the claim that makes it useful.
    return { ok: false, error: "Give the date the role was confirmed, or clear the confirming source." };
  }

  const changeReason = clean(input.changeReason);
  if (input.isEdit && !changeReason) {
    return { ok: false, error: "Say why the role is changing. It is kept as history." };
  }
  if (changeReason && changeReason.length > 500) {
    return { ok: false, error: "That reason is too long; 500 characters at most." };
  }

  return {
    ok: true,
    personId: input.personId,
    companyId: input.companyId,
    roleCode,
    roleTitle,
    isActing: Boolean(input.isActing),
    validFrom: from.date,
    validFromPrecision: from.precision,
    validTo: to?.date ?? null,
    validToPrecision: to?.precision ?? null,
    documentId,
    sourcePage,
    announcementId,
    lastConfirmedOn,
    confirmDocumentId,
    confirmSourcePage,
    confirmAnnouncementId,
    changeReason,
  };
}

/** True when a current role has not been confirmed inside the staleness window. */
export function isConfirmationStale(
  validTo: string | null,
  lastConfirmedOn: string | null,
  now: Date = new Date(),
): boolean {
  // A role that has ended needs no confirmation: nobody has to re-check that a
  // former officer still holds an office they left.
  if (validTo) return false;
  if (!lastConfirmedOn) return true;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - CONFIRMATION_STALE_MONTHS);
  return new Date(`${lastConfirmedOn.slice(0, 10)}T00:00:00Z`) < cutoff;
}
