<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Source of truth

`docs/blueprints/` is the product and architecture source of truth. Consult it before changing product scope, the data model or architecture; where it and the code disagree, the blueprints are authoritative.

- `docs/blueprints/SFI_ARCHITECTURE_V2.md` — current architecture, stack and **roadmap ordering**. It supersedes earlier ordering where they conflict.
- `docs/ARCHITECTURE_AND_DATA_MODEL.md` — how that lands in this codebase: modules, boundaries, data model, phase-by-phase scope.
- `docs/blueprints/BUSINESS_AND_FUTURE.md` — longer-range direction. Brainstorm, not approved scope.

## Where the build is

**Done:** foundation, 2a documents, 2b announcements, 2c editorial, 3a company profiles.

**Phase 3 order:** 3a profiles → **3b people and leadership** → 3c financial entry desk → 3d metrics and charts → 3e dividends and corporate actions. Then 4 IPO centre, 5 public front and accounts (entitlements, Paystack/Flutterwave), 6 pilot launch, 7 Python collectors, 8 AI analyst, 9 data API and market data, 10 scale.

Do not start a phase that has not been approved. Plan first, show the plan, then build.

## Binding rules

These are not preferences. Code that breaks one of them is wrong even if it passes.

1. **Data before AI.** AI is a layer over approved data, never a source of truth.
2. **Every figure has provenance:** source, document, page, period, units, retrieval time, licence status. A figure that cannot be traced is not publishable.
3. **Nothing is edited or deleted in place.** Corrections are new versions; withdrawals stay visible with a reason; audit logs are append-only.
4. **No fake data.** Empty states say "No data yet" honestly. Never seed plausible-looking figures, and never invent facts about a real company or person.
5. **Licences before display.** No NGX prices until a signed licence exists; no redistribution before authorised-vendor status.
6. **Flag, don't block.** Self-approval, self-publishing and self-review are allowed while the team is small, but recorded and visible, behind settings that enforce two-person review later. A switch, not a code change.
7. **Facts and opinion are always labelled:** reported data, calculated metrics, analyst opinion, guest opinion, AI-generated text.
8. **Approval is a human act.** An adapter, collector or model writes pending rows only — never an approved one.
9. **Security review every stage:** `/security-review`, `ecc:security-bounty-hunter`, `/code-review high`. Attack tests stay as permanent tests.

## Boundaries to build behind

- **Provider adapters.** Every outside service — data, OCR, LLM, email, payments — connects through one adapter holding its own credentials, licence metadata and kill switch. Never let a provider's shape reach pages or the domain.
- **Entitlements.** One layer decides what each tier may see and enforces licence limits. Arrives in Phase 5; until then, do not scatter tier checks through features.
- **Market data.** Prices sit behind a single interface so end-of-day can become real-time without touching pages.
- **AI.** Reads approved data only, cites every claim, cannot write to the core. No buy/sell/hold output until counsel clears it.

Keep the stack portable: standard Next.js, Postgres and Python, with Vercel used as a host only.

## Do not settle these in code

`docs/ARCHITECTURE_AND_DATA_MODEL.md` has the full list with what each blocks. Open questions include the first paying customer segment, how far the AI goes, pilot company list and history depth, who verifies figures, whether Growth Board segments are shown separately, and whether IR services are offered. Build around an open decision and say it is open; do not pick an answer and encode it.
