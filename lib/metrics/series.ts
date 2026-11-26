import type { MetricResultUnit, UnavailableReason } from "./definitions";

/**
 * One series, read once, drawn twice.
 *
 * A chart and the table beside it must be the same numbers. The cheapest way to
 * guarantee that is to give them one array to render, built here: this module
 * selects and orders, and divides nothing. Every value it carries was either
 * reported in a filing or computed by the database.
 *
 * A year with no figure stays in the series as a point with no value and a
 * reason. Dropping it would close the gap and draw a line between two years that
 * are not adjacent — the chart equivalent of interpolating, and the one thing a
 * history chart must never do.
 */

export interface SeriesPoint {
  financialYear: number;
  /** Null where there is no figure. The chart leaves a gap; the table says why. */
  value: number | null;
  /** The figure as the filing printed it, for a label and a table cell. */
  reported: string | null;
  /** Why there is no value: a reason code for a ratio, or null for a figure. */
  reason: UnavailableReason | null;
  sourcePage: number | null;
  documentTitle: string | null;
  sourceUri: string | null;
  audited: boolean | null;
  consolidated: boolean | null;
  currency: string | null;
  /** True where the issuer disclosed the figure and SFI stood aside. */
  disclosed: boolean;
}

export interface Series {
  key: string;
  label: string;
  unit: MetricResultUnit;
  decimals: number;
  points: SeriesPoint[];
}

/** The window a five-year history is drawn over: the latest years held, ascending. */
export function seriesYears(years: readonly number[], count = 5): number[] {
  return [...new Set(years)]
    .sort((a, b) => b - a)
    .slice(0, count)
    .sort((a, b) => a - b);
}

export interface FigureSource {
  financialYear: number;
  lineItem: string;
  valueStandardised: number;
  reported: string;
  sourcePage: number;
  documentTitle: string | null;
  sourceUri: string | null;
  audited: boolean;
  consolidated: boolean;
  currency: string;
}

/**
 * A reported line across the window. Years with no entry are kept as gaps, so a
 * chart cannot draw across them and a table has somewhere to say so.
 */
export function figureSeries(
  source: readonly FigureSource[],
  options: { lineItem: string; label: string; years: readonly number[]; decimals?: number },
): Series {
  const byYear = new Map(
    source.filter((row) => row.lineItem === options.lineItem).map((row) => [row.financialYear, row]),
  );

  return {
    key: options.lineItem,
    label: options.label,
    unit: "currency",
    decimals: options.decimals ?? 0,
    points: options.years.map((financialYear) => {
      const row = byYear.get(financialYear);
      return {
        financialYear,
        value: row ? row.valueStandardised : null,
        reported: row ? row.reported : null,
        reason: null,
        sourcePage: row ? row.sourcePage : null,
        documentTitle: row ? row.documentTitle : null,
        sourceUri: row ? row.sourceUri : null,
        audited: row ? row.audited : null,
        consolidated: row ? row.consolidated : null,
        currency: row ? row.currency : null,
        disclosed: false,
      };
    }),
  };
}

export interface MetricSource {
  code: string;
  financialYear: number;
  status: "available" | "disclosed" | "not_available";
  reason: UnavailableReason | null;
  value: string | null;
  resultUnit: MetricResultUnit;
  currency: string;
  consolidated: boolean;
  allAudited: boolean | null;
  disclosedPage: number | null;
}

/** A calculated or disclosed ratio across the window, gaps and reasons intact. */
export function metricSeries(
  source: readonly MetricSource[],
  options: { code: string; label: string; years: readonly number[]; decimals: number },
): Series {
  const rows = source.filter((row) => row.code === options.code);
  const byYear = new Map(rows.map((row) => [row.financialYear, row]));

  return {
    key: options.code,
    label: options.label,
    unit: rows[0]?.resultUnit ?? "percent",
    decimals: options.decimals,
    points: options.years.map((financialYear) => {
      const row = byYear.get(financialYear);
      const hasValue = row !== undefined && row.status !== "not_available" && row.value !== null;
      return {
        financialYear,
        value: hasValue ? Number(row.value) : null,
        reported: hasValue ? row.value : null,
        reason: row ? row.reason : null,
        sourcePage: row ? row.disclosedPage : null,
        documentTitle: null,
        sourceUri: null,
        audited: row ? row.allAudited : null,
        consolidated: row ? row.consolidated : null,
        currency: row ? row.currency : null,
        disclosed: row?.status === "disclosed",
      };
    }),
  };
}

/** The runs of consecutive years that hold a value, so a line breaks at a gap. */
export function valueRuns(points: readonly SeriesPoint[]): SeriesPoint[][] {
  const runs: SeriesPoint[][] = [];
  let run: SeriesPoint[] = [];
  for (const point of points) {
    if (point.value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push(point);
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * The extent a chart is drawn over. Zero is included for bars, because a bar
 * chart whose baseline is not zero exaggerates every difference on it.
 */
export function extent(
  series: readonly Series[],
  includeZero: boolean,
): { min: number; max: number } {
  const values = series.flatMap((entry) =>
    entry.points.map((point) => point.value).filter((value): value is number => value !== null),
  );
  if (values.length === 0) return { min: 0, max: 1 };

  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const min = includeZero ? Math.min(0, lowest) : lowest;
  const max = includeZero ? Math.max(0, highest) : highest;
  if (min === max) return { min: Math.min(0, min), max: max === 0 ? 1 : max };
  return { min, max };
}
