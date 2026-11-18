import { requireUser } from "@/lib/auth/session";
import { notConnected } from "@/lib/providers/registry";
import type { DataResult, Observation, ReportingPeriod } from "@/lib/market-data/types";

export interface CompanyProfile {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  description: string;
  listingBoard: string;
  website?: string;
}

export interface StatementValue {
  lineItem: string;
  period: ReportingPeriod;
  value: Observation;
}

export interface CompanyDocument {
  id: string;
  title: string;
  kind: "annual_report" | "interim_report" | "financial_statements" | "presentation" | "announcement" | "filing";
  publishedAt: string;
  sourceRef: string;
}

/** NGX symbols are upper-case letters/digits, sometimes with a dot. Returns null if malformed. */
export function normalizeSymbol(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const symbol = decoded.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.]{1,14}$/.test(symbol) ? symbol : null;
}

export async function listCompanies(): Promise<DataResult<CompanyProfile[]>> {
  await requireUser();
  return notConnected("companies.reference");
}

export async function getCompany(symbol: string): Promise<DataResult<CompanyProfile>> {
  await requireUser();
  void symbol;
  return notConnected("companies.reference");
}

export async function getFinancialStatements(symbol: string, basis: "annual" | "interim"): Promise<DataResult<StatementValue[]>> {
  await requireUser();
  void symbol;
  void basis;
  return notConnected("companies.financials");
}

export async function getCompanyDocuments(symbol: string): Promise<DataResult<CompanyDocument[]>> {
  await requireUser();
  void symbol;
  return notConnected("companies.documents");
}
