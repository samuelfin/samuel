import type { DataStatus, UnavailableReason } from "./types";

export type StatusTone = "live" | "delayed" | "eod" | "historical" | "demo" | "none";

export const STATUS_META: Record<DataStatus, { label: string; short: string; tone: StatusTone; description: string }> = {
  real_time: { label: "Real-time", short: "RT", tone: "live", description: "From a licensed real-time feed." },
  delayed: { label: "Delayed", short: "DLY", tone: "delayed", description: "From a licensed delayed feed. Values lag the market." },
  end_of_day: { label: "End of day", short: "EOD", tone: "eod", description: "Official closing values for the stated trading date." },
  historical: { label: "Historical", short: "HIST", tone: "historical", description: "A past observation, not a current value." },
  demo: { label: "Demo data", short: "DEMO", tone: "demo", description: "Illustrative sample only. Not market data." },
  unavailable: { label: "Unavailable", short: "N/A", tone: "none", description: "No authorised source is connected." },
};

export const UNAVAILABLE_LABEL: Record<UnavailableReason, string> = {
  no_provider: "No source connected",
  not_licensed: "Not licensed for this use",
  provider_error: "Source error",
  stale: "Stale — withheld",
  not_found: "Not in coverage",
  not_enabled: "Not yet enabled",
};

export type Frequency = "intraday" | "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "per_event";

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  intraday: "Intraday",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
  per_event: "Per event",
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Default freshness policy: the maximum age of `asOf` (the period end or market time)
 * before a value is treated as stale. Generous enough to cover weekends, public holidays
 * and normal publication lags (e.g. monthly CPI is released weeks after month end).
 * Individual datasets may override this once provider schedules are confirmed.
 */
export const MAX_AGE_MS: Record<Frequency, number | null> = {
  intraday: 30 * 60 * 1000,
  daily: 5 * DAY,
  weekly: 12 * DAY,
  monthly: 75 * DAY,
  quarterly: 200 * DAY,
  annual: 550 * DAY,
  per_event: null, // Event-driven series (e.g. MPC decisions) stay valid until superseded.
};

/** True when `asOf` is older than the freshness policy allows, or is not a valid timestamp. */
export function isStale(asOf: string, frequency: Frequency, now: Date = new Date()): boolean {
  const at = Date.parse(asOf);
  if (Number.isNaN(at)) return true;
  const maxAge = MAX_AGE_MS[frequency];
  if (maxAge === null) return false;
  return now.getTime() - at > maxAge;
}
