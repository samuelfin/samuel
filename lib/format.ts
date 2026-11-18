/**
 * Display formatting for financial values.
 *
 * Values arrive as decimal strings (see lib/market-data/types.ts). Intl.NumberFormat
 * accepts numeric strings and formats them without converting through a binary float,
 * so precision from PostgreSQL `numeric` is preserved.
 */

export const EMPTY = "—";
export const MARKET_TIME_ZONE = "Africa/Lagos";

const DECIMAL = /^[+-]?\d+(\.\d+)?$/;

export function isDecimalString(value: unknown): value is `${number}` {
  return typeof value === "string" && DECIMAL.test(value);
}

const numberFormatters = new Map<string, Intl.NumberFormat>();
function numberFormatter(minDp: number, maxDp: number) {
  const key = `${minDp}:${maxDp}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-NG", { minimumFractionDigits: minDp, maximumFractionDigits: maxDp });
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

/** Format a decimal string with grouping. Returns an em dash for missing or malformed input. */
export function formatDecimal(value: string | null | undefined, dp = 2, maxDp = dp): string {
  if (!isDecimalString(value)) return EMPTY;
  return numberFormatter(dp, maxDp).format(value);
}

/** Direction of a signed decimal string, without float conversion. */
export function direction(value: string | null | undefined): "up" | "down" | "flat" {
  if (!isDecimalString(value)) return "flat";
  if (/^[+-]?0+(\.0+)?$/.test(value)) return "flat";
  return value.startsWith("-") ? "down" : "up";
}

/** Format a percentage change with an explicit sign, e.g. "+1.25%" or "−0.40%". */
export function formatSignedPercent(value: string | null | undefined, dp = 2): string {
  if (!isDecimalString(value)) return EMPTY;
  const body = formatDecimal(value.replace(/^[+-]/, ""), dp);
  const dir = direction(value);
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  return `${sign}${body}%`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: MARKET_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dateFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: MARKET_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const clockFormatter = new Intl.DateTimeFormat("en-NG", {
  timeZone: MARKET_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Format an ISO timestamp in Lagos time, e.g. "18 Nov 2026, 14:30 WAT". */
export function formatAsOf(iso: string | null | undefined, withTime = true): string {
  if (!iso) return EMPTY;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return EMPTY;
  return withTime ? `${dateTimeFormatter.format(at)} WAT` : dateFormatter.format(at);
}

/** WAT wall-clock time (HH:MM) for the status bar. */
export function formatWatClock(at: Date): string {
  return clockFormatter.format(at);
}
