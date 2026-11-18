/**
 * Core financial data contracts for Samuel Terminal.
 *
 * Rules encoded here (see docs/PRODUCT_REQUIREMENTS.md, "Product principles"):
 * - Numeric values travel as decimal strings, never JS floats, so no precision is lost
 *   between PostgreSQL `numeric` columns and the UI.
 * - Every value carries its data status, as-of time, unit and provenance.
 * - "Unavailable" is a first-class result, not an empty array or a zero.
 */

/** How current a value is. "demo" must never be shown without a visible DEMO label. */
export type DataStatus =
  | "real_time"
  | "delayed"
  | "end_of_day"
  | "historical"
  | "demo"
  | "unavailable";

/** The legal basis on which SFI holds and displays a value. */
export type LicenceClass =
  | "licensed" // Covered by a signed provider agreement (e.g. NGX, FMDQ market data).
  | "public_official" // Official public release; reuse terms recorded per provider.
  | "issuer_document" // Issuer filing or report; link and cite, don't republish in full.
  | "sfi_original" // Produced by SFI (research, commentary, derived metrics).
  | "unverified"; // Not yet cleared. Must not be displayed to end users.

export type Unit =
  | "NGN"
  | "USD"
  | "percent"
  | "percent_per_annum"
  | "index_points"
  | "shares"
  | "count"
  | "NGN_per_USD"
  | "barrels_per_day";

export type Magnitude = "units" | "thousands" | "millions" | "billions" | "trillions";

/** The period a figure describes. Distinct from when it was published. */
export interface ReportingPeriod {
  type: "FY" | "H1" | "Q1" | "Q2" | "Q3" | "Q4" | "9M" | "month" | "quarter" | "day";
  /** ISO date (YYYY-MM-DD), inclusive. */
  start: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  end: string;
  audited?: boolean;
}

export interface Provenance {
  providerId: string;
  providerName: string;
  /** Source URL or internal document reference. */
  sourceRef?: string;
  /** ISO timestamp the provider published the value. */
  publishedAt?: string;
  /** ISO timestamp SFI retrieved it. */
  retrievedAt: string;
  licence: LicenceClass;
}

export interface Observation {
  /** Decimal string, e.g. "102345.67". */
  value: string;
  unit: Unit;
  magnitude?: Magnitude;
  /** ISO timestamp the value is valid at (market time or period end). */
  asOf: string;
  period?: ReportingPeriod;
  status: Exclude<DataStatus, "unavailable">;
  provenance: Provenance;
}

export type UnavailableReason =
  | "no_provider" // No authorised provider is connected for this dataset.
  | "not_licensed" // A provider exists but SFI lacks rights for this use.
  | "provider_error" // The provider failed or returned invalid data.
  | "stale" // Data exists but is older than its freshness policy allows.
  | "not_found" // The requested entity is not in coverage.
  | "not_enabled"; // The feature is scheduled for a later phase.

/**
 * Result of any data-service call. Callers must handle both branches;
 * the UI renders `unavailable` explicitly instead of inventing values.
 */
export type DataResult<T> =
  | { state: "ok"; data: T; status: Exclude<DataStatus, "unavailable">; asOf: string }
  | { state: "unavailable"; reason: UnavailableReason; message: string; dataset: string };

export type Unavailable = Extract<DataResult<unknown>, { state: "unavailable" }>;

export function unavailable(dataset: string, reason: UnavailableReason, message: string): Unavailable {
  return { state: "unavailable", dataset, reason, message };
}
