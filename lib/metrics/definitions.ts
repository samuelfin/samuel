/**
 * What a metric definition is, in types and in words.
 *
 * The arithmetic lives in the database, where it reads approved figures under
 * the reader's own row-level security. This module holds only the vocabulary and
 * the plain-language rendering of a formula, so the desk, the company page, the
 * methodology page and the five-year download describe a ratio the same way.
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
  effectiveFrom: string;
  isActive: boolean;
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
    case "cagr":
      return `${side("base")}, compounded over ${definition.windowYears ?? 5} years`;
    case "average_ratio":
      return `${side("numerator")} ÷ average ${side("denominator").toLowerCase()}, opening and closing`;
    default:
      return `${side("numerator")} ÷ ${side("denominator")}`;
  }
}
