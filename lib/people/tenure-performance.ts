/**
 * Company figures shown beside the dates of a tenure.
 *
 * The brief for this panel is narrow and the narrowness is the point: it shows
 * sourced company facts next to the tenure dates, with no scores, no rankings
 * and no causal claims. Attributing a company's results to an individual is a
 * reputational statement about a real person, and it is analytically weak on its
 * own — a tenure overlaps currency moves, commodity cycles and a predecessor's
 * decisions.
 *
 * So the rule is enforced here rather than remembered later:
 *
 *   Every row is a function of its own period and the tenure, and of nothing
 *   else.
 *
 * That single property rules out the whole family of things this panel must not
 * do. A growth rate needs two periods. A delta needs two periods. A ranking
 * needs the other rows. A score needs a formula over several figures. None of
 * them can be computed by a function that cannot see another row, and the tests
 * assert exactly that: a row built from one figure is identical to the same row
 * built from twenty.
 *
 * Figures themselves arrive at stage 3c and the computed metrics at 3d. When
 * they do, they are passed in already formatted as reported — this module never
 * does arithmetic on a value.
 */

/** One reported figure for one period, as an analyst entered it. */
export interface PeriodFigure {
  /** Stable identity for the row, so the list has a key that is not an index. */
  id: string;
  /** What the filing called the period: "FY 2023", "H1 2024". */
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** What was measured: "Revenue", "Profit before tax". */
  metricLabel: string;
  /**
   * The figure exactly as reported, already formatted. A string on purpose:
   * handing this module a number invites it to do arithmetic, and it must not.
   */
  valueAsReported: string;
  /** "₦'000", "₦ million". */
  unit: string;
  sourceTitle: string | null;
  sourceUri: string | null;
  sourcePage: number | null;
}

/** How a reporting period sits against a tenure. Label only, never a judgement. */
export type TenureOverlap = "before" | "starts-during" | "during" | "ends-during" | "after";

export interface TenureRow extends PeriodFigure {
  overlap: TenureOverlap;
  /** True when the whole reporting period falls inside the tenure. */
  withinTenure: boolean;
}

export interface Tenure {
  /** ISO date; the tenure's first day. */
  validFrom: string;
  /** ISO date, or null while the office is still held. */
  validTo: string | null;
}

/** The exact shape of a row, asserted by the tests so a new field is deliberate. */
export const TENURE_ROW_KEYS = [
  "id",
  "periodLabel",
  "periodStart",
  "periodEnd",
  "metricLabel",
  "valueAsReported",
  "unit",
  "sourceTitle",
  "sourceUri",
  "sourcePage",
  "overlap",
  "withinTenure",
] as const;

function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Where one period sits relative to one tenure. Depends on that period and that
 * tenure only — never on another period.
 */
export function overlapFor(figure: PeriodFigure, tenure: Tenure): TenureOverlap {
  const start = day(figure.periodStart);
  const end = day(figure.periodEnd);
  const from = day(tenure.validFrom);
  const to = tenure.validTo ? day(tenure.validTo) : null;

  if (end < from) return "before";
  if (to !== null && start > to) return "after";

  const startsInside = start >= from;
  const endsInside = to === null || end <= to;

  if (startsInside && endsInside) return "during";
  if (!startsInside && endsInside) return "ends-during";
  if (startsInside && !endsInside) return "starts-during";
  // The period encloses the whole tenure: the officer held the office for part
  // of it, which is the same partial story as either end sticking out.
  return "starts-during";
}

/**
 * The rows to display, in reporting order.
 *
 * Sorted by the period's own end date and then by its labels, never by the
 * figure: ordering by value would be a ranking, which is the thing this panel
 * refuses to produce.
 */
export function tenureRows(figures: readonly PeriodFigure[], tenure: Tenure): TenureRow[] {
  return figures
    .map((figure) => {
      const overlap = overlapFor(figure, tenure);
      return {
        ...figure,
        overlap,
        withinTenure: overlap === "during",
      };
    })
    .sort(
      (a, b) =>
        day(a.periodEnd).localeCompare(day(b.periodEnd)) ||
        a.metricLabel.localeCompare(b.metricLabel) ||
        a.periodLabel.localeCompare(b.periodLabel),
    );
}

/** How the panel describes a row's relationship to the tenure, in words. */
export const OVERLAP_LABELS: Record<TenureOverlap, string> = {
  before: "Before this tenure",
  "starts-during": "Partly within this tenure",
  during: "Within this tenure",
  "ends-during": "Partly within this tenure",
  after: "After this tenure",
};
