/**
 * Announcement input rules, kept pure so they can be tested without a database.
 *
 * Every one of these is enforced again by the database. The point here is a
 * readable message at the moment of typing, not security.
 */

/** Mirrors the announcements.category check constraint. */
export const ANNOUNCEMENT_CATEGORIES = [
  "results",
  "corporate_action",
  "board_change",
  "agm",
  "material_event",
  "suspension",
  "delisting",
  "regulatory",
  "offer",
  "other",
] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  results: "Results",
  corporate_action: "Corporate action",
  board_change: "Board change",
  agm: "General meeting",
  material_event: "Material event",
  suspension: "Suspension",
  delisting: "Delisting",
  regulatory: "Regulatory",
  offer: "Public offer",
  other: "Other",
};

export const MAX_HEADLINE = 300;
export const MAX_SUMMARY = 4000;

/** How far ahead an announcement date may be before it is treated as a typo. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * West Africa Time. Nigeria is UTC+1 and has never observed daylight saving, so
 * a fixed offset is exact rather than an approximation.
 */
const WAT_OFFSET = "+01:00";

/**
 * A `datetime-local` value carries no time zone, and `new Date()` would read it
 * in the *server's* zone — UTC in production — while every display path formats
 * in Africa/Lagos. That silently shifts every announcement by an hour. The
 * analyst is typing market time, so it is read as market time.
 */
function parseMarketTime(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const withSeconds = /T\d{2}:\d{2}$/.test(trimmed) ? `${trimmed}:00` : trimmed;
  const parsed = new Date(hasZone ? trimmed : `${withSeconds}${WAT_OFFSET}`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface AnnouncementInput {
  documentId: string;
  category: string;
  headline: string;
  /** A `datetime-local` value, e.g. "2026-11-19T09:30". */
  announcedAt: string;
  summary?: string;
  isCorrection?: boolean;
  correctionReason?: string;
}

export type AnnouncementValidation =
  | { ok: true; announcedAtIso: string }
  | { ok: false; error: string };

export function validateAnnouncement(
  input: AnnouncementInput,
  now: Date = new Date(),
): AnnouncementValidation {
  if (!input.documentId) {
    return { ok: false, error: "Choose the approved document this announcement comes from." };
  }

  if (!(ANNOUNCEMENT_CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, error: "Choose a category." };
  }

  const headline = input.headline.trim();
  if (headline.length < 1) return { ok: false, error: "Write a headline." };
  if (headline.length > MAX_HEADLINE) {
    return { ok: false, error: `Keep the headline under ${MAX_HEADLINE} characters.` };
  }

  if ((input.summary ?? "").length > MAX_SUMMARY) {
    return { ok: false, error: `Keep the summary under ${MAX_SUMMARY} characters.` };
  }

  if (!input.announcedAt) {
    return { ok: false, error: "Say when the issuer announced it." };
  }

  const announced = parseMarketTime(input.announcedAt);
  if (!announced) {
    return { ok: false, error: "That announcement date could not be read." };
  }

  // A date far in the future is a typing slip, not a scheduled publication:
  // this records what an issuer has already said.
  if (announced.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { ok: false, error: "The announcement date is in the future." };
  }

  if (input.isCorrection && !(input.correctionReason ?? "").trim()) {
    return { ok: false, error: "Say what was wrong with the version being corrected." };
  }

  return { ok: true, announcedAtIso: announced.toISOString() };
}
