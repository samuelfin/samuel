/**
 * What a financial statement and its figures may contain, checked before either
 * reaches the database.
 *
 * The database enforces all of this again — these are the readable messages, not
 * the boundary. This module is importable by client components, so it holds no
 * server-only dependency and no query.
 *
 * Two things here are more than validation.
 *
 * `parseFigure` reads what an analyst types off a page: "1,234", "(1,234)",
 * "-1,234", "₦1,234.5". Accounting brackets are how most filings say negative,
 * so the shape of the input records the presentation, exactly as a tenure date's
 * shape records its precision. There is no "is this negative?" box beside the
 * figure field, because two controls for one fact invite each other to disagree.
 *
 * `standardisePreview` mirrors what `record_statement` will store, so the desk
 * can show the analyst the figure that is about to be saved rather than only the
 * one they typed. Two implementations of one rule can drift, so a test runs the
 * same cases through both and requires them to agree.
 */

// A date recorded at the precision its source gave is one idea with one
// implementation. It lives in the people module because leadership needed it
// first, in 3b; duplicating the calendar check here is how the two would drift.
import { formatTenureDate, parseTenureDate } from "@/lib/people/validation";

/** Control characters, including the newline and tab a browser would strip. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_ITEM = /^[a-z][a-z0-9_]{1,63}$/;
const TEMPLATE_ID = /^[a-z][a-z0-9_]{1,47}$/;

export const STATEMENT_TYPES = ["income", "balance_sheet", "cash_flow", "operating"] as const;
export type StatementType = (typeof STATEMENT_TYPES)[number];

export const STATEMENT_TYPE_LABELS: Record<StatementType, string> = {
  income: "Income statement",
  balance_sheet: "Balance sheet",
  cash_flow: "Cash flow",
  operating: "Operating metrics",
};

export const MAGNITUDES = ["units", "thousands", "millions", "billions"] as const;
export type Magnitude = (typeof MAGNITUDES)[number];

export const MAGNITUDE_LABELS: Record<Magnitude, string> = {
  units: "Units",
  thousands: "Thousands",
  millions: "Millions",
  billions: "Billions",
};

const MAGNITUDE_MULTIPLIER: Record<Magnitude, number> = {
  units: 1,
  thousands: 1_000,
  millions: 1_000_000,
  billions: 1_000_000_000,
};

export const PRESENTATIONS = ["plain", "bracketed", "negative"] as const;
export type Presentation = (typeof PRESENTATIONS)[number];

export const UNIT_KINDS = [
  "currency",
  "currency_per_unit",
  "per_share",
  "percent",
  "count",
  "quantity",
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const STANDARD_SIGNS = ["positive", "negative", "signed"] as const;
export type StandardSign = (typeof STANDARD_SIGNS)[number];

/**
 * Only money carries the statement's scale. A statement headed ₦'000 does not
 * make earnings per share a thousand naira, or a disclosed percentage twenty
 * thousand per cent.
 */
export function magnitudeApplies(unitKind: UnitKind): boolean {
  return unitKind === "currency" || unitKind === "currency_per_unit";
}

export const PERIOD_TYPES = ["FY", "H1", "Q1", "Q2", "Q3", "Q4", "9M"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const RESTATEMENT_KINDS = ["issuer_restated", "sfi_correction"] as const;
export type RestatementKind = (typeof RESTATEMENT_KINDS)[number];

export const RESTATEMENT_LABELS: Record<RestatementKind, string> = {
  // The distinction a reader is entitled to: the company revised its own
  // history, or this desk typed it wrong. One field for both would attribute our
  // error to the issuer.
  issuer_restated: "The issuer restated these figures",
  sfi_correction: "We are correcting our own entry",
};

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export interface ParsedFigure {
  /** The figure as printed, brackets stripped. */
  value: number;
  presentation: Presentation;
}

/**
 * A figure as an analyst reads it off the page.
 *
 * Accepted: digits with optional thousands separators (comma, space or
 * underscore), an optional decimal part, an optional currency symbol, and either
 * accounting brackets or a leading minus — never both, because a bracketed
 * negative is a double negative nobody means.
 */
export function parseFigure(raw: string): ParsedFigure | null {
  const text = (raw ?? "").trim();
  if (!text || CONTROL.test(text)) return null;

  const bracketed = /^\((.*)\)$/.exec(text);
  const inner = (bracketed ? bracketed[1] : text).trim();

  let body = inner;
  let negative = false;
  const signed = /^([+-])(.*)$/.exec(body);
  if (signed) {
    // "(-1,200)" is a double negative: refuse rather than guess which was meant.
    if (bracketed) return null;
    negative = signed[1] === "-";
    body = signed[2].trim();
  }

  // One optional currency symbol, stripped. Which currency it is belongs to the
  // statement, not to the cell.
  body = body.replace(/^[₦$€£]\s*/, "").trim();
  if (!body) return null;

  // Separators are presentation. A leading, trailing or doubled one is a typo.
  if (/[,\s_]{2,}/.test(body) || /[,\s_]$/.test(body) || /^[,\s_]/.test(body)) return null;
  const digits = body.replace(/[,\s_]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;

  const printed = Number(digits);
  if (!Number.isFinite(printed)) return null;
  // Beyond this a double loses integer precision, and no filing needs it.
  if (printed > 1e15) return null;

  if (bracketed) return { value: printed, presentation: "bracketed" };
  if (negative) return { value: -printed, presentation: "negative" };
  return { value: printed, presentation: "plain" };
}

/**
 * What `record_statement` will store for a figure. Kept in step with the SQL by
 * a test that runs the same cases through both.
 *
 * Returns null where the database would refuse — a figure that cannot be
 * negative, presented as negative.
 */
export function standardisePreview(input: {
  value: number;
  presentation: Presentation;
  magnitude: Magnitude;
  standardSign: StandardSign;
}): number | null {
  const signed =
    input.presentation === "bracketed" || input.presentation === "negative"
      ? -Math.abs(input.value)
      : input.value;

  let standardised: number;
  if (input.standardSign === "positive") {
    if (signed < 0) return null;
    standardised = signed;
  } else if (input.standardSign === "negative") {
    standardised = -Math.abs(signed);
  } else {
    standardised = signed;
  }

  return standardised * MAGNITUDE_MULTIPLIER[input.magnitude];
}

/** A real calendar date in ISO form, or null. */
export function parseIsoDate(raw: string): string | null {
  const text = (raw ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (year < 1800 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // 2020-02-31 rolls into March in most date handling, which would store a
  // different day from the one the filing shows.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

/**
 * The year a period belongs to, for the coverage grid. A financial year is named
 * for the year its reporting date falls in, which is what Nigerian filings do —
 * including the March year-ends.
 */
export function financialYearOf(periodEnd: string): number | null {
  const iso = parseIsoDate(periodEnd);
  return iso ? Number(iso.slice(0, 4)) : null;
}

export interface PeriodInput {
  periodEnd: string;
  periodStart?: string;
}

export interface ParsedPeriod {
  periodStart: string;
  periodEnd: string;
}

/**
 * A period from its reporting date. The start defaults to twelve months before
 * the end rather than to the first of January: Nigerian year-ends are mostly
 * December but not all of them are, and assuming a calendar year would store a
 * period the filing does not cover.
 */
export function parsePeriod(input: PeriodInput): ParsedPeriod | null {
  const end = parseIsoDate(input.periodEnd);
  if (!end) return null;

  const explicitStart = (input.periodStart ?? "").trim();
  if (explicitStart) {
    const start = parseIsoDate(explicitStart);
    if (!start || start >= end) return null;
    return { periodStart: start, periodEnd: end };
  }

  const [y, m, d] = end.split("-").map(Number);
  const dayAfter = new Date(Date.UTC(y - 1, m - 1, d));
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  return { periodStart: dayAfter.toISOString().slice(0, 10), periodEnd: end };
}

export interface LineInput {
  lineItem: string;
  /** What the analyst typed, unparsed. */
  raw: string;
  magnitude?: string;
  sourcePage: string;
  asRestated?: boolean;
  aiAssisted?: boolean;
  note?: string;
}

export interface LineDefinition {
  lineItem: string;
  label: string;
  statementType: StatementType;
  unitKind: UnitKind;
  unitLabel: string;
  standardSign: StandardSign;
}

export interface PreparedLine {
  line_item: string;
  value_reported: number;
  presentation: Presentation;
  magnitude: Magnitude;
  source_page: number;
  as_restated: boolean;
  ai_assisted: boolean;
  note: string | null;
  /** For the desk's preview. Not sent: the database computes its own. */
  standardised: number;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function parsePage(raw: string): number | null {
  const text = (raw ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const page = Number(text);
  return page >= 1 ? page : null;
}

/** One figure, against its catalogue definition. */
export function validateLine(
  line: LineInput,
  definition: LineDefinition,
  statementMagnitude: Magnitude,
): Validated<PreparedLine> {
  if (!LINE_ITEM.test(line.lineItem)) {
    return { ok: false, error: "That is not a figure this desk can record." };
  }

  const figure = parseFigure(line.raw);
  if (!figure) {
    return {
      ok: false,
      error: `${definition.label}: "${(line.raw ?? "").trim()}" is not a figure. Type it as it appears — 1,234, or (1,234) for a bracketed one.`,
    };
  }

  const page = parsePage(line.sourcePage);
  if (page === null) {
    return { ok: false, error: `${definition.label}: give the page of the filing this figure appears on.` };
  }

  const applies = magnitudeApplies(definition.unitKind);
  const chosen = (line.magnitude ?? "").trim();
  if (chosen && !(MAGNITUDES as readonly string[]).includes(chosen)) {
    return { ok: false, error: `${definition.label}: that is not a scale we store.` };
  }
  const magnitude: Magnitude = chosen ? (chosen as Magnitude) : applies ? statementMagnitude : "units";

  const standardised = standardisePreview({
    value: figure.value,
    presentation: figure.presentation,
    magnitude,
    standardSign: definition.standardSign,
  });
  if (standardised === null) {
    return {
      ok: false,
      error: `${definition.label} cannot be negative. Check the figure, and whether the brackets belong to it.`,
    };
  }

  const note = (line.note ?? "").trim();
  if (note && (note.length < 2 || note.length > 500 || CONTROL.test(note))) {
    return { ok: false, error: `${definition.label}: that note is not usable.` };
  }

  return {
    ok: true,
    value: {
      line_item: line.lineItem,
      value_reported: figure.value,
      presentation: figure.presentation,
      magnitude,
      source_page: page,
      as_restated: Boolean(line.asRestated),
      ai_assisted: Boolean(line.aiAssisted),
      note: note || null,
      standardised,
    },
  };
}

export interface StatementInput {
  companyId: string;
  statementType: string;
  periodType: string;
  periodEnd: string;
  periodStart?: string;
  audited: boolean;
  consolidated: boolean;
  currency: string;
  magnitude: string;
  documentId: string;
  publishedAt?: string;
  supersedesId?: string;
  restatementKind?: string;
  correctionReason?: string;
  lines: LineInput[];
}

export interface PreparedStatement {
  companyId: string;
  statementType: StatementType;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  audited: boolean;
  consolidated: boolean;
  currency: string;
  magnitude: Magnitude;
  documentId: string;
  publishedAt: string | null;
  supersedesId: string | null;
  restatementKind: RestatementKind | null;
  correctionReason: string | null;
  lines: PreparedLine[];
}

/**
 * A whole statement, or nothing. The database will not accept a half-entered
 * period, so neither does the desk: an analyst should see every problem at once
 * rather than one per submission.
 */
export function validateStatement(
  input: StatementInput,
  definitions: readonly LineDefinition[],
  required: readonly string[] = [],
): Validated<PreparedStatement> {
  if (!isUuid(input.companyId)) return { ok: false, error: "Choose the company these figures belong to." };
  if (!isUuid(input.documentId)) {
    return {
      ok: false,
      error: "Choose the filing these figures come from. Every figure cites a document and a page.",
    };
  }

  if (!(STATEMENT_TYPES as readonly string[]).includes(input.statementType)) {
    return { ok: false, error: "Choose which statement this is." };
  }
  const statementType = input.statementType as StatementType;

  if (!(PERIOD_TYPES as readonly string[]).includes(input.periodType)) {
    return { ok: false, error: "Choose the reporting period." };
  }
  const periodType = input.periodType as PeriodType;

  const period = parsePeriod({ periodEnd: input.periodEnd, periodStart: input.periodStart });
  if (!period) {
    return { ok: false, error: "Give the period's reporting date, and a start date earlier than it." };
  }

  if (!/^[A-Za-z]{3}$/.test((input.currency ?? "").trim())) {
    return { ok: false, error: "Give the currency the filing reports in, as a three-letter code." };
  }
  const currency = input.currency.trim().toUpperCase();

  const magnitudeRaw = (input.magnitude ?? "").trim();
  if (!(MAGNITUDES as readonly string[]).includes(magnitudeRaw)) {
    return { ok: false, error: "Choose the scale the filing presents its figures in." };
  }
  const magnitude = magnitudeRaw as Magnitude;

  const publishedRaw = (input.publishedAt ?? "").trim();
  let publishedAt: string | null = null;
  if (publishedRaw) {
    const parsed = parseIsoDate(publishedRaw);
    if (!parsed) return { ok: false, error: "The publication date is not a real date." };
    publishedAt = parsed;
  }

  const supersedesRaw = (input.supersedesId ?? "").trim();
  let supersedesId: string | null = null;
  let restatementKind: RestatementKind | null = null;
  let correctionReason: string | null = null;
  if (supersedesRaw) {
    if (!isUuid(supersedesRaw)) return { ok: false, error: "That is not a statement this can replace." };
    supersedesId = supersedesRaw;

    const kind = (input.restatementKind ?? "").trim();
    if (!(RESTATEMENT_KINDS as readonly string[]).includes(kind)) {
      return {
        ok: false,
        error: "Say which this is: the issuer restated these figures, or we are correcting our own entry.",
      };
    }
    restatementKind = kind as RestatementKind;

    const reason = (input.correctionReason ?? "").trim();
    if (reason.length < 4 || reason.length > 1000 || CONTROL.test(reason)) {
      return { ok: false, error: "Say why the figures are changing. The reason is published with the correction." };
    }
    correctionReason = reason;
  } else if ((input.restatementKind ?? "").trim() || (input.correctionReason ?? "").trim()) {
    return {
      ok: false,
      error:
        "A first entry is the original reading of the filing. Choose the statement it replaces to record a restatement.",
    };
  }

  const byItem = new Map(definitions.map((d) => [d.lineItem, d]));
  const entered = input.lines.filter((line) => (line.raw ?? "").trim() !== "");
  if (entered.length === 0) {
    return { ok: false, error: "Enter at least one figure." };
  }

  const seen = new Set<string>();
  const prepared: PreparedLine[] = [];
  for (const line of entered) {
    if (seen.has(line.lineItem)) {
      return { ok: false, error: "The same figure was entered twice." };
    }
    seen.add(line.lineItem);

    const definition = byItem.get(line.lineItem);
    if (!definition) {
      return { ok: false, error: "A figure was entered that is not part of this company's template." };
    }
    if (definition.statementType !== statementType) {
      return {
        ok: false,
        error: `${definition.label} belongs to the ${STATEMENT_TYPE_LABELS[
          definition.statementType
        ].toLowerCase()}, not this one.`,
      };
    }

    const result = validateLine(line, definition, magnitude);
    if (!result.ok) return result;
    prepared.push(result.value);
  }

  const missing = required.filter((item) => !seen.has(item));
  if (missing.length > 0) {
    const labels = missing.map((item) => byItem.get(item)?.label ?? item);
    return {
      ok: false,
      error: `This statement is missing figures the template requires: ${labels.join(", ")}.`,
    };
  }

  return {
    ok: true,
    value: {
      companyId: input.companyId,
      statementType,
      periodType,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      audited: input.audited,
      consolidated: input.consolidated,
      currency,
      magnitude,
      documentId: input.documentId,
      publishedAt,
      supersedesId,
      restatementKind,
      correctionReason,
      lines: prepared,
    },
  };
}

export interface TemplateAssignmentInput {
  companyId: string;
  templateId: string;
  validFrom: string;
  note?: string;
}

export function validateTemplateAssignment(
  input: TemplateAssignmentInput,
): Validated<{ companyId: string; templateId: string; validFrom: string; note: string | null }> {
  if (!isUuid(input.companyId)) return { ok: false, error: "Choose a company." };
  if (!TEMPLATE_ID.test(input.templateId)) return { ok: false, error: "Choose a template." };
  const validFrom = parseIsoDate(input.validFrom);
  if (!validFrom) {
    return { ok: false, error: "Give the date from which this company is entered under that template." };
  }
  const note = (input.note ?? "").trim();
  if (note && (note.length < 2 || note.length > 500 || CONTROL.test(note))) {
    return { ok: false, error: "That note is not usable." };
  }
  return {
    ok: true,
    value: { companyId: input.companyId, templateId: input.templateId, validFrom, note: note || null },
  };
}

export const SUCCESSION_RELATIONSHIPS = [
  "holdco_reorganisation",
  "merger",
  "acquisition",
  "renaming",
  "listing_of_existing_business",
] as const;
export type SuccessionRelationship = (typeof SUCCESSION_RELATIONSHIPS)[number];

export const SUCCESSION_LABELS: Record<SuccessionRelationship, string> = {
  holdco_reorganisation: "A holding company was established over it",
  merger: "It merged into the successor",
  acquisition: "It was acquired by the successor",
  renaming: "It was renamed",
  listing_of_existing_business: "The existing business listed under a new entity",
};

export interface SuccessionInput {
  predecessorCompanyId: string;
  successorCompanyId: string;
  relationship: string;
  effectiveOn: string;
  sourceKind: string;
  documentId?: string;
  sourcePage?: string;
  announcementId?: string;
  note?: string;
}

export interface PreparedSuccession {
  predecessorCompanyId: string;
  successorCompanyId: string;
  relationship: SuccessionRelationship;
  effectiveOn: string;
  effectivePrecision: "day" | "month" | "year";
  documentId: string | null;
  sourcePage: number | null;
  announcementId: string | null;
  note: string | null;
}

export function validateSuccession(input: SuccessionInput): Validated<PreparedSuccession> {
  if (!isUuid(input.predecessorCompanyId)) return { ok: false, error: "Choose the former company." };
  if (!isUuid(input.successorCompanyId)) return { ok: false, error: "Choose the company that succeeded it." };
  if (input.predecessorCompanyId === input.successorCompanyId) {
    return { ok: false, error: "A company cannot succeed itself." };
  }

  if (!(SUCCESSION_RELATIONSHIPS as readonly string[]).includes(input.relationship)) {
    return { ok: false, error: "Say what happened: a holding company, a merger, an acquisition or a renaming." };
  }

  // The same discipline as a tenure boundary, and the same implementation: a
  // filing that says "2022" must not be stored as a day in January, and the
  // shape of what was typed is what records the precision. One idea, one
  // function — leadership simply needed it first.
  const effective = parseTenureDate(input.effectiveOn);
  if (!effective) {
    return {
      ok: false,
      error: "Give the date it took effect as the source gives it — 2022, 2022-06 or 2022-06-12.",
    };
  }

  const note = (input.note ?? "").trim();
  if (note && (note.length < 2 || note.length > 500 || CONTROL.test(note))) {
    return { ok: false, error: "That note is not usable." };
  }

  // Exactly one source, the constraint the database enforces: a citation
  // pointing at two things supports neither.
  if (input.sourceKind === "document") {
    const documentId = (input.documentId ?? "").trim();
    if (!isUuid(documentId)) return { ok: false, error: "Choose the filing that evidences this." };
    const pageRaw = (input.sourcePage ?? "").trim();
    if (!/^\d{1,5}$/.test(pageRaw) || Number(pageRaw) < 1) {
      return { ok: false, error: "Give the page of the filing this appears on." };
    }
    return {
      ok: true,
      value: {
        predecessorCompanyId: input.predecessorCompanyId,
        successorCompanyId: input.successorCompanyId,
        relationship: input.relationship as SuccessionRelationship,
        effectiveOn: effective.date,
        effectivePrecision: effective.precision,
        documentId,
        sourcePage: Number(pageRaw),
        announcementId: null,
        note: note || null,
      },
    };
  }

  if (input.sourceKind === "announcement") {
    const announcementId = (input.announcementId ?? "").trim();
    if (!isUuid(announcementId)) return { ok: false, error: "Choose the announcement that evidences this." };
    return {
      ok: true,
      value: {
        predecessorCompanyId: input.predecessorCompanyId,
        successorCompanyId: input.successorCompanyId,
        relationship: input.relationship as SuccessionRelationship,
        effectiveOn: effective.date,
        effectivePrecision: effective.precision,
        documentId: null,
        sourcePage: null,
        announcementId,
        note: note || null,
      },
    };
  }

  return { ok: false, error: "Cite either a filing and its page, or an announcement." };
}

/**
 * Checks that should make a reviewer look, and must not stop a save.
 *
 * A reported balance sheet that does not foot is still what the filing says.
 * Refusing it would make the stored figures disagree with the page, and an
 * analyst whose form will not submit types something else instead. So these are
 * warnings, every time.
 */
export interface FootingWarning {
  message: string;
}

/** Published statements round; a filing's own total can differ by a unit or two. */
const TOLERANCE = 2;

export function footingWarnings(
  statementType: StatementType,
  lines: readonly PreparedLine[],
): FootingWarning[] {
  const value = (item: string): number | null => {
    const line = lines.find((l) => l.line_item === item);
    return line ? line.standardised : null;
  };
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(TOLERANCE, Math.abs(b) * 0.005);
  const warnings: FootingWarning[] = [];

  if (statementType === "balance_sheet") {
    const assets = value("total_assets");
    const liabilities = value("total_liabilities");
    const equity = value("shareholders_equity");
    if (assets !== null && liabilities !== null && equity !== null && !near(assets, liabilities + equity)) {
      warnings.push({
        message:
          "Total assets do not equal total liabilities plus equity. Check the figures against the page — if that is how the filing presents it, record it as it reads.",
      });
    }
    const borrowings = value("total_borrowings");
    if (borrowings !== null && liabilities !== null && borrowings > liabilities + TOLERANCE) {
      warnings.push({
        message:
          "Borrowings are larger than total liabilities, which usually means one of the two is on the wrong line.",
      });
    }
  }

  if (statementType === "income") {
    const revenue = value("revenue");
    const cost = value("cost_of_sales");
    const gross = value("gross_profit");
    // Cost lines are stored negative, so gross profit is a sum.
    if (revenue !== null && cost !== null && gross !== null && !near(gross, revenue + cost)) {
      warnings.push({
        message: "Gross profit does not equal revenue less cost of sales. Check which figures the filing reports.",
      });
    }
    const pbt = value("profit_before_tax");
    const tax = value("income_tax_expense");
    const pat = value("profit_after_tax");
    if (pbt !== null && tax !== null && pat !== null && !near(pat, pbt + tax)) {
      warnings.push({ message: "Profit after tax does not equal profit before tax less the tax charge." });
    }
    if (revenue !== null && pat !== null && revenue !== 0 && Math.abs(pat) > Math.abs(revenue)) {
      warnings.push({
        message: "Profit is larger than revenue. That does happen, but check the scale of both.",
      });
    }
  }

  return warnings;
}

/**
 * A succession date as precisely as its source gave it: "2022", "June 2022" or
 * a day. Re-exported so a caller does not have to reach into the people module
 * for it.
 */
export function formatSourceDate(date: string, precision: "day" | "month" | "year"): string {
  return formatTenureDate(date, precision);
}

/** A figure as the filing presented it: its own scale, not ours. */
export function formatReported(value: number, magnitude: Magnitude, unitLabel: string): string {
  const formatted = value.toLocaleString("en-NG", { maximumFractionDigits: 2 });
  const scale = magnitude === "units" ? "" : ` ${MAGNITUDE_LABELS[magnitude].toLowerCase()}`;
  if (unitLabel === "%") return `${formatted}%`;
  if (unitLabel === "currency") return `${formatted}${scale}`;
  return `${formatted}${scale} ${unitLabel}`.trim();
}
