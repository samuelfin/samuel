/**
 * Reference catalogue for the Nigerian equity market. Names only — index levels,
 * prices and constituents come from a licensed NGX feed (Phase 2b).
 * Provider symbols/codes are mapped from the feed, not hardcoded here.
 */

export interface IndexDefinition {
  id: string;
  name: string;
  family: "Broad market" | "Sector" | "Thematic";
}

export const NGX_INDICES: readonly IndexDefinition[] = [
  { id: "ngx-asi", name: "NGX All-Share Index", family: "Broad market" },
  { id: "ngx-30", name: "NGX 30", family: "Broad market" },
  { id: "ngx-banking", name: "NGX Banking", family: "Sector" },
  { id: "ngx-insurance", name: "NGX Insurance", family: "Sector" },
  { id: "ngx-consumer-goods", name: "NGX Consumer Goods", family: "Sector" },
  { id: "ngx-oil-gas", name: "NGX Oil & Gas", family: "Sector" },
  { id: "ngx-industrial-goods", name: "NGX Industrial Goods", family: "Sector" },
  { id: "ngx-pension", name: "NGX Pension", family: "Thematic" },
];

/** NGX sector classification used for the sector overview and screener filters. */
export const NGX_SECTORS: readonly string[] = [
  "Agriculture",
  "Conglomerates",
  "Construction/Real Estate",
  "Consumer Goods",
  "Financial Services",
  "Healthcare",
  "ICT",
  "Industrial Goods",
  "Natural Resources",
  "Oil and Gas",
  "Services",
  "Utilities",
];

export const TIME_RANGES = [
  { id: "1D", label: "1D", description: "Today" },
  { id: "1W", label: "1W", description: "One week" },
  { id: "1M", label: "1M", description: "One month" },
  { id: "3M", label: "3M", description: "Three months" },
  { id: "6M", label: "6M", description: "Six months" },
  { id: "1Y", label: "1Y", description: "One year" },
  { id: "5Y", label: "5Y", description: "Five years" },
  { id: "CUSTOM", label: "Custom", description: "Custom date range, where data is available" },
] as const;

export type TimeRangeId = (typeof TIME_RANGES)[number]["id"];
