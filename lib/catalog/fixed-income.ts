import type { ProviderId } from "@/lib/providers/registry";

/**
 * Fixed-income reference definitions. The rate concepts below must stay visibly
 * distinct in every table and chart (master brief, Module 4).
 */

export interface RateConcept {
  id: "coupon" | "stop_rate" | "market_yield" | "indicative";
  name: string;
  definition: string;
}

export const RATE_CONCEPTS: readonly RateConcept[] = [
  { id: "coupon", name: "Coupon rate", definition: "Fixed annual interest the issuer pays on face value, set at issue. Not a measure of current return." },
  { id: "stop_rate", name: "Auction stop rate", definition: "Marginal rate at which a primary auction cleared on a stated auction date." },
  { id: "market_yield", name: "Market yield", definition: "Yield implied by a reported secondary-market trade or official closing price on a stated date." },
  { id: "indicative", name: "Indicative quote", definition: "A dealer or venue quote for information only. It is not an executable price or a transaction." },
];

export interface InstrumentClass {
  id: string;
  name: string;
  issuer: string;
  primarySource: ProviderId;
  secondarySource?: ProviderId;
  notes: string;
}

export const INSTRUMENT_CLASSES: readonly InstrumentClass[] = [
  { id: "fgn-bonds", name: "FGN bonds", issuer: "Federal Government of Nigeria (via DMO)", primarySource: "dmo", secondarySource: "fmdq", notes: "Auction circulars and results from DMO; secondary-market data requires an FMDQ licence." },
  { id: "ntb", name: "Nigerian Treasury Bills", issuer: "Federal Government of Nigeria", primarySource: "cbn", secondarySource: "fmdq", notes: "91-, 182- and 364-day tenors. Primary auctions are run by the CBN." },
  { id: "fgn-savings-bonds", name: "FGN Savings Bonds", issuer: "Federal Government of Nigeria (via DMO)", primarySource: "dmo", notes: "Retail offers published by DMO with offer and coupon details." },
  { id: "sukuk", name: "FGN Sukuk", issuer: "Federal Government of Nigeria (via DMO)", primarySource: "dmo", secondarySource: "fmdq", notes: "Sovereign sukuk issues; rental-rate terms differ from bond coupons." },
  { id: "corporate-bonds", name: "Corporate bonds", issuer: "Listed and quoted corporates", primarySource: "fmdq", secondarySource: "ngx", notes: "Issuer documents for terms; quotes and trades require venue licensing." },
];
