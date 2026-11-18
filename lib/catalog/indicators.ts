import type { Unit, Magnitude } from "@/lib/market-data/types";
import type { Frequency } from "@/lib/market-data/status";
import type { ProviderId } from "@/lib/providers/registry";

/**
 * Reference definitions for macroeconomic indicators. Metadata only — no values.
 * Values come from ingested, validated observations (Phase 2a). Source assignments
 * follow docs/DATA_PROVIDER_ASSESSMENT.md and must be confirmed per series.
 */
export interface IndicatorDefinition {
  id: string;
  name: string;
  category: "Prices" | "Growth" | "Monetary" | "Exchange rate" | "External" | "Fiscal & debt" | "Labour" | "Commodities";
  unit: Unit;
  magnitude?: Magnitude;
  frequency: Frequency;
  source: ProviderId;
  definition: string;
  /** Known comparability caveats. */
  caveat?: string;
}

export const INDICATORS: readonly IndicatorDefinition[] = [
  {
    id: "cpi-headline-yoy",
    name: "Headline inflation",
    category: "Prices",
    unit: "percent",
    frequency: "monthly",
    source: "nbs",
    definition: "Year-on-year change in the all-items Consumer Price Index for the reference month.",
    caveat: "NBS rebased the CPI in 2025. Compare across the rebasing only with the published linking method.",
  },
  {
    id: "cpi-food-yoy",
    name: "Food inflation",
    category: "Prices",
    unit: "percent",
    frequency: "monthly",
    source: "nbs",
    definition: "Year-on-year change in the food sub-index of the CPI for the reference month.",
  },
  {
    id: "gdp-real-growth-yoy",
    name: "Real GDP growth",
    category: "Growth",
    unit: "percent",
    frequency: "quarterly",
    source: "nbs",
    definition: "Year-on-year change in real gross domestic product for the reference quarter.",
    caveat: "Subject to revision and rebasing. Each published vintage is stored separately.",
  },
  {
    id: "mpr",
    name: "Monetary policy rate",
    category: "Monetary",
    unit: "percent_per_annum",
    frequency: "per_event",
    source: "cbn",
    definition: "Benchmark policy rate set by the CBN Monetary Policy Committee, effective from the decision date.",
  },
  {
    id: "usdngn-official",
    name: "USD/NGN official rate",
    category: "Exchange rate",
    unit: "NGN_per_USD",
    frequency: "daily",
    source: "cbn",
    definition: "Official naira per US dollar reference rate for the trading day.",
    caveat: "The exact official series to display must be confirmed with CBN/FMDQ before activation.",
  },
  {
    id: "fx-reserves-gross",
    name: "Gross external reserves",
    category: "External",
    unit: "USD",
    magnitude: "billions",
    frequency: "daily",
    source: "cbn",
    definition: "Gross foreign exchange reserves held by the CBN at the reference date.",
  },
  {
    id: "trade-balance",
    name: "Merchandise trade balance",
    category: "External",
    unit: "NGN",
    magnitude: "billions",
    frequency: "quarterly",
    source: "nbs",
    definition: "Value of merchandise exports minus imports for the reference quarter.",
  },
  {
    id: "public-debt-total",
    name: "Total public debt",
    category: "Fiscal & debt",
    unit: "NGN",
    magnitude: "trillions",
    frequency: "quarterly",
    source: "dmo",
    definition: "Total public debt stock (federal, state and FCT; domestic and external) at period end.",
  },
  {
    id: "ntb-364d-stop-rate",
    name: "364-day NTB stop rate",
    category: "Monetary",
    unit: "percent_per_annum",
    frequency: "per_event",
    source: "cbn",
    definition: "Marginal (stop) rate at the primary Nigerian Treasury Bills auction for the 364-day tenor.",
    caveat: "Primary auction result. Not a secondary-market yield.",
  },
  {
    id: "unemployment-rate",
    name: "Unemployment rate",
    category: "Labour",
    unit: "percent",
    frequency: "quarterly",
    source: "nbs",
    definition: "Share of the labour force without work and available for work in the reference period.",
    caveat: "NBS revised its labour-force methodology in 2023; earlier figures are not directly comparable.",
  },
  {
    id: "crude-oil-production",
    name: "Crude oil production",
    category: "Commodities",
    unit: "barrels_per_day",
    magnitude: "millions",
    frequency: "monthly",
    source: "nuprc",
    definition: "Average daily crude oil production for the reference month.",
    caveat: "Confirm whether condensate is included in the chosen series.",
  },
];

/** Indicators shown on the Overview dashboard. */
export const HEADLINE_INDICATOR_IDS: readonly string[] = ["cpi-headline-yoy", "mpr", "usdngn-official", "gdp-real-growth-yoy", "fx-reserves-gross"];

const UNIT_SYMBOL: Record<Unit, string> = {
  NGN: "₦",
  USD: "US$",
  percent: "%",
  percent_per_annum: "% p.a.",
  index_points: "pts",
  shares: "shares",
  count: "count",
  NGN_per_USD: "₦ per US$",
  barrels_per_day: "bbl/day",
};

/** Human-readable unit, e.g. "US$ bn", "₦ tn", "% p.a.", "bbl/day (millions)". */
export function unitLabel(unit: Unit, magnitude?: Magnitude): string {
  const short: Partial<Record<Magnitude, string>> = { thousands: "k", millions: "m", billions: "bn", trillions: "tn" };
  if (!magnitude || magnitude === "units") return UNIT_SYMBOL[unit];
  if (unit === "NGN" || unit === "USD") return `${UNIT_SYMBOL[unit]} ${short[magnitude]}`;
  return `${UNIT_SYMBOL[unit]} (${magnitude})`;
}
