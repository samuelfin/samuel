# Samuel Terminal

**Samuel Financial Intelligence (SFI)**  
AI-powered Nigerian financial market intelligence, analytics and research.

The first release is scoped to Nigerian equities, fixed income and macroeconomic data for individual and institutional users. Data access, redistribution rights, prices and live integrations are release gates; sample or stale values must never be presented as live.

## Current state

- **Phase 0 (product definition):** complete — see the documents below.
- **Phase 1 (foundation):** dark terminal design system, persistent shell with module navigation and command bar, a route per module, Supabase authentication with server-side session checks, platform-admin controls, audit log, typed data layer and provider registry, unit tests and CI.
- **Not yet connected:** no licensed feeds, production data, payment provider or AI provider. Every data panel shows an explicit "No source connected" state naming the planned source and its licensing gate. The terminal does not claim to provide live market data or financial analysis.

An SFI-owned Supabase project and credentials must be configured before sign-in works (see [Phase 1 setup](docs/PHASE_1_SETUP.md)).

## Local development

```bash
npm ci
npm run dev        # http://localhost:3000
npm run check      # lint + typecheck + unit tests
npm run build
```

Without `.env.local`, `npm run dev` opens the terminal in **local preview** mode (no sign-in, clearly labelled, development only) so the interface can be worked on before Supabase exists. Production builds never allow this. On this Windows setup, prefix installs with `$env:NODE_USE_SYSTEM_CA = '1'` if npm reports a certificate-chain error.

## Project structure

| Path | Purpose |
| --- | --- |
| `app/(terminal)/` | Terminal routes: `/`, `/markets`, `/equities`, `/companies`, `/companies/[symbol]`, `/economy`, `/fixed-income`, `/news`, `/research`, `/ai`, `/watchlists`, `/alerts`, `/reports` |
| `app/admin/`, `app/login/`, `app/auth/` | Administration, sign-in and auth callback |
| `components/terminal/` | Shell, navigation, command bar and UI primitives (panels, tables, status badges, unavailable states) |
| `lib/market-data/` | Data contracts: decimal-string values with status, as-of time, unit and provenance; freshness policy |
| `lib/providers/registry.ts` | Provider registry, dataset→provider map, rights status and adapter interface |
| `lib/data/` | Server-only data services used by pages; each verifies the session |
| `lib/catalog/` | Reference metadata only (modules, indicators, indices, sectors, rate concepts, ratio definitions) — no values |
| `lib/auth/session.ts` | Session data-access layer (`requireUser`, `getSessionUser`) |
| `supabase/migrations/` | Database schema history |

## Product and engineering documents

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [System architecture and data model](docs/ARCHITECTURE_AND_DATA_MODEL.md)
- [Data provider assessment](docs/DATA_PROVIDER_ASSESSMENT.md)
- [AI, governance and regulatory dependencies](docs/AI_GOVERNANCE_AND_REGULATORY.md)
- [User journeys and interface](docs/USER_JOURNEYS_AND_INTERFACE.md)
- [Roadmap and initial cost model](docs/ROADMAP_AND_COST_MODEL.md)
- [Phase 1 setup guide](docs/PHASE_1_SETUP.md)

## Product identity

**Samuel Terminal — Clarity on Markets. Intelligence for Capital.**
