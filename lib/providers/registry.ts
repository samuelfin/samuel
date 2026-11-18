import { unavailable, type Unavailable } from "@/lib/market-data/types";

/**
 * Provider registry and abstraction layer.
 *
 * Every dataset the terminal displays is served by one provider adapter. Until an
 * adapter is implemented AND its licence/terms are approved, data services return an
 * explicit `unavailable` result. Nothing is mocked or scraped.
 * Status reflects docs/DATA_PROVIDER_ASSESSMENT.md (desk review, 17 Nov 2026).
 */

export type ProviderId = "ngx" | "fmdq" | "cbn" | "nbs" | "dmo" | "sec" | "nuprc" | "issuer_ir" | "sfi";

export type AccessModel = "licensed_api" | "official_publications" | "issuer_documents" | "internal";
export type RightsStatus = "quote_required" | "terms_unconfirmed" | "per_document" | "owned" | "approved";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  shortName: string;
  url: string;
  coverage: string;
  access: AccessModel;
  rights: RightsStatus;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  ngx: { id: "ngx", name: "Nigerian Exchange Group", shortName: "NGX", url: "https://ngxgroup.com/exchange/data/", coverage: "Equities, indices, ETPs, listed debt", access: "licensed_api", rights: "quote_required" },
  fmdq: { id: "fmdq", name: "FMDQ Group", shortName: "FMDQ", url: "https://fmdqgroup.com/exchange/market-data/", coverage: "Fixed income, money market, FX benchmarks", access: "licensed_api", rights: "quote_required" },
  cbn: { id: "cbn", name: "Central Bank of Nigeria", shortName: "CBN", url: "https://www.cbn.gov.ng/", coverage: "Policy rate, FX, reserves, NTB auctions", access: "official_publications", rights: "terms_unconfirmed" },
  nbs: { id: "nbs", name: "National Bureau of Statistics", shortName: "NBS", url: "https://www.nigerianstat.gov.ng/", coverage: "CPI, GDP, labour, trade", access: "official_publications", rights: "terms_unconfirmed" },
  dmo: { id: "dmo", name: "Debt Management Office", shortName: "DMO", url: "https://www.dmo.gov.ng/", coverage: "FGN bonds, savings bonds, sukuk, public debt", access: "official_publications", rights: "terms_unconfirmed" },
  sec: { id: "sec", name: "Securities and Exchange Commission Nigeria", shortName: "SEC", url: "https://sec.gov.ng/", coverage: "Rules, notices, registered operators", access: "official_publications", rights: "terms_unconfirmed" },
  nuprc: { id: "nuprc", name: "Nigerian Upstream Petroleum Regulatory Commission", shortName: "NUPRC", url: "https://www.nuprc.gov.ng/", coverage: "Crude oil and condensate production", access: "official_publications", rights: "terms_unconfirmed" },
  issuer_ir: { id: "issuer_ir", name: "Issuer investor-relations sites", shortName: "Issuers", url: "", coverage: "Annual/interim reports, announcements", access: "issuer_documents", rights: "per_document" },
  sfi: { id: "sfi", name: "Samuel Financial Intelligence", shortName: "SFI", url: "", coverage: "Research, editorial, derived metrics", access: "internal", rights: "owned" },
};

export const RIGHTS_LABEL: Record<RightsStatus, string> = {
  quote_required: "Licence quote required",
  terms_unconfirmed: "Reuse terms unconfirmed",
  per_document: "Rights checked per document",
  owned: "SFI-owned",
  approved: "Approved",
};

export const ACCESS_LABEL: Record<AccessModel, string> = {
  licensed_api: "Licensed API",
  official_publications: "Official publications",
  issuer_documents: "Issuer documents",
  internal: "Internal",
};

/** Datasets and the provider planned to serve each. */
export const DATASETS = {
  "equities.indices": "ngx",
  "equities.breadth": "ngx",
  "equities.activity": "ngx",
  "equities.prices": "ngx",
  "equities.movers": "ngx",
  "equities.sectors": "ngx",
  "companies.reference": "ngx",
  "companies.financials": "issuer_ir",
  "companies.documents": "issuer_ir",
  "corporate_actions": "ngx",
  "economy.observations": "nbs",
  "fixed_income.instruments": "dmo",
  "fixed_income.auctions": "dmo",
  "fixed_income.yields": "fmdq",
  "news.items": "sfi",
  "research.reports": "sfi",
} as const satisfies Record<string, ProviderId>;

export type DatasetId = keyof typeof DATASETS;

/** Datasets with an implemented, approved adapter. Empty until Phase 2. */
const CONNECTED: ReadonlySet<DatasetId> = new Set<DatasetId>();

export function isConnected(dataset: DatasetId): boolean {
  return CONNECTED.has(dataset);
}

export function connectedDatasetCount(): number {
  return CONNECTED.size;
}

/** Standard result for a dataset with no approved adapter, naming the planned source and its gate. */
export function notConnected(dataset: DatasetId, providerOverride?: ProviderId): Unavailable {
  const provider = PROVIDERS[providerOverride ?? DATASETS[dataset]];
  const message =
    provider.rights === "owned"
      ? "No approved items have been published yet."
      : `Planned source: ${provider.shortName} — ${RIGHTS_LABEL[provider.rights].toLowerCase()}.`;
  return unavailable(dataset, "no_provider", message);
}

/**
 * Contract every provider adapter implements (Phase 2). Adapters run server-side only,
 * read credentials from environment/secret storage, and never return raw provider
 * payloads to the UI.
 */
export interface ProviderAdapter<Raw, Canonical> {
  providerId: ProviderId;
  datasets: readonly DatasetId[];
  fetch(window: { from: string; to: string }, cursor?: string): Promise<{ records: Raw[]; nextCursor?: string }>;
  normalize(raw: Raw): Canonical[];
  validate(record: Canonical): { field: string; problem: string }[];
}
