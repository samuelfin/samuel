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
| `lib/security/csp.ts` | Content Security Policy and the per-request nonce |
| `supabase/migrations/` | Database schema history |
| `scripts/scan-secrets.mjs` | Dependency-free secret scan, run by CI and `npm run check` |

## Security posture

- **Response headers.** A nonce-based Content Security Policy is set per request in `proxy.ts`; `script-src` carries no `'unsafe-inline'`, and `'strict-dynamic'` means every script Next.js renders is nonce-bound. This requires request rendering, which the terminal already does because each route checks the session. HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` and `Permissions-Policy` are set in `next.config.ts` so they also cover static assets.
- **Row-level security.** Deny by default on every table. Clients read only approved rows from datasets that are active, meaning licensed for display; licence terms and pipeline internals are platform-admin only; all writes go through `service_role`.
- **Document storage.** The `source-documents` bucket is private, and a restrictive policy excludes it from every client role, so licensed documents are reachable only through a short-lived signed URL minted server-side. Restrictive policies are ANDed with permissive ones, so a later well-meaning "let users read documents" policy cannot open it.
- **Supply chain.** CI fails on high or critical `npm audit` advisories and on any secret the scan recognises. Run both locally with `npm run check`.

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
