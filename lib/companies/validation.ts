/**
 * What a company profile may contain, checked before it reaches the database.
 *
 * The database enforces all of this again — these are the readable messages, not
 * the boundary. Where the two differ this module is deliberately stricter: a
 * website must be a single clean line, because the column's `^https?://` check
 * is not newline-sensitive and a URL carrying a newline is a link no reader
 * should be handed, even though no browser would execute it.
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NGX_SYMBOL = /^[A-Z][A-Z0-9.]{1,14}$/;
/** Control characters, including the newline and tab a browser would strip. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export const LISTING_STATUSES = ["pre_listing", "listed", "suspended", "delisted", "unlisted"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  pre_listing: "Pre-listing",
  listed: "Listed",
  suspended: "Suspended",
  delisted: "Delisted",
  unlisted: "Unlisted",
};

/**
 * The boards the Nigerian Exchange operates, offered in the form as suggestions
 * rather than enforced in the database: NGX wound down the Alternative
 * Securities Market with effect from 1 July 2025 and moved eligible companies to
 * the Growth Board, so ASeM is history that still has to be recordable, and how
 * the Growth Board's segments should be written down is not yet settled.
 *
 * These live here rather than beside the queries because the registry form is a
 * client component and the query module is server-only.
 */
export const NGX_BOARDS = ["Premium Board", "Main Board", "Growth Board"] as const;

export interface CompanyInput {
  name: string;
  slug: string;
  listingStatus: string;
  legalName?: string;
  sectorId?: string;
  industry?: string;
  description?: string;
  website?: string;
  listingBoard?: string;
  ngxSymbol?: string;
  changeReason?: string;
  /** True when editing an existing company, which requires a reason. */
  isEdit?: boolean;
}

export interface ValidCompany {
  ok: true;
  name: string;
  slug: string;
  listingStatus: ListingStatus;
  legalName: string | null;
  sectorId: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  listingBoard: string | null;
  ngxSymbol: string | null;
  changeReason: string | null;
}

export type CompanyValidation = ValidCompany | { ok: false; error: string };

/** Lowercase words joined by single hyphens, derived from a company name. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

/**
 * Resolving an address from the route. These decide what the company page will
 * even look up, so the redirect destination can never be anything but a slug
 * that passed this shape — which is what keeps /companies/[slug] from becoming
 * an open redirect.
 */
/** NGX symbols are upper-case letters/digits, sometimes with a dot. Returns null if malformed. */
export function normalizeSymbol(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const symbol = decoded.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{1,14}$/.test(symbol) ? symbol : null;
}

/** Company web addresses are lowercase words joined by single hyphens. */
export function normalizeSlug(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const slug = decoded.trim().toLowerCase();
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 120 ? slug : null;
}

function clean(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function validateCompany(input: CompanyInput): CompanyValidation {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Give the company a name." };
  if (name.length > 200) return { ok: false, error: "That name is too long; 200 characters at most." };
  if (CONTROL.test(name)) return { ok: false, error: "The name cannot contain line breaks or control characters." };

  // An empty address is derived from the name, which is what the form suggests
  // anyway. A given one is normalised rather than rejected for its spacing.
  const slug = slugify((input.slug ?? "").trim() || name);
  if (!slug || slug.length < 2) {
    return { ok: false, error: "That name gives no usable web address. Type one, using letters and hyphens." };
  }
  if (slug.length > 120) return { ok: false, error: "That web address is too long; 120 characters at most." };
  if (!SLUG.test(slug)) {
    return { ok: false, error: "A web address is lowercase letters, digits and single hyphens." };
  }

  if (!(LISTING_STATUSES as readonly string[]).includes(input.listingStatus)) {
    return { ok: false, error: "Choose a listing status." };
  }
  const listingStatus = input.listingStatus as ListingStatus;

  let ngxSymbol: string | null = null;
  const rawSymbol = clean(input.ngxSymbol);
  if (rawSymbol) {
    ngxSymbol = rawSymbol.toUpperCase();
    if (!NGX_SYMBOL.test(ngxSymbol)) {
      return {
        ok: false,
        error: "An NGX symbol is 2 to 15 characters: letters, digits and dots, starting with a letter.",
      };
    }
  }

  // A listed company has to be reachable by the symbol a reader knows. One
  // awaiting its offer, or no longer trading, need not be.
  if (listingStatus === "listed" && !ngxSymbol) {
    return { ok: false, error: "A listed company needs its NGX symbol, so readers can find it." };
  }

  const website = clean(input.website);
  if (website) {
    if (CONTROL.test(website)) {
      return { ok: false, error: "That web address contains a line break. Paste it as a single line." };
    }
    if (!/^https?:\/\/\S+$/.test(website)) {
      return { ok: false, error: "A website must start with http:// or https:// and contain no spaces." };
    }
    if (website.length > 500) return { ok: false, error: "That website address is too long." };
  }

  const listingBoard = clean(input.listingBoard);
  if (listingBoard) {
    if (CONTROL.test(listingBoard)) {
      return { ok: false, error: "The board name cannot contain line breaks." };
    }
    if (listingBoard.length < 2 || listingBoard.length > 60) {
      return { ok: false, error: "A board name is between 2 and 60 characters." };
    }
  }

  // Checked for the same reason as the name: these are rendered as text, so a
  // line break is not dangerous, but it is never intended and it makes a value
  // that looks fine in a table unusable in a heading or a link label.
  for (const [field, value] of [
    ["legal name", input.legalName],
    ["industry", input.industry],
    ["description", input.description],
  ] as const) {
    if (typeof value === "string" && CONTROL.test(value)) {
      return { ok: false, error: `The ${field} cannot contain line breaks or control characters.` };
    }
  }

  const sectorId = clean(input.sectorId);
  if (sectorId && !/^[a-z][a-z0-9_]{1,47}$/.test(sectorId)) {
    return { ok: false, error: "Choose a sector from the list." };
  }

  const description = clean(input.description);
  if (description && description.length > 4000) {
    return { ok: false, error: "That description is too long; 4000 characters at most." };
  }

  const changeReason = clean(input.changeReason);
  // Every change is kept as history, and history without a reason is a diff
  // nobody can interpret later.
  if (input.isEdit && !changeReason) {
    return { ok: false, error: "Say why the profile is changing. It is kept as part of the company's history." };
  }
  if (changeReason && changeReason.length > 500) {
    return { ok: false, error: "That reason is too long; 500 characters at most." };
  }

  return {
    ok: true,
    name,
    slug,
    listingStatus,
    legalName: clean(input.legalName),
    sectorId,
    industry: clean(input.industry),
    description,
    website,
    listingBoard,
    ngxSymbol,
    changeReason,
  };
}
