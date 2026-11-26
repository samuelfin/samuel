/**
 * What a metric definition is, in types and in words.
 *
 * The arithmetic lives in the database, where it reads approved figures under
 * the reader's own row-level security. This module holds only the vocabulary and
 * the plain-language rendering of a formula, so the desk, the company page and the five-year download describe a ratio the same way.
 *
 * Nothing here computes a ratio, and nothing here should ever start to.
 */

export const METRIC_KINDS = ["sum", "margin", "ratio", "average_ratio", "growth", "cagr"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export const METRIC_GROUPS = [
  "profitability",
  "growth",
  "returns",
  "leverage",
  "cash_flow",
  "dividends",
  "banking",
] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

export const METRIC_GROUP_LABELS: Record<MetricGroup, string> = {
  profitability: "Profitability",
  growth: "Growth",
  returns: "Returns",
  leverage: "Leverage",
  cash_flow: "Cash flow",
  dividends: "Dividends",
  banking: "Banking",
};

/** How each shape reads in words, for a page that must explain itself. */
export const METRIC_KIND_LABELS: Record<MetricKind, string> = {
  sum: "Sum of reported figures",
  margin: "Share of a base, as a percentage",
  ratio: "A multiple",
  average_ratio: "Share of the average of two balance-sheet dates",
  growth: "Change from the previous year",
  cagr: "Compound annual growth",
};

/**
 * Where a version stands. 'published' is the one computing numbers today;
 * 'awaiting_approval' is a proposal nobody has decided on; 'rejected' was
 * decided against, and 'retired' was published once and is not now.
 */
export const METRIC_STATUSES = ["published", "awaiting_approval", "rejected", "retired"] as const;
export type MetricStatus = (typeof METRIC_STATUSES)[number];

export const METRIC_STATUS_LABELS: Record<MetricStatus, string> = {
  published: "Published",
  awaiting_approval: "Awaiting approval",
  rejected: "Rejected",
  retired: "Retired",
};

/** Why a calculation has no answer. Every one of these is a sentence, never a zero. */
export const UNAVAILABLE_REASONS = [
  "input_missing",
  "denominator_zero",
  "no_prior_period",
  "insufficient_history",
  "currency_mismatch",
  "basis_mismatch",
  "not_applicable",
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export const METRIC_INPUT_ROLES = ["numerator", "denominator", "base"] as const;
export type MetricInputRole = (typeof METRIC_INPUT_ROLES)[number];

export const METRIC_RESULT_UNITS = ["percent", "times", "currency"] as const;
export type MetricResultUnit = (typeof METRIC_RESULT_UNITS)[number];

export interface MetricInput {
  role: MetricInputRole;
  lineItem: string;
  label: string;
  sign: 1 | -1;
  useAbsolute: boolean;
  sortOrder: number;
}

export interface MetricDefinition {
  id: string;
  code: string;
  version: number;
  label: string;
  definition: string;
  kind: MetricKind;
  resultUnit: MetricResultUnit;
  decimals: number;
  group: MetricGroup;
  /** Null applies to every company; otherwise only to that sector template. */
  templateId: string | null;
  templateName: string | null;
  /** The reported disclosure this derived figure stands aside for. */
  disclosedLineItem: string | null;
  disclosedLabel: string | null;
  windowYears: number | null;
  ownerName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  selfApproved: boolean;
  rejectedAt: string | null;
  /** Why it was approved or rejected. Published with the definition. */
  decisionReason: string | null;
  /** Why this version was recorded at all. */
  recordReason: string | null;
  /** Who recorded it; null where a migration did, which counts as self-approval. */
  recordedBy: string | null;
  effectiveFrom: string;
  isActive: boolean;
  status: MetricStatus;
  sortOrder: number;
  inputs: MetricInput[];
}

/**
 * The formula in words: "Gross profit ÷ Revenue", "Net cash from operations +
 * Capital expenditure". Built from the declared inputs rather than stored as
 * text, so it cannot drift from the arithmetic the database performs.
 */
export function formulaText(definition: {
  kind: MetricKind;
  windowYears: number | null;
  inputs: readonly MetricInput[];
}): string {
  const side = (role: MetricInputRole): string =>
    definition.inputs
      .filter((input) => input.role === role)
      .map((input, index) => {
        const name = input.useAbsolute ? `the size of ${input.label.toLowerCase()}` : input.label;
        if (index === 0) return input.sign < 0 ? `− ${name}` : name;
        return input.sign < 0 ? `− ${name}` : `+ ${name}`;
      })
      .join(" ");

  switch (definition.kind) {
    case "sum":
      return side("numerator");
    case "growth": {
      const base = side("base");
      return `(${base} this year − ${base} last year) ÷ ${base} last year`;
    }
    case "cagr": {
      // Both endpoints, named. "Compounded over five years" could be read as a
      // description of whatever run of years happens to be held, which is the
      // reading that let a two-year change be published as a five-year rate.
      // A five-year rate spans four years of compounding, between this year and
      // the year four years before it, and nothing in between is used.
      const base = side("base");
      const span = (definition.windowYears ?? 5) - 1;
      return `${base} now against ${base.toLowerCase()} ${span} financial years earlier, as an annual compound rate`;
    }
    case "average_ratio":
      return `${side("numerator")} ÷ average ${side("denominator").toLowerCase()}, opening and closing`;
    default:
      return `${side("numerator")} ÷ ${side("denominator")}`;
  }
}

/**
 * Why there is no number, in words a reader can act on.
 *
 * Each reason is a different fact about the company, and collapsing them into
 * one "n/a" would throw away the only part a reader could do something about.
 * "Pending verification" means somebody must enter a figure; "no prior period"
 * means there is nothing missing at all.
 */
export function reasonText(
  reason: UnavailableReason,
  context: {
    kind?: MetricKind;
    windowYears?: number | null;
    /** Catalogue labels of the figures that are missing, in reading order. */
    missingLabels?: readonly string[];
  } = {},
): string {
  switch (reason) {
    case "input_missing": {
      const names = [...(context.missingLabels ?? [])];
      if (names.length === 0) return "Not available: a figure it needs has not been entered yet.";
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      return `Not available: waiting for ${list}, entered from the filing.`;
    }
    case "denominator_zero":
      return "Not available: the figure it divides by is zero.";
    case "no_prior_period":
      return context.kind === "growth"
        ? "Not available: the previous financial year is not held on this basis, so there is nothing to measure the change against."
        : "Not available: the previous financial year is not held on this basis, so there is no opening balance to average.";
    case "insufficient_history": {
      const years = context.windowYears ?? 5;
      return `Not available: a ${years}-year rate is measured against the year ${years - 1} years earlier, which is not held.`;
    }
    case "currency_mismatch":
      return "Not available: a figure it needs is entered in another currency, and figures in two currencies are never combined.";
    case "basis_mismatch":
      return "Not available: a figure it needs is entered on the other basis, and group figures are never combined with company-only ones.";
    case "not_applicable":
      if (context.kind === "growth") {
        return "Not available: the previous year was a loss, so a percentage change would not mean anything.";
      }
      if (context.kind === "cagr") {
        return "Not available: a compound rate needs both years to be positive.";
      }
      return "Not available: the figure it divides by is negative, so the result would read like a ratio and mean nothing.";
  }
}

/**
 * A value as its definition says to show it. Percentages and multiples carry
 * their own decimals; a currency sum carries the filing's own currency code,
 * because this platform does not convert between currencies.
 */
export function formatMetricValue(
  value: string | number | null | undefined,
  unit: MetricResultUnit,
  decimals: number,
  currency?: string | null,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";

  if (unit === "percent") {
    return `${numeric.toFixed(decimals)}%`;
  }
  if (unit === "times") {
    return `${numeric.toFixed(decimals)}×`;
  }
  const amount = new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(numeric);
  return currency ? `${currency} ${amount}` : amount;
}

/**
 * The same reason in two or three words, for a column heading or a year in a
 * strip. The full sentence is always shown too — this is shorthand beside it,
 * never instead of it, and it is never a blank or a zero.
 */
export const REASON_TAGS: Record<UnavailableReason, string> = {
  input_missing: "Pending verification",
  denominator_zero: "Divides by zero",
  no_prior_period: "No prior year",
  insufficient_history: "Too few years",
  currency_mismatch: "Other currency",
  basis_mismatch: "Other basis",
  not_applicable: "Not meaningful",
};
