import { requireUser } from "@/lib/auth/session";
import { notConnected } from "@/lib/providers/registry";
import type { DataResult, Observation } from "@/lib/market-data/types";
import type { RateConcept } from "@/lib/catalog/fixed-income";

export interface FixedIncomeInstrument {
  id: string;
  name: string;
  classId: string;
  issuer: string;
  issueDate: string;
  maturityDate: string;
  coupon?: Observation;
  outstanding?: Observation;
}

export interface AuctionResult {
  id: string;
  auctionDate: string;
  instrument: string;
  tenor: string;
  offered: Observation;
  subscribed: Observation;
  allotted: Observation;
  stopRate: Observation;
}

export interface YieldPoint {
  tenorYears: string;
  instrument: string;
  /** Which rate concept this value represents — never mixed within one series. */
  concept: RateConcept["id"];
  value: Observation;
}

export async function getInstruments(): Promise<DataResult<FixedIncomeInstrument[]>> {
  await requireUser();
  return notConnected("fixed_income.instruments");
}

export async function getAuctionResults(): Promise<DataResult<AuctionResult[]>> {
  await requireUser();
  return notConnected("fixed_income.auctions");
}

export async function getYieldCurve(): Promise<DataResult<YieldPoint[]>> {
  await requireUser();
  return notConnected("fixed_income.yields");
}
