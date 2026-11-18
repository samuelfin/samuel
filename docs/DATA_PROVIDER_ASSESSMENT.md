# Data Provider Assessment

**Assessment date:** 17 November 2026  
**Status:** Desk review only. Obtain written quotes, contracts, technical access and legal review before integration.

## Summary

NGX and FMDQ clearly describe commercial data products and permissions. Official public pages and documents from CBN, NBS, DMO and SEC can seed reference/periodic releases, but public visibility does not by itself establish a supported API, automated-access permission or commercial redistribution right. The launch must treat each provider/product/use as a separate rights decision.

| Provider | Likely use | Access evidence | Open questions / gate |
| --- | --- | --- | --- |
| NGX | Equities, indices, debt and ETP market/reference data | NGX lists API products in JSON/XML, product subscriptions and real-time, delayed and EOD options; its API docs require registration, package entitlement and token. Vendor page says third-party distribution requires a distribution licence. | Obtain price list, package, historical depth, redistribution/display rights, user counts, caching rules, attribution and SLA in writing. No client-side token. |
| CBN | FX reference series, policy rates, reserves and banking statistics | Official exchange-rate and statistics pages are publicly accessible. No supported public API entitlement or reuse terms confirmed in this review. | Ask about machine-readable feeds, data dictionaries, update schedule, bulk access and reuse terms; otherwise controlled/manual imports with source links. |
| NBS | CPI/inflation, GDP, labour, trade and other statistics | Official releases/publications are available. No supported API entitlement or commercial redistribution terms confirmed. | Confirm machine-readable format, corrections/revisions and reuse rights. Preserve release/vintage history. |
| DMO | FGN issuance, auction circulars/results, public debt and instrument details | Official site publishes offer circulars, auction results and debt-stock reports, often as documents. No general production API confirmed. | Confirm automated collection and reuse rights; plan source-document ingestion plus human validation until feed terms are agreed. |
| FMDQ | Fixed-income, money-market, FX and benchmarks | FMDQ lists real-time, delayed and EOD products and subscriber/distributor routes; e-Markets registration and subscription options are published. | Obtain quote, feed/API details, redistribution scope, benchmark index licensing, historical retention and user-tier terms. |
| SEC Nigeria | Rules, notices, registered-operator information and regulatory documents | Official notices, rules and ISA 2025 materials are publicly available. | Confirm document access/reuse terms and validate obligations against current consolidated rules with counsel. |
| Issuer investor-relations sites | Annual/interim reports, presentations and announcements | Sources are issuer-specific and generally public documents. | Copyright, terms, permission, stable URLs and extraction quality vary. Keep links and rights classification; don't republish full text without rights. |

## Provider decision procedure

For every dataset, record: product/feed name, provider contact, contract/terms version, permitted internal use, display and redistribution rights, derivative/derived-data rules, user limits, geography, latency, historical depth, storage/cache retention, attribution, price, tax, renewal date, SLA, technical format and outage path.

Before activation, run a sample feed through schema validation and verify its values against the provider's official view. Use a server-side provider adapter and keep raw licensed payloads subject to contract retention terms. Never scrape a website merely because no API is visible.

## Initial integration order

1. Provider/rights registry and reference-data import pipeline.
2. NGX licensed EOD or delayed package, selected only after the SFI display/redistribution use case is quoted and approved.
3. CBN/NBS/DMO official releases as versioned low-frequency observations/documents while terms and formats are confirmed.
4. FMDQ subscription for permitted fixed-income products after pricing and redistribution terms are confirmed.
5. Issuer filings with document provenance and human review.

## Primary references

- NGX API documentation: https://marketdataapiv3.ngxgroup.com/portal/Home/Documentation
- NGX technology services: https://ngxgroup.com/exchange/data/technology-services/
- NGX data pricing, policies and contracts: https://ngxgroup.com/exchange/data/data-pricing-policies-contracts/
- NGX authorized vendors: https://www.ngxgroup.com/exchange/data/vendors-list/
- CBN exchange rates: https://www.cbn.gov.ng/rates/ExchRateByCurrency.html
- NBS: https://www.nigerianstat.gov.ng/
- DMO: https://www.dmo.gov.ng/
- FMDQ market data: https://fmdqgroup.com/exchange/market-data/
- FMDQ e-Markets: https://emarkets.fmdqgroup.com/market/
- SEC Nigeria: https://sec.gov.ng/
