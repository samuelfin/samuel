# SAMUEL Financial Intelligence — CEO Strategy Documents

> Source: CEO (shared November 2026). Two documents: (1) Master Technology Integration & Provider Procurement Strategy, (2) Recommended Company Coverage.
> How this fits the build plan: see `SFI_ARCHITECTURE_V2.md` section 11.

*Understanding Markets. Seeing Beyond Numbers.*

| | |
|---|---|
| Business model | Public + Institutional |
| Initial geography | Nigeria |
| Technology strategy | Lean, scalable |
| Initial AI dependency | None required |

---

# PART 1 — Master Technology Integration & Provider Procurement Strategy

## Recommended development approach

Build SAMUEL as a Nigerian financial intelligence institution with two complementary products:

- **SAMUEL Public:** an accessible financial and economic information portal that attracts investors, businesses, researchers, journalists and the general public.
- **SAMUEL Institutional:** a premium research, data and analytics environment for investment firms, pension fund managers, banks, financial advisers, corporate treasuries and international investors.

Both run on the same technology infrastructure and central database, with different access privileges, features and commercial arrangements.

**Most important strategic decision:** build your own intelligence infrastructure first. Purchase specialist external intelligence when it creates a measurable advantage. Do not start by purchasing expensive enterprise software and then build a portal around it.

Implementation: six phases over approximately 12 months.

## 1. Business and product architecture

### 1.1 SAMUEL Public (free access)

| Module | Features |
|---|---|
| Market overview | NGX All-Share Index, market capitalisation, gainers, losers, trading activity |
| Stock market | Listed companies, share prices, historical charts, corporate actions |
| Economy | Inflation, GDP, unemployment, interest rates, foreign reserves |
| Foreign exchange | Officially sourced exchange-rate indicators and historical trends |
| Fixed income | Treasury bills, government bonds and yields |
| Oil and gas | Crude production, international oil prices, petroleum developments |
| Company intelligence | Company profiles, financial statements, announcements |
| News | Financial news, regulatory releases, economic developments |
| Research | SAMUEL's independently produced market commentary |
| Economic calendar | CBN MPC meetings, NBS releases, auctions, important economic events |

Offer substantial useful information without registration. Registration unlocks watchlists, saved reports and personalised alerts.

### 1.2 SAMUEL Institutional (paid subscription)

| Product | Institutional functionality |
|---|---|
| Advanced Market Dashboard | More extensive market data and historical analysis |
| Company Financials | Multi-year company statements and financial ratios |
| Research Terminal | Advanced company and sector research |
| Economic Intelligence | Historical economic indicators and comparisons |
| Fixed-Income Analytics | Bond yields, maturities, interest-rate analysis |
| Screening Engine | Filter companies by financial and market criteria |
| Portfolio Analytics | Hypothetical portfolio performance and risk analysis |
| Research Library | Downloadable reports, historical research, economic publications |
| Institutional Data API | Approved access to selected SAMUEL datasets |
| Custom Reports | Bespoke economic and financial research |

Institutional access must not depend on AlphaSense or any single external vendor; it uses SAMUEL's own datasets and calculations.

## 2. Provider selection and procurement

| Provider | Decision | Notes |
|---|---|---|
| NGX | Acquire now | Direct or authorised market-data integration with display and redistribution rights |
| FMDQ | Acquire now | Fixed-income, FX and benchmark data |
| CBN / NBS / DMO / SEC | Integrate now | Official economic and regulatory publications |
| World Bank / IMF | Integrate now | Official APIs for historical and international comparisons |
| AlphaSense | Pilot later | Professional research and premium document intelligence |
| Kensho / S&P Global | Commercial discussion | Selected financial datasets and deterministic retrieval |
| QuantConnect | Phase 2 | LEAN engine for quantitative research once enough Nigerian history exists |
| EidoSearch / Nitrogen | Defer | Reassess when predictive and investor-risk products become priorities |
| Plaid / Robo-advisors | Exclude initially | Not needed for an information and research business |

### 2.1 NGX — first major commercial data agreement
NGX publishes authorised real-time market-data vendors; distribution to third parties requires a distribution licence. It offers FIX and API connectivity for real-time, delayed and end-of-day data.

Ask NGX for a proposal covering: (1) end-of-day, (2) delayed, (3) real-time data. Real-time is not needed on day one.

Procurement questions:
- Cost of end-of-day / delayed / real-time licences?
- Website display rights?
- Can subscribers view data without individual exchange subscriptions?
- Redistribution rights?
- Can data be stored historically?
- Can SAMUEL create proprietary indices and derived calculations?
- Reporting and audit obligations?
- Separate fees for public and institutional products?

### 2.2 FMDQ — second market-data relationship
Approach at the same time as NGX. FMDQ has a data subscription and redistribution licensing framework (products include NAFEX, NIBOR, NITTY, closing prices for T-bills, bonds, commercial papers; some real-time, delayed or end-of-day).

Starting package: daily T-bill yields; government bond closing prices and yields; NAFEX (subject to rights); selected fixed-income indicators; licensed historical datasets.

### 2.3 AlphaSense — no large enterprise package initially
Has a developer API (search, company and broker info, watchlists, trends, SuperAnalyst API).
- Option A: internal research subscription for analysts (more sensible first).
- Option B: embedded commercial integration through SAMUEL's platform.
Ask for a small-team pilot, startup pricing and explicit commercial integration rights. A normal subscription does not imply redistribution rights.

### 2.4 Kensho / S&P Global — negotiate data access, not just AI
Ask about: Capital IQ financials for Nigerian listed companies; identifiers and entity matching; historical statements; ratios; earnings transcripts; Deterministic Retrieval API (source-cited retrieval, formerly Kensho LLM-ready API, via S&P Global AI Data Portal); website display rights; API redistribution. Do not pay until Nigerian coverage and a workable proposal are confirmed.

### 2.5 QuantConnect — use the engine, not the whole ecosystem
LEAN engine is open source (Python and C#) and supports custom data, so SAMUEL can later supply its own Nigerian data. Use for screening, portfolio backtesting, volatility, risk/return, sector performance, quantitative research. No automated live trading in the initial product.

## 3. Technology architecture

One central data infrastructure serving both products; do not build two platforms.

Layers:
- **SAMUEL Public** (free portal) and **SAMUEL Institutional** (premium terminal)
- **Application & API layer:** user accounts, permissions, subscription management, search, alerts, data API
- **SAMUEL Intelligence Engine:** data validation, financial calculations, historical analysis, company screening, economic modelling, research management
- **Central data warehouse:** structured financial data, historical prices, economic series, company filings, source documents, audit history
- **Sources:** Nigerian markets (NGX, FMDQ, NASD); Nigerian economy (CBN, NBS, DMO); global economy (IMF, World Bank); research providers (AlphaSense, S&P Global)

### 3.1 Recommended technology stack (CEO document)

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js + React | Website and dashboards |
| Backend | Python + FastAPI | Financial data and application APIs |
| Database | PostgreSQL | Main financial database |
| Time-series | PostgreSQL / TimescaleDB | Historical market and economic data |
| Document storage | S3-compatible object storage | Reports, PDFs, filings |
| Search | PostgreSQL initially; OpenSearch later | Document and company search |
| Data processing | Python + Pandas / Polars | Calculations and transformation |
| Background processing | Celery + Redis | Scheduled collection |
| Orchestration | Python jobs initially; Prefect later | Pipelines |
| Charts | TradingView Lightweight Charts | Financial charts |
| Authentication | Keycloak or managed identity service | User and institutional access |
| Payments | Nigerian payment gateway | Subscriptions |
| Hosting | AWS or another reputable cloud | Production |
| Monitoring | Sentry + cloud monitoring | Errors and reliability |

Preferred: Next.js + Python FastAPI + PostgreSQL + Redis + AWS.

### Database design
Every indicator and dataset carries standard metadata. Example: Indicator (Inflation), Country (Nigeria), Source (NBS), Reference period (August 2026), Value, Unit (%), Frequency (Monthly), Publication date, Ingestion date, Revision number, Verification status. The same applies to securities, statements, bonds, FX and announcements.

### 3.2 Four data pipelines
- **A — API ingestion** (World Bank, IMF): automated, scheduled, error handling, validation, history. World Bank Indicators API needs no key; IMF provides SDMX 2.1 and 3.0 APIs.
- **B — Market-data feeds** (NGX, FMDQ): secure connections, scheduled or streamed per licence, market calendar, instrument identification, price/volume validation.
- **C — Document collection** (CBN, NBS, DMO, SEC, corporate disclosures): monitor pages, detect new documents, download permitted ones, extract text and tables, record URLs, preserve originals and publication dates.
- **D — Editorial and research** (news, industry publications): RSS, licensed news APIs, human submissions, regulatory monitoring.

Do not indiscriminately copy websites; respect robots.txt, terms, copyright and contracts.

## 4. Working without AI initially
Launch with deterministic software: rules, calculations, scheduled jobs, human-reviewed research.

| Requirement | Non-AI implementation |
|---|---|
| Stock performance | Mathematical calculations |
| Company comparisons | Ratio formulas |
| Screening | SQL filters |
| Inflation trends | Statistics |
| Gainers/losers | Price-change calculations |
| News | RSS and document collection |
| Research | Human analysts |
| Company profiles | Structured database |
| Economic calendar | Scheduled dates |
| Portfolio analysis | Quantitative calculations |
| Source verification | Rules and human review |

**Proprietary calculation library:** revenue growth, net profit growth, EPS, P/E, P/B, ROE, ROA, dividend yield, debt-to-equity, current ratio, net interest margin (banks), NPL ratio, capital adequacy ratio (where disclosed), volatility, maximum drawdown, correlation, rolling returns. Tested, documented, version-controlled.

AI is a separate later layer; the core database, calculations and verification must not depend on it.

## 5. Licensing and regulatory strategy

**A. Market data:** NGX (display, storage, delayed/live, redistribution); FMDQ (subscription, redistribution, derived data); NASD (access, display, storage, redistribution); S&P Global (API use, display, redistribution); AlphaSense (content use, embedded API). Access is not redistribution.

**B. International data:** document dataset-specific terms; check attribution, commercial use, reuse limits, embedded third-party material, redistribution of modified datasets. Paid contracts must distinguish internal use, derived data, display and redistribution.

**C. Nigerian regulatory boundaries:** position as a financial information, research and analytics provider. First release must not execute trades, hold funds, operate brokerage accounts, give personalised recommendations or manage portfolios. SEC publishes robo-advisory rules and a fintech framework. Obtain a capital-markets legal opinion before launch; a disclaimer alone does not make a regulated activity unregulated.

**D. Data protection and cybersecurity:** NDPA compliance, privacy notices and consent, retention and deletion, role-based access, MFA for institutional users, encryption in transit and at rest, security logging, backup and disaster recovery, vendor due diligence, incident response. Minimise personal data.

## 6. Procurement process
1. Vendor introduction
2. Technical demonstration (APIs, samples, documentation, sandbox)
3. Commercial proposal (startup pricing, minimums, subscriptions, usage, enterprise)
4. Licensing and legal review (display, redistribution, derivative works, retention, sublicensing)
5. Proof of concept and approval

Order: NGX (EOD/delayed proposal + website distribution licence) → FMDQ (fixed-income/FX subscription and redistribution) → CBN, NBS, DMO (data access) → IMF, World Bank (API and reuse) → S&P Global (Nigerian financials + Kensho) → AlphaSense (pilot + API).

### Suggested procurement email (NGX, FMDQ, S&P Global)
> **Subject:** Strategic Data Integration and Commercial Partnership Enquiry – SAMUEL Financial Intelligence
>
> Dear Partnerships Team,
>
> We are developing SAMUEL Financial Intelligence, a Nigerian-focused financial markets and economic intelligence platform designed to serve individual investors, financial professionals, institutional investors and international market participants.
>
> Our objective is to establish a reliable, technology-driven platform providing comprehensive financial-market information, economic indicators, company intelligence, historical datasets and professional analytical services, initially focused on Nigeria.
>
> We are currently evaluating established data providers and technology partners for integration into our platform. We would appreciate information on: available products and datasets; API and integration options; historical data; commercial licensing and website display rights; redistribution and institutional subscription arrangements; startup, emerging-market or technology-partner pricing; technical documentation and sandbox availability; potential strategic partnership.
>
> We would welcome an introductory meeting and technical demonstration.
>
> Kind regards,
> SAMUEL Financial Intelligence — Partnerships & Technology Development

## 7. 12-month implementation roadmap
- **Months 1–2 — Foundation and procurement:** register company; legal scoping; finalise architecture; open NGX/FMDQ discussions; obtain CBN, NBS, DMO, IMF, World Bank access; define database; UI/UX and brand. *Deliverable: approved technical blueprint.*
- **Months 3–4 — Core technology:** frontend; backend APIs; central PostgreSQL; registration; ingestion pipelines; calculation library; security and monitoring. *Deliverable: functional platform.*
- **Months 5–6 — Market and economic intelligence:** NGX data; FMDQ where agreed; CBN, NBS, DMO; IMF and World Bank; company profiles; economic dashboards; editorial workflow. *Deliverable: public beta.*
- **Months 7–8 — Institutional product:** advanced financials; ratios and screening; historical charts; research library; permissions; billing; institutional dashboard; report generation. *Deliverable: SAMUEL Pro beta.*
- **Months 9–10 — Research and analytics:** proprietary indices; more coverage; quantitative analytics; test LEAN; evaluate AlphaSense and Kensho pilots; institutional demos. *Deliverable: advanced capabilities.*
- **Months 11–12 — Commercialisation:** independent security assessment; data-quality audit; SLA monitoring; institutional onboarding; API access controls; research publication policy; continuity testing; international outreach. *Deliverable: institutional-ready platform.*

Timeline depends on data access and licensing; NGX and FMDQ negotiations may affect it.

## 8. Lean investment allocation (planning estimates, not quotes)

**Initial envelope: USD 35,000–65,000** (excluding major enterprise data contracts).

| Category | Range (USD) |
|---|---|
| Product design and UX | 2,000–4,000 |
| Frontend and backend development | 12,000–19,000 |
| Database and data ingestion | 4,000–7,000 |
| Financial analytics and dashboards | 3,000–5,000 |
| Security and testing | 2,000–4,000 |
| Legal, compliance and contracts | 2,000–4,000 |
| Data integration and pilot allowance | 3,000–7,000 |
| Initial infrastructure and deployment | 1,000–2,000 |
| Contingency | 6,000–13,000 |

No major AlphaSense or S&P Global annual contract in the initial budget; negotiate startup pricing, pilots, limited packages, pay-per-use, non-exclusive terms, deferred upgrades.

**Monthly running costs (USD):** cloud hosting and storage 150–400; monitoring, backups, security 50–150; software and tools 50–150; data collection and processing 50–150; technical maintenance 300–700; editorial and research 300–700. **Total 900–2,250**, excluding exchange licences, premium research, paid news, transaction fees and team expansion. Keep an operating reserve.

## 9. Initial team
| Role | Responsibility |
|---|---|
| Project Director / CEO | Strategy, partnerships, commercial development |
| Technology Lead | Architecture, security, engineering oversight |
| Full-stack Developer | Frontend, backend, API |
| Data Engineer / Financial Analyst | Ingestion, validation, calculations |
| Research Editor / Economist | Economic research, editorial quality, publications |

Outsource: capital-markets legal counsel, cybersecurity assessor, UI/UX designer, data-licensing consultant, accounting and audit. **Do not compromise on the Data Engineer.**

## 10. Institutional readiness checklist
1. Company profile and governance structure
2. Documented data-source register
3. NGX and FMDQ licensing appropriate to displayed data
4. Calculation and validation methodology
5. Source attribution and revision history
6. Cybersecurity and data-protection policies
7. Research independence and conflicts-of-interest policy
8. Institutional permissions and audit logs
9. Service availability and incident response
10. Institutional product demonstration
11. Subscription and service agreements
12. Business continuity and disaster recovery plan

## 11. Five key commercial decisions
1. **Market data:** launch with licensed end-of-day or delayed NGX data, not every real-time feed.
2. **Research:** own analysts and official sources first; AlphaSense when justified.
3. **Financial intelligence:** build our own calculation engine and company database — a core long-term asset.
4. **AI:** not a launch dependency; infrastructure AI-ready.
5. **Institutional subscriptions:** build access and billing architecture from the beginning.

## 12. Ownership of deliverables
Source code, database schema, calculation library, API docs, ingestion scripts, UI and design assets, infrastructure configuration, deployment docs, security docs, administrator credentials, automated tests — **all owned by SAMUEL**. Third-party software and datasets documented with licences. No developer may retain exclusive control of the production database, domain, cloud account or source code.

## 13. Final recommendation — the SAMUEL launch formula
1. **Authoritative Nigerian data:** NGX, FMDQ, CBN, NBS, DMO, SEC
2. **International benchmarks:** IMF, World Bank, AfDB
3. **SAMUEL-owned intelligence:** calculations, historical database, research, proprietary indices
4. **Premium institutional technology:** AlphaSense, Kensho, QuantConnect when commercially justified

The long-term advantage is the quality of the data, the ability to explain what it means, and investor trust — not the number of providers integrated.

## 14. Three immediate actions
1. Formal technical and commercial discussions with NGX and FMDQ.
2. Commission the master data architecture and database specification.
3. Develop the public portal and institutional dashboard in parallel on the same infrastructure.

Keep the first product Nigeria-focused, but design the database to accommodate other African exchanges, currencies, indicators and regulatory systems.

**Next document recommended:** a **Technical Requirements Specification (TRS)** — full schema, API endpoints, provider integration requirements, permissions, dashboard specifications and acceptance tests.

---

# PART 2 — Recommended Company Coverage

Launch with **18 Nigerian companies** across banking and major non-bank sectors. Five-year history **FY2021–FY2025**: annual figures, year-on-year changes, five-year trends. Unpublished or unverified 2025 reports are marked **"Pending verification"**, never estimated.

## Initial list (selection, not a recommendation to buy)

| # | Company | NGX ticker | Sector |
|---|---|---|---|
| 1 | Zenith Bank Plc | ZENITHBANK | Banking |
| 2 | Guaranty Trust Holding Company (GTCO) | GTCO | Banking |
| 3 | Access Holdings Plc | ACCESSCORP | Banking |
| 4 | United Bank for Africa (UBA) | UBA | Banking |
| 5 | First HoldCo Plc | FIRSTHOLDCO | Banking |
| 6 | Stanbic IBTC Holdings Plc | STANBIC | Banking |
| 7 | MTN Nigeria Communications Plc | MTNN | Telecommunications |
| 8 | Airtel Africa Plc | AIRTELAFRI | Telecommunications |
| 9 | Dangote Cement Plc | DANGCEM | Cement / Industrial |
| 10 | BUA Cement Plc | BUACEMENT | Cement / Industrial |
| 11 | Lafarge Africa Plc | WAPCO | Cement / Industrial |
| 12 | BUA Foods Plc | BUAFOODS | Food production |
| 13 | Nestlé Nigeria Plc | NESTLE | Food / Consumer goods |
| 14 | Nigerian Breweries Plc | NB | Consumer goods |
| 15 | Seplat Energy Plc | SEPLAT | Oil & Gas |
| 16 | Aradel Holdings Plc | ARADEL | Oil & Gas |
| 17 | Oando Plc | OANDO | Oil & Gas |
| 18 | Geregu Power Plc | GEREGU | Power / Utilities |

Confirm listing status, ticker and sector against the NGX directory. **Flour Mills of Nigeria** excluded from the active list until listing status and a continuing trading price are confirmed; may be kept as an archived profile.

## Core financial indicators (every company)
Revenue; revenue growth (%); gross profit; operating profit; EBITDA; profit before tax; profit after tax; EPS; DPS; total assets; total liabilities; total debt / borrowings; shareholders' equity; operating cash flow; CAPEX; free cash flow; ROE; ROA; net profit margin; dividend yield.

Market indicators alongside: current share price and chart; market capitalisation; shares outstanding; P/E; P/B; dividend yield; 52-week high/low; five-year share-price performance.

Debt, liabilities and equity are separate figures. EPS and DPS in naira per share.

## Sector-specific indicators

**A. Banks** (Zenith, GTCO, Access, UBA, First HoldCo, Stanbic IBTC): interest income; interest expense; net interest income; non-interest income; total operating income; PBT; PAT; total loans and advances; gross loans; non-performing loans; NPL ratio; loan-loss impairment charge; customer deposits; total assets; shareholders' equity; capital adequacy ratio; liquidity ratio; cost-to-income ratio; net interest margin; EPS and DPS.
Headline: net interest income, PAT, customer deposits, loans and advances, NPL ratio, capital adequacy ratio.

**B. Telecommunications** (MTN, Airtel): service revenue; data revenue; voice revenue; mobile money / fintech revenue; EBITDA and margin; CAPEX; free cash flow; total subscribers; active data subscribers; ARPU; data traffic; network investment / coverage; net debt and FX exposure.

**C. Cement and industrial** (Dangote Cement, BUA Cement, Lafarge Africa): revenue; cost of sales; gross profit; EBITDA and margin; operating profit; PBT and PAT; sales volume (tonnes); production capacity; capacity utilisation; average selling price per tonne; energy and fuel costs; CAPEX; total and net debt; operating cash flow; DPS.

**D. Food and consumer goods** (BUA Foods, Nestlé Nigeria, Nigerian Breweries): revenue by segment; gross profit and margin; operating profit; EBITDA and margin; PBT and PAT; raw material costs; inventory; trade receivables; trade payables; working capital; production volume; distribution costs; borrowings and finance costs; operating cash flow; EPS and DPS.

**E. Oil and gas** (Seplat, Aradel, Oando): revenue; production (boe/d); oil and gas production; average realised oil price; EBITDA; operating profit; PBT and PAT; CAPEX; operating cash flow; free cash flow; borrowings and net debt; debt-to-equity; reserves and resources; lifting / production costs; DPS.

**F. Power and utilities** (Geregu Power): electricity generated (MWh); available capacity; plant availability; capacity utilisation; energy sold; revenue; EBITDA; operating costs; receivables from the market / settlement system; receivables ageing; CAPEX; debt and finance costs; operating cash flow.

## Five-year reports
Target: FY2021–FY2025 audited consolidated annual reports for all 18 companies (90 reports). This is a collection schedule, not confirmation that the reports have been collected.

Where to obtain:
1. NGX listed-company filings (main reference; NGX filing library hosts company PDFs)
2. Proshare (annual reports and results)
3. MTN Nigeria investor relations (2021–2025 annual reports)
4. Dangote Cement investor relations (annual reports and results)
5. FinancialFilings (Nigeria) — verify against issuer or NGX originals

Historical qualifications:
- **Access Holdings:** holding company established 2022; earlier years may need predecessor information.
- **BUA Foods:** listed 2022; earlier history from pre-listing reports.
- **Aradel Holdings:** listed 2024; earlier figures from historical audited statements.
- **Airtel Africa:** report in its reporting currency; any naira conversion clearly labelled.
- **MTN Nigeria:** account for FX movements when comparing profits.

Preserve original reported figures; identify restated or predecessor figures separately.

## Presentation
Each company profile has five tabs:
- **Overview:** description, sector, ticker, management, subsidiaries, KPIs
- **Financials:** five-year income statement, balance sheet, cash flow
- **Ratios:** profitability, liquidity, leverage, valuation, efficiency
- **Dividends:** history, EPS, DPS, payout ratio, dividend yield
- **Annual Reports:** downloadable originals with audited status, period, publication date

Headline tiles: revenue, PAT, EPS, DPS (latest year), and a five-year revenue/PAT chart.

## Make the five-year database a core asset
For every company and year store: original reported figure; standardised figure; currency and unit; reporting period; source document and page; consolidated or company-only; audited or unaudited; restatement status; verification date.

Allow users to **download a five-year comparison in Excel or PDF**.

First implementation: collect and standardise all 90 reports, then build dashboards on verified figures. Distinguish audited annual results from interim results and estimates.
