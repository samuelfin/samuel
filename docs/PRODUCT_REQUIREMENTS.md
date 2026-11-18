# Samuel Terminal — Product Requirements

**Owner:** Samuel Financial Intelligence (SFI)  
**Status:** Phase 0 baseline; assumptions require business and legal validation  
**Product:** AI-powered Nigerian financial market intelligence, analytics and research platform

## Product outcome

Give investors, analysts, researchers and institutions one traceable place to find Nigerian market data, company financials, macroeconomic releases, fixed-income information, corporate events and research. AI assists with retrieval, comparison and explanation, while calculations remain deterministic and each material claim links to dated source material.

## Scope assumptions

The brief identifies Nigeria exclusively and investors and institutions as the target. To make a useful initial scope, this baseline covers equities, fixed income and macroeconomics, and serves individual and institutional users. Additional Nigerian markets can be added after provider coverage and licensing are established. This is a planning assumption, not a confirmed commercial decision.

The user’s “3” is interpreted as selecting the third option under “what are you aiming to build first?”: a complete production-ready platform. The system is still delivered in phases; production readiness is a target, not a claim about the current workspace.

## User groups and jobs

| User | Primary jobs |
| --- | --- |
| Individual investor | Follow the market, research listed companies, compare published results and track announcements |
| Analyst/researcher | Retrieve source-backed historical data, calculate comparable metrics and prepare research |
| Institutional team | Share governed workspaces, datasets, watchlists and approved research within an organisation |
| SFI administrator/editor | Ingest and review sources, validate extracted figures, publish research and manage access |

## Product principles

1. Every displayed financial observation carries its value date or reporting period, publication/retrieval time, unit, source and freshness state.
2. Licensed data is shown only within the rights granted by its provider. The system stores provider licensing and permitted use with each dataset.
3. Unknown, stale or unavailable data is explicit. No invented or unlabelled market numbers.
4. Financial calculations are reproducible backend functions using decimal arithmetic and documented period rules.
5. AI interpretation is separated from reported facts and links to evidence. It does not make personalised investment recommendations or place trades in the initial scope.
6. Institutional data and user workspaces are tenant-isolated.

## MVP capabilities

### Market overview and equities

- NGX indices, market snapshots, listed instruments, prices, volume, market movers and sector summaries, only to the level allowed by a signed data agreement.
- Company pages with identifiers, sector, announcements, source-linked documents, historic prices and financial statements where rights and source quality permit.
- Search across symbols, companies, indicators, news and documents.
- History and chart controls; timestamps, source and market-data status always visible.

### Economy and fixed income

- Macroeconomic series with observation period distinct from publication date, units, revision history and source links.
- FGN bonds and Treasury bills, auction calendars and results, plus permitted secondary-market price/yield coverage.
- Coupons, auction stop rates, indicative yields and traded market yields are labelled as different concepts.

### Research and content

- Company and macro comparisons with period alignment, missing-value handling and visible calculation definitions.
- Corporate announcements and SFI editorial records with original source links and rights metadata.
- Research report authoring, review/approval state, PDF/CSV/XLSX exports and retained citations.

### AI intelligence

- Retrieval over approved platform observations and documents.
- Deterministic calculations for ratios, growth and comparisons.
- Structured company and market analyses with citations and source periods.
- Document extraction in a review queue; extracted values are not authoritative until a human reviewer approves them.
- If evidence is insufficient or stale, the assistant says so and does not fill gaps.

### Accounts and administration

- Authentication, profiles, role-based permissions, organisation membership and audit history.
- Admin workflows for providers, data freshness, ingestion runs, validation, document review and research publication.
- Watchlists and configurable alerts, initially email-based.
- Plan entitlements and prices are configurable; payments/API redistribution are gated on commercial and legal decisions.

## Non-functional requirements

- Security: least privilege, secure secret storage, rate limits, validated uploads, audit logs, tenant isolation, backups and incident monitoring.
- Reliability: idempotent ingestion, retry/backoff, deduplication, source-level health, stale-data alarms and reproducible corrections.
- Performance: dashboard/API target p95 under 2 seconds for cached queries; expensive reports and document processing run asynchronously. Confirm targets against expected traffic and provider SLAs.
- Accessibility: keyboard navigation, readable contrast, semantic controls and responsive desktop-first layouts.
- Data correctness: decimal numeric storage, explicit currency/unit, timezone-aware timestamps, no mismatched-period ratios and versioned source records.
- Observability: structured logs, ingestion metrics, AI usage/cost tracking and traceable user-facing errors.

## Explicit exclusions for the first release

- Brokerage, execution, custody, portfolio management or handling client money.
- Personalised recommendations, automated portfolio advice or guaranteed-return language.
- Redistribution of exchange/provider data absent written permission.
- Unreviewed AI-extracted financial statements presented as authoritative.
- Claims of real-time coverage where the feed is delayed, end-of-day or stale.

## Acceptance gates for production launch

1. Data rights and display/redistribution permission are documented for every provider and use case.
2. Live provider credentials are held server-side; operational dashboards show feed health and data freshness.
3. Numerical values can be traced to versioned source records; recalculations are deterministic and reviewed.
4. Access control and tenant isolation have passed independent security review.
5. Human review and corrections are available for extracted or editorial financial content.
6. Legal counsel has reviewed the actual product features, public claims, data arrangements and applicable SEC obligations.
7. Backups, restore procedure, monitoring, support process and incident response are in place.

## Decisions still needed

- Confirm coverage boundaries and the priority asset classes at launch.
- Confirm primary paying customer and launch business model.
- Choose licensed feed package(s), redistribution rights, permitted user tiers and budget.
- Choose hosting region, availability target and data retention rules.
- Confirm whether research is informational/editorial only and whether any future feature could be construed as investment advice.
- Select identity, email, payments and AI vendors after security, commercial and privacy review.
