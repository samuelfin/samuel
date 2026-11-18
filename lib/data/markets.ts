import { requireUser } from "@/lib/auth/session";
import { notConnected } from "@/lib/providers/registry";
import type { DataResult, Observation } from "@/lib/market-data/types";
import type { TimeRangeId } from "@/lib/catalog/markets";

/**
 * Equity market data services (NGX). Server-only: every call verifies the session.
 * Implementations switch from `notConnected` to the NGX adapter once the licence
 * is signed and the adapter is registered (Phase 2b).
 */

export interface IndexQuote {
  indexId: string;
  level: Observation;
  change: Observation;
  changePct: Observation;
}

export interface MarketBreadth {
  advancing: number;
  declining: number;
  unchanged: number;
}

export interface MarketActivity {
  marketCap: Observation;
  volume: Observation;
  value: Observation;
  deals: Observation;
}

export interface EquityQuote {
  symbol: string;
  name: string;
  sector: string;
  last: Observation;
  previousClose: Observation;
  change: Observation;
  changePct: Observation;
  volume: Observation;
  value: Observation;
  marketCap?: Observation;
}

export interface SectorPerformance {
  sector: string;
  changePct: Observation;
}

export interface SeriesPoint {
  at: string;
  value: string;
}

export type MoverKind = "gainers" | "losers" | "active";

export async function getIndexQuotes(): Promise<DataResult<IndexQuote[]>> {
  await requireUser();
  return notConnected("equities.indices");
}

export async function getIndexSeries(indexId: string, range: TimeRangeId): Promise<DataResult<SeriesPoint[]>> {
  await requireUser();
  void indexId;
  void range;
  return notConnected("equities.indices");
}

export async function getMarketBreadth(): Promise<DataResult<MarketBreadth>> {
  await requireUser();
  return notConnected("equities.breadth");
}

export async function getMarketActivity(): Promise<DataResult<MarketActivity>> {
  await requireUser();
  return notConnected("equities.activity");
}

export async function getMovers(kind: MoverKind): Promise<DataResult<EquityQuote[]>> {
  await requireUser();
  void kind;
  return notConnected("equities.movers");
}

export async function getEquityQuotes(): Promise<DataResult<EquityQuote[]>> {
  await requireUser();
  return notConnected("equities.prices");
}

export async function getSectorPerformance(): Promise<DataResult<SectorPerformance[]>> {
  await requireUser();
  return notConnected("equities.sectors");
}
