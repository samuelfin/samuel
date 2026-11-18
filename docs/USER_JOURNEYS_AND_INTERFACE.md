# User Journeys and Initial Interface

## Core journeys

### Investor: research a listed company

1. Search a name or symbol globally.
2. Open the company workspace and see latest permitted market observation, its timestamp/status, key company facts and source links.
3. Switch between overview, financials, price history, announcements and documents.
4. Compare periods or add the company to a watchlist.
5. Export a source-attributed summary if the account entitlement and licence permit it.

### Analyst: compare two issuers

1. Select companies and choose annual or interim reporting periods.
2. Review the coverage/period alignment panel before comparing.
3. Compare reported values and backend-calculated metrics with formula definitions and source references.
4. Ask the research assistant to explain evidence-backed differences.
5. Save an analyst-reviewed report with citations and export it.

### SFI reviewer: publish a financial document

1. Upload a permitted document and record source, rights, publication date and issuer.
2. Worker extracts tables and page references into a review queue.
3. Reviewer checks each figure against the source pages, corrects or rejects extraction, and records the decision.
4. Only approved values enter the authoritative financial dataset; corrections remain auditable.

### Administrator: resolve a stale feed

1. Provider health panel flags the last successful observation and freshness breach.
2. Admin inspects failed job and provider error without exposing credentials.
3. Retry or pause the adapter; quarantine suspect values.
4. Verify source recovery and clear the alert with an audit record.

## Navigation model

Persistent left rail: Overview, Markets, Equities, Companies, Economy, Fixed Income, News, Research, AI Intelligence, Watchlists, Alerts, Reports. Top bar: global search, current data-status summary, workspace/account menu. Administration is permission-gated.

## Dashboard information hierarchy

```text
┌ Samuel Terminal ───────── Search companies, symbols, indicators… ─ Status ┐
│ Overview  Markets  Equities  Companies  Economy  Fixed Income  ...         │
├────────────────────────────────────────────────────────────────────────────┤
│ Data coverage / as-of status (per provider; stale or unavailable is clear) │
│ Market summary cards           │ AI market briefing + citations            │
│ Index/market history chart     │ Watchlist and alerts                      │
│ Market movers table            │ Economic release calendar                  │
│ Sector performance             │ Latest news and corporate announcements   │
└────────────────────────────────────────────────────────────────────────────┘
```

All data panels must support loading, empty, stale, unavailable and error states. In the absence of authorized market data, show a useful empty state with source/connection status; do not seed fake quotes or demo values into a production-looking dashboard.

## Visual system direction

- Dark charcoal/navy terminal canvas with distinct panel surfaces.
- Restrained amber accent for focus and selected navigation; muted green/red only for validated positive/negative movement.
- Compact typography and tabular numerals; dense tables with readable row spacing and pinned headers.
- Persistent visible provenance: source, period, as-of timestamp, and delayed/EOD/historical status adjacent to values.
- Charts include units, period, missing intervals and source metadata; never draw through missing data as though it were continuous.
- Keyboard-first global search, visible focus rings, semantic headings and accessible contrast.
- Responsive layout stacks panels on narrow screens, while desktop remains optimized for parallel analysis.

## First screen content contract

The overview can render market-panel shells before feeds exist. Each panel should state “No authorized feed connected” with a link to provider setup for administrators. A connected feed must display its latest observation timestamp, data status and source. AI market briefing remains disabled until it can retrieve validated data and cite sources.
