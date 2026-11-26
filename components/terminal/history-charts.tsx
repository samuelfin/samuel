import { formatMetricValue, REASON_TAGS, type UnavailableReason } from "@/lib/metrics/definitions";
import { extent, valueRuns, type Series, type SeriesPoint } from "@/lib/metrics/series";

/**
 * A five-year history, drawn.
 *
 * The chart and the table under it render one array, so they cannot disagree.
 * The geometry here is arithmetic on pixels, never on figures: a value is scaled
 * to a position and is otherwise shown exactly as the database and the filing
 * gave it.
 *
 * What the drawing refuses to do
 * ------------------------------
 * A year with no figure is a gap. The line breaks, no bar is drawn, and the year
 * is labelled under the axis — because a line across a missing year is an
 * interpolation nobody authorised, and a zero-height bar reads as "nil" when the
 * truth is "nobody has entered it yet".
 *
 * Bars start at zero. A bar chart on a floating baseline exaggerates every
 * difference on it, which on a revenue history is not a style choice.
 *
 * There is one y-axis. Two measures of different scale — naira and per cent —
 * are two charts, never two axes on one.
 *
 * No client JavaScript. Identity comes from a legend and direct labels rather
 * than colour alone; each mark carries a native SVG title for a hover reading;
 * and the table below holds every number, which is what a reader on a costly
 * connection, a printed page or a screen reader gets.
 */

const WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 18, right: 18, bottom: 34, left: 58 };
const PLOT = {
  width: WIDTH - PAD.left - PAD.right,
  height: HEIGHT - PAD.top - PAD.bottom,
};

function niceTicks(min: number, max: number): number[] {
  if (min === max) return [min];
  const mid = (min + max) / 2;
  return min < 0 && max > 0 ? [min, 0, max] : [min, mid, max];
}

function pointLabel(point: SeriesPoint, series: Series): string {
  if (point.value === null) return "—";
  if (series.unit === "currency" && point.reported) return point.reported;
  return formatMetricValue(point.value, series.unit, series.decimals, point.currency);
}

function reasonTag(reason: UnavailableReason | null): string {
  return reason ? REASON_TAGS[reason] : "Pending verification";
}

export function HistoryChart({
  title,
  caption,
  series,
  kind,
}: {
  title: string;
  caption: string;
  series: readonly Series[];
  kind: "bars" | "lines";
}) {
  const years = series[0]?.points.map((point) => point.financialYear) ?? [];
  const drawable = series.some((entry) => entry.points.some((point) => point.value !== null));

  if (years.length === 0 || !drawable) {
    return (
      <figure className="history-chart is-empty">
        <figcaption>
          <strong>{title}</strong>
          <span>{caption}</span>
        </figcaption>
        <p className="empty-state">
          Nothing to draw yet. A chart appears once a year has been entered from a filing and
          checked; no line is drawn through figures that do not exist.
        </p>
      </figure>
    );
  }

  const { min, max } = extent(series, kind === "bars");
  const span = max - min || 1;
  const x = (index: number) => PAD.left + (PLOT.width * (index + 0.5)) / years.length;
  const y = (value: number) => PAD.top + PLOT.height - ((value - min) / span) * PLOT.height;
  const zero = y(Math.max(min, Math.min(0, max)));

  const bandWidth = PLOT.width / years.length;
  const barWidth = Math.max(6, (bandWidth - 14) / series.length - 2);
  const axisUnit = series[0].unit;

  return (
    <figure className="history-chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{caption}</span>
      </figcaption>

      {series.length > 1 ? (
        <ul className="chart-legend">
          {series.map((entry, index) => (
            <li key={entry.key}>
              <span className="chart-swatch" data-series={index + 1} aria-hidden="true" />
              {entry.label}
            </li>
          ))}
        </ul>
      ) : null}

      <svg
        className="chart-svg"
        viewBox={"0 0 " + WIDTH + " " + HEIGHT}
        role="img"
        aria-label={title + ". " + caption + " The table below carries the same figures."}
      >
        {niceTicks(min, max).map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-axis" x={PAD.left - 8} y={y(tick) + 3} textAnchor="end">
              {axisUnit === "percent"
                ? formatMetricValue(tick, "percent", 0)
                : new Intl.NumberFormat("en-NG", { notation: "compact" }).format(tick)}
            </text>
          </g>
        ))}

        {years.map((year, index) => {
          const missing = series.every((entry) => entry.points[index]?.value === null);
          return (
            <text
              className={missing ? "chart-axis is-gap" : "chart-axis"}
              key={year}
              x={x(index)}
              y={HEIGHT - 16}
              textAnchor="middle"
            >
              FY{year}
            </text>
          );
        })}

        {/* A year nobody has entered is named under the axis, not drawn as nil. */}
        {years.map((year, index) =>
          series.every((entry) => entry.points[index]?.value === null) ? (
            <text
              className="chart-gap-note"
              key={"gap-" + year}
              x={x(index)}
              y={HEIGHT - 4}
              textAnchor="middle"
            >
              {reasonTag(series[0].points[index].reason)}
            </text>
          ) : null,
        )}

        {kind === "bars"
          ? series.flatMap((entry, seriesIndex) =>
              entry.points.map((point, index) => {
                if (point.value === null) return null;
                const height = Math.max(1, Math.abs(y(point.value) - zero));
                const top = Math.min(y(point.value), zero);
                const offset =
                  x(index) - (series.length * (barWidth + 2)) / 2 + seriesIndex * (barWidth + 2);
                return (
                  <rect
                    className="chart-bar"
                    data-series={seriesIndex + 1}
                    key={entry.key + point.financialYear}
                    x={offset}
                    y={top}
                    width={barWidth}
                    height={height}
                    rx={4}
                  >
                    <title>
                      {entry.label + " FY" + point.financialYear + ": " + pointLabel(point, entry)}
                    </title>
                  </rect>
                );
              }),
            )
          : series.flatMap((entry, seriesIndex) => [
              ...valueRuns(entry.points).map((run, runIndex) => (
                <polyline
                  className="chart-line"
                  data-series={seriesIndex + 1}
                  key={entry.key + "-run-" + runIndex}
                  points={run
                    .map((point) => {
                      const index = entry.points.indexOf(point);
                      return x(index) + "," + y(point.value as number);
                    })
                    .join(" ")}
                />
              )),
              ...entry.points.map((point, index) =>
                point.value === null ? null : (
                  <circle
                    className="chart-dot"
                    data-series={seriesIndex + 1}
                    key={entry.key + "-dot-" + point.financialYear}
                    cx={x(index)}
                    cy={y(point.value)}
                    r={4}
                  >
                    <title>
                      {entry.label +
                        " FY" +
                        point.financialYear +
                        ": " +
                        pointLabel(point, entry) +
                        (point.disclosed ? " (reported by the issuer)" : " (calculated)")}
                    </title>
                  </circle>
                ),
              ),
            ])}

        {/* Direct labels on the latest point of each series, never on every one. */}
        {series.map((entry, seriesIndex) => {
          const fromEnd = [...entry.points].reverse().findIndex((point) => point.value !== null);
          if (fromEnd === -1) return null;
          const index = entry.points.length - 1 - fromEnd;
          const point = entry.points[index];
          return (
            <text
              className="chart-value"
              key={entry.key + "-label"}
              x={x(index)}
              y={Math.max(PAD.top + 10, y(point.value as number) - 9 - seriesIndex * 12)}
              textAnchor="middle"
            >
              {pointLabel(point, entry)}
            </text>
          );
        })}
      </svg>

      <details className="chart-table">
        <summary>The same figures as a table</summary>
        <table className="figure-table">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th>Year</th>
              {series.map((entry) => (
                <th key={entry.key}>{entry.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year, index) => (
              <tr key={year}>
                <th scope="row">FY{year}</th>
                {series.map((entry) => {
                  const point = entry.points[index];
                  return (
                    <td className="num" key={entry.key}>
                      {point.value === null ? (
                        <em>{reasonTag(point.reason)}</em>
                      ) : (
                        <>
                          {pointLabel(point, entry)}
                          {point.sourcePage ? <small>page {point.sourcePage}</small> : null}
                          {point.disclosed ? (
                            <small>reported by the issuer</small>
                          ) : entry.unit !== "currency" ? (
                            <small>calculated</small>
                          ) : null}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
