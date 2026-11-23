# SFI — System Architecture, Tech Stack & Roadmap (v2)

> **Status:** Planning document. Supersedes earlier roadmap ordering where they conflict.
> Sections marked **(brainstorm)** are direction, not decisions.
> Source of truth for build rules remains `AGENTS.md` and `docs/ARCHITECTURE_AND_DATA_MODEL.md`; this document feeds updates into both.

---

## 1. What SFI is

**Samuel Financial Intelligence** is a Nigerian financial intelligence platform: verified data on Nigerian companies, IPOs and markets, turned into analysis people can act on.

It is one data core with four faces:

| Face | For | Form |
|---|---|---|
| **Public site** | Everyone | bloomberg.com-style front page: news, research, video, market snapshot, IPO calendar |
| **Terminal** | Professionals (PFAs, asset managers, brokers, analysts) | Dense, logged-in workspace: companies, financials, screens, charts, alerts |
| **Data API** | Fintechs, banks, media | Machine-readable feeds of SFI's verified data |
| **AI analyst** | Premium and institutional users | Questions answered from SFI's approved data, with citations |

**The moat:** clean, verified, machine-readable history of Nigerian companies, where every figure traces to its source document and page. Global tools (AlphaSense, Kensho, Bloomberg) do not have this properly for Nigeria. SFI owns this core; outside services plug into it, never the other way round.

---

## 2. Principles (unchanged, and binding)

1. **Data before AI.** AI is a layer on approved data, never the source of truth.
2. **Every figure has provenance:** source, document, page, period, units, retrieval time, licence status.
3. **Nothing is edited or deleted in place.** Corrections are new versions; withdrawals stay visible with a reason.
4. **No fake data.** Empty states say so honestly.
5. **Licences before display.** No NGX prices until a signed licence exists.
6. **Flag, don't block, while the team is small.** Self-approval, self-publishing and self-review are allowed but recorded and visible, behind switches that enforce two-person review once the team grows.
7. **Security reviewed every stage:** `/security-review`, `ecc:security-bounty-hunter`, `/code-review high`, attack tests kept as permanent tests.
8. **Portable by design:** standard Next.js + Postgres + Python, so hosting can move (Vercel → Azure) without rewrites.
9. **Facts vs opinion are always labelled:** reported data, calculated metrics, analyst opinion, guest opinion, AI-generated text.

---

## 3. System architecture

```
                 ┌─────────────────────────── SOURCES ───────────────────────────┐
                 │ Issuers (reports, announcements)  NGX*  SEC  CBN  NBS  DMO     │
                 │ FMDQ*  YouTube (video)  External AI/data providers*            │
                 └──────────────┬─────────────────────────────────────────────────┘
                                │                         (* = licence / contract)
                 ┌──────────────▼───────────── INGESTION ─────────────────────────┐
                 │ Manual desks (now): upload, announcements, editorial, figures  │
                 │ Python collectors (later): scheduled, change detection, retry  │
                 │ Provider adapters: ONE interface per outside service           │
                 └──────────────┬─────────────────────────────────────────────────┘
                 ┌──────────────▼──────── QUALITY & REVIEW ───────────────────────┐
                 │ Validation rules, units/period checks, duplicates, maker-checker│
                 │ Review queues, self-approval flags, audit log (append-only)    │
                 └──────────────┬─────────────────────────────────────────────────┘
                 ┌──────────────▼──────── CORE DATA PLATFORM ─────────────────────┐
                 │ Supabase Postgres: companies, people, instruments, documents,  │
                 │ statements, announcements, offers, corporate actions, editorial│
                 │ Supabase Storage: original files (private, signed URLs)        │
                 │ Append-only versions, RLS deny-by-default, provenance on rows  │
                 └──────┬──────────────────────┬──────────────────────┬───────────┘
          ┌─────────────▼────────┐ ┌───────────▼───────────┐ ┌────────▼──────────┐
          │ ANALYTICS ENGINE     │ │ INTELLIGENCE LAYER    │ │ ENTITLEMENTS      │
          │ Python: ratios,      │ │ LLM via adapter +     │ │ Who may see what: │
          │ growth, margins,     │ │ retrieval over        │ │ free / premium /  │
          │ peer stats, events,  │ │ approved data,        │ │ institutional /   │
          │ formula versions     │ │ citations, eval set   │ │ API; licence-aware│
          └─────────────┬────────┘ └───────────┬───────────┘ └────────┬──────────┘
                        └──────────────┬───────┴──────────────────────┘
                 ┌─────────────────────▼──────── DELIVERY ────────────────────────┐
                 │ Public site │ Terminal │ Data API │ Alerts (email, WhatsApp*)  │
                 │ Video (YouTube → Mux/Cloudflare Stream → live)                 │
                 └────────────────────────────────────────────────────────────────┘
  Cross-cutting: Auth + roles + RLS · audit log · secrets · monitoring · backups ·
                 security reviews each stage · legal disclaimers · billing
```

### Key boundaries

- **Provider adapter layer.** Every outside data or AI service connects through a single adapter with its own credentials, licence metadata and kill switch. Swapping a provider never touches pages.
- **Market data service boundary.** Prices sit behind one interface so end-of-day data can later be replaced by a real-time stream without rewriting pages.
- **Entitlements layer (new).** Decides what each user tier may see, and enforces licence limits (e.g. NGX prices only for tiers covered by the licence). Built early, because every later revenue stream depends on it.
- **AI reads only approved data** and must cite it. It never writes to the core data.

---

## 4. Tech stack

| Area | Now (building) | Pilot (~100 users) | Scale (institutions) |
|---|---|---|---|
| Web app | Next.js 16 + TypeScript | same | same |
| Database, auth, files | Supabase Free (`sfi-dev`) | **Supabase Pro** (prod project, backups) | Supabase Pro/Team, or Azure Postgres if a client requires it |
| Hosting | Local laptop | **Vercel Pro**, host only, no Vercel-specific services | **Azure Container Apps** |
| Background workers | — | Python worker on a small host (or scheduled CI job) | Azure Container Apps Jobs |
| Worker libraries | — | Python, httpx, BeautifulSoup, pdfplumber / camelot (tables), OCR only when scanned | + FastAPI internal services |
| Charts | — | TradingView Lightweight Charts (prices) + one general chart library; `dataviz` skill for consistency | same |
| Search | Postgres full-text | same | OpenSearch when needed |
| AI | — | — | LLM via API behind adapter (Claude/OpenAI), pgvector for retrieval, evaluation set |
| Video | YouTube id only | YouTube | Mux or Cloudflare Stream; live later |
| Email | — | Resend | same |
| Alerts | — | Email | + WhatsApp Business API **(brainstorm)** |
| Payments | — | **Paystack or Flutterwave** (Naira subscriptions) **(new)** | + invoicing for institutions |
| Secrets | `.env.local` (gitignored) | Vercel env vars | Azure Key Vault |
| Monitoring | Dev logs | Error monitoring service | Azure Application Insights |
| CI | GitHub Actions (private repo) | same | same + deploy to Azure |
| Staff login | Email + password | + MFA (Supabase TOTP) | + Microsoft Entra SSO for institutional clients |

**Not using:** AlphaSense, Sentieo, Kensho, QuantConnect, Plaid, robo-adviser platforms as plug-ins. They are separate products built for US/global markets, without Nigerian data; most cannot be resold inside SFI. Study them as product references. A specific component (e.g. transcription) may be bought later through the adapter layer.

---

## 5. Data model — additions planned

Built so far: source registry, companies (+ profile history, slug, `pre_listing`, listing board), instruments + identifiers, documents + review events, source records, versioned observations and statements, announcements, editorial items + citations, platform staff, append-only audit log.

| Addition | Purpose | When |
|---|---|---|
| **People & tenures** — `people`, `company_roles` (role, start, end, source) | CEO/board profiles; performance during each tenure | Phase 3b |
| **Statement templates by sector** — bank / insurer / general line items | Nigerian banks report interest income, loans, deposits, not "revenue" | Phase 3c |
| **Figure entries** — value, units (₦'000 / m / bn), period, document + page, maker, checker, AI-assisted flag | Manual entry with maker-checker | Phase 3c |
| **Metric definitions** — formula, version, owner (economist) | Data dictionary; reproducible metrics | Phase 3d |
| **Corporate actions** — instrument, type, dates, amount per share, WHT, ratios | Dividends, bonus, rights, splits | Phase 3e |
| **Offers** — offers, milestones, documents, risks, authorised channels | IPO centre | Phase 4 |
| **Sector exposure tags** — company ↔ sector/region/theme with weight + source | Event-impact map (CEO's "Rivers State" idea) | Phase 8 |
| **Events** — policy / project / macro events tagged to sectors and regions | "Who could be affected" without predictions | Phase 8 |
| **Accounts & entitlements** — plans, subscriptions, seats, organisations | Free / premium / institutional access | Phase 5 |
| **API clients** — keys, scopes, rate limits, usage metering | Data API for fintechs | Phase 9 |
| **AI interactions** — question, sources used, model, prompt version, feedback | Audit + quality of AI answers | Phase 8 |

---

## 6. Roadmap (revised)

### Done
- **Foundation** — app shell, auth, schema, source registry, provenance, security headers, CI.
- **2a Documents** — upload, review, private storage, 10-minute signed URLs, self-approval flag. Smoke test 26/26 on real Supabase.
- **2b Announcements** — publish from approved documents, corrections, withdrawals, `/news`.
- **2c Editorial** — articles, analysis, YouTube video, citations, AI-assisted label, `/research`. 22 attack tests.

### Phase 3 — Company intelligence (in progress — next: 3c)
| Step | Scope |
|---|---|
| **3a** Profiles *(done)* | Admin desk, company pickers on existing desks, `/companies` directory, `/companies/[slug]`, old-slug redirects, reader verification |
| **3b** People & leadership *(done)* | Executives and board with tenures, each role citing a document + page or an announcement; leadership record published; "company performance during tenure" panel showing sourced company facts beside the tenure dates. Facts only, opinion labelled: **no scores, rankings or causal claims**. Peer comparison deferred |
| **3c** Financial entry desk **(next)** | Editable template catalogue: core set plus six sector sets (bank, telecoms, cement/industrial, food & consumer, oil & gas, power). Operating metrics stored as **reported disclosures, never computed**. Per figure: reported value beside standardised value, currency as reported (no conversion here), units, FY period with dates, consolidated vs company-only, audited status, restatement status, document + page, verified date. Issuer restatement distinguished from an SFI correction. Missing year reads **"Pending verification"**. Predecessors linked by a succession record, history kept separate. Maker-checker under a distinct `financial_analyst` role, solo flagged. AI suggestions queued for one-at-a-time human verification; model deferred behind the adapter |
| **3d** Metrics & charts | System-calculated margins, growth, ROE etc. with formula versions; financial history charts; **coverage score** per company |
| **3e** Dividends & corporate actions | History, charts, dates |

### Phase 4 — IPO centre
Offers, timelines (versioned dates), prospectus library, risks with page references, authorised channels only, post-listing status, IPO calendar.

### Phase 5 — Public front & accounts
bloomberg.com-style public homepage (no login), free registration, **entitlements + Paystack/Flutterwave subscriptions**, watchlists, email alerts, methodology & corrections pages, mobile-first / low-data mode.

### Phase 6 — Pilot launch (~100 users)
Production Supabase (Pro) + Vercel Pro, monitoring, backups, MFA for staff, legal disclaimers approved by counsel, light external pen test, design-partner cohort.

### Phase 7 — Collectors (Python worker)
Unfreeze macro: CBN/NBS collectors, issuer/NGX document detection, change detection, quality checks. Writes only pending rows; humans approve.

### Phase 8 — AI analyst v1
Retrieval over approved data with citations; company Q&A, CEO profile Q&A, IPO prospectus Q&A, daily briefing drafts (human-reviewed); event-impact map ("this policy touches these sectors and companies"); evaluation set built with the economist. **Legal gate:** no buy/sell advice or "success rates" until counsel clears it.

### Phase 9 — Data API & market data
API keys, scopes, rate limits, metering, docs, billing; first fintech customers. NGX prices once licensed (end-of-day first), and NGX authorised-vendor status before redistributing prices through the API.

### Phase 10 — Scale
Azure migration, institutional features (team seats, SSO), real-time prices + streaming, live video broadcasts, SFI indices, research subscriptions, regional expansion.

### Business workstreams (in parallel, not code)
| Workstream | Owner |
|---|---|
| NGX licence quote + sandbox + vendor terms | CEO / you |
| Capital-markets lawyer (ISA 2025 advice boundary, AI, data reuse, NDPA) | CEO |
| Economist / university lecturer as part-time adviser | CEO |
| Pilot company list, priority figures, history depth | CEO + financial lead |
| Customer interviews (fintechs, PFAs, brokers) | CEO + you |
| CAC registration, trademark, domain | CEO |
| Microsoft for Startups (Azure credits) | You |
| Reuse confirmation from CBN, NBS, DMO, SEC, NUPRC | You / lawyer |

---

## 7. Revenue model (brainstorm)

| Customer | Product | Notes |
|---|---|---|
| Fintechs (Bamboo, PiggyVest, Risevest, Cowrywise…) | **Data API** subscription | Likely fastest serious revenue. Own data freely; NGX prices only with vendor status |
| PFAs, asset managers, insurers | **Terminal seats** (yearly) | Institutional pricing, team accounts |
| Stockbrokers | Terminal seats + white-label research | |
| Banks | Data feeds into risk/compliance systems | Later |
| High-net-worth individuals | Premium + AI analyst | |
| Retail | Free tier + low-cost premium | Audience and brand |
| Listed companies | IR services: earnings calls, investor days on SFI video | Must disclose; editorial independence protected |
| Sponsors | Video programmes, events, newsletters | Clearly labelled |
| Fund managers | SFI indices (licensed) | Long term |

Pricing is **not** set until customer interviews and vendor costs are known.

---

## 8. Team

| Role | Person | Responsibility |
|---|---|---|
| Business lead | CEO | Vision, partnerships, brokerage knowledge, budget, final priorities |
| Technical lead | You | Architecture, build, security, deployment |
| Economist / lecturer (adviser) | To recruit | Metric definitions, methodology, macro context, AI evaluation questions |
| Financial analyst | Later | Figure entry and checking |
| Legal counsel | As needed | Advice boundary, data rights, AI, data protection |
| Video producer | Later / freelance | Interviews and programmes |

Decision rule: the financial side owns **meaning**; the technical side owns **how it is collected, secured and shown**.

---

## 9. Ideas to adopt (proposed by Claude)

1. **Entitlements early.** Every revenue stream depends on "who can see what". Building it in Phase 5 avoids retrofitting every page later.
2. **Naira payments via Paystack/Flutterwave**, with invoicing for institutions.
3. **Public methodology page.** Every metric's definition and formula version, owned by the economist. Professionals trust what they can audit.
4. **Coverage score per company.** "We have 5 of 5 years for GTCO, 2 of 5 for X." Honest, and it directs analyst work.
5. **Design partners.** 3–5 fintechs/brokers/PFAs get early free access in exchange for feedback. Validates pricing before it is set.
6. **AI evaluation set.** 50–100 real questions with correct, sourced answers, written with the economist. The AI must pass it before launch and after every change.
7. **WhatsApp alerts (later).** Nigerian users live on WhatsApp; IPO deadlines and results alerts there could beat email.
8. **Mobile-first, low-data mode.** Many users are on phones and costly data.
9. **Public corrections log.** A page listing every correction and withdrawal. Turns honesty into a selling point.
10. **Event-impact map without predictions.** Tag companies by sector/region exposure; when a policy or project is announced, show who is exposed and how they performed in similar past events, with sources. Delivers the CEO's "same news, better processing" idea while staying on the safe side of investment advice.

---

## 10. Key risks

| Risk | Control |
|---|---|
| Investment-advice regulation (ISA 2025) | Facts, history, scenarios; no buy/sell or success rates until legal clearance |
| Data licensing (NGX, FMDQ) | Licence before display; vendor status before redistribution |
| Wrong figures | Document + page per figure, maker-checker, validation, visible corrections |
| AI errors | Approved data only, citations, eval set, human review of published AI text |
| Statements about real people (CEO profiles) | Facts with sources only; opinion labelled; right-of-reply process |
| Editorial independence vs paid IR services | Disclosure, separation, labelled sponsorship |
| Vendor lock-in | Portable stack, adapter layer, host-only use of Vercel |
| Small team / key-person risk | Docs in repo, tests as specification, private backups |

---

## 11. CEO strategy (Nov 2026): how it fits

The CEO's "Master Technology Integration & Provider Procurement Strategy" and "Recommended company coverage" documents were reviewed against this plan.

### Agreed and already reflected
- One infrastructure, two products: **SAMUEL Public** (free) and **SAMUEL Institutional** (paid), with different permissions on one database.
- Own the data and calculations first; buy outside intelligence only when it gives a measurable advantage.
- No AI dependency at launch; AI-ready architecture.
- Standard metadata on every figure; deterministic, tested, versioned calculation library.
- Licensing and regulatory workstream; "information and research provider" positioning; no trading, custody or personalised advice.
- Code, schema, calculation library, docs and credentials belong to SAMUEL.
- Billing and institutional access designed from the start (entitlements, Phase 5).
- Nigeria first, database designed for other African markets later.

### Adopted from the CEO's documents (new)
| Item | Where |
|---|---|
| **Pilot universe: 18 companies** (Appendix A), **FY2021–FY2025** annual audited consolidated reports (90 reports) | Seed in 3c; data entry after 3c |
| **Sector-specific indicator sets**: banks, telecoms, cement/industrial, food & consumer, oil & gas, power | 3c templates (catalogue, editable) |
| Per-figure fields: **original reported figure and standardised figure**, currency, unit, period, source document + page, consolidated vs company-only, **audited/unaudited**, **restatement status**, **verified date** | 3c |
| Missing or unverified year shown as **"Pending verification"**, never estimated | 3c/3d |
| Company page tabs: **Overview · Financials · Ratios · Dividends · Annual Reports** | 3d |
| **Five-year comparison download (Excel / PDF)** | 3d |
| Reporting-currency handling (e.g. Airtel Africa reports in USD; any naira conversion labelled) | 3c |
| **Predecessor / restructured entities** (Access Holdings 2022, BUA Foods listed 2022, Aradel listed 2024) | 3c (succession record: former entity marked delisted/former, linked with an effective date and source; history kept separate) |
| Bank, telecom, cement, oil and power **operating metrics** (NPL ratio, CAR, subscribers, ARPU, tonnes, boe/d, MWh) stored as **reported disclosures**, not computed | 3c |
| Substantial public content **without registration**; registration unlocks watchlists, saved reports, alerts | Phase 5 |
| **Economic calendar** (MPC, NBS releases, auctions) | Phase 5 (manual) → Phase 7 (automated) |
| **Commodities & energy** category (EIA, World Bank Pink Sheet, UNCTAD, UN Comtrade) | Phase 7 |
| Four ingestion pipelines: **A** API (World Bank, IMF) · **B** market feeds (NGX, FMDQ) · **C** documents (CBN, NBS, DMO, SEC, issuers) · **D** editorial/news (RSS, licensed) | Phase 7 / 9 |
| QuantConnect **LEAN (open source)** for backtesting and portfolio analytics, no live trading | Phase 10 |
| AlphaSense small-team pilot; S&P/Kensho only if Nigerian coverage is confirmed | Phase 10, evaluated |
| **Technical Requirements Specification (TRS)** generated from the actual codebase | After 3c |

### Where this plan differs, and why
| CEO document | This plan | Reason |
|---|---|---|
| FastAPI backend, Keycloak, Celery + Redis, TimescaleDB, AWS | Next.js server + **Supabase** (Postgres, Auth, Storage) + Python workers; Vercel → Azure | Already built and security-tested (700+ tests). Same capabilities: Supabase Auth replaces Keycloak, Supabase Storage is S3-compatible, Python is used for workers and the calculation library. FastAPI is added for the Data API (Phase 9) if needed. TimescaleDB is unnecessary until real-time ticks. Cloud provider (AWS vs Azure) is a business decision; nothing in the stack prevents either. |
| FMDQ "acquire now"; fixed income and FX in the public launch | Fixed income frozen until licences exist | No FMDQ data can be shown without its licence. Request the FMDQ proposal now in parallel with NGX; build fixed-income pages when terms are known. |
| P/E, P/B, market cap, dividend yield, 52-week range on company pages | Shown only after NGX licence | They need share prices. Accounting ratios (margins, ROE, ROA, NIM, growth) are built from annual reports now. |

## 12. Open decisions

1. First paying customer segment (fintech API vs institutional seats).
2. How far the AI goes (explain-only vs registered advice).
3. ~~Pilot company list~~ *(settled: the 18 of Appendix A; FY2021–FY2025; banks first)*. Priority figures within each template remain open.
4. Who verifies figures (maker-checker partner).
5. Growth Board segments (Entry / Standard) shown separately?
6. Budget for NGX licence, legal, hosting this year.
7. Whether to offer IR services, and on what independence terms.
8. Cloud for scale: Azure or AWS.
9. Who performs data entry and verification for the 90 pilot reports. The `financial_analyst` staff role exists from 3c and the technical lead holds it for now; the CEO's plan says do not compromise on a dedicated Data Engineer / Financial Analyst.

---

## Appendix A — Pilot universe (from CEO, to be verified against the NGX directory)

| # | Company | NGX ticker | Sector / template |
|---|---|---|---|
| 1 | Zenith Bank Plc | ZENITHBANK | Bank |
| 2 | Guaranty Trust Holding Company (GTCO) | GTCO | Bank |
| 3 | Access Holdings Plc | ACCESSCORP | Bank |
| 4 | United Bank for Africa | UBA | Bank |
| 5 | First HoldCo Plc | FIRSTHOLDCO | Bank |
| 6 | Stanbic IBTC Holdings Plc | STANBIC | Bank |
| 7 | MTN Nigeria Communications Plc | MTNN | Telecoms |
| 8 | Airtel Africa Plc | AIRTELAFRI | Telecoms (reports in USD) |
| 9 | Dangote Cement Plc | DANGCEM | Cement / industrial |
| 10 | BUA Cement Plc | BUACEMENT | Cement / industrial |
| 11 | Lafarge Africa Plc | WAPCO | Cement / industrial |
| 12 | BUA Foods Plc | BUAFOODS | Food & consumer |
| 13 | Nestlé Nigeria Plc | NESTLE | Food & consumer |
| 14 | Nigerian Breweries Plc | NB | Food & consumer |
| 15 | Seplat Energy Plc | SEPLAT | Oil & gas |
| 16 | Aradel Holdings Plc | ARADEL | Oil & gas |
| 17 | Oando Plc | OANDO | Oil & gas |
| 18 | Geregu Power Plc | GEREGU | Power & utilities |

Period: FY2021–FY2025, audited consolidated annual reports as primary source. Flour Mills excluded pending confirmation of listing status. Ticker, listing status and sector must be confirmed against the NGX directory before seeding.

Report sources: NGX listed-company filings (primary), issuer investor-relations pages; Proshare and other catalogues only as finding aids, always verified against issuer or NGX originals.
