# Samuel Terminal

**Samuel Financial Intelligence (SFI)**  
AI-powered Nigerian financial market intelligence, analytics and research.

The workspace contains Phase 0 product and technical definition plus the Phase 1 application foundation. The first release is scoped to Nigerian equities, fixed income and macroeconomic data for individual and institutional users. Data access, redistribution rights, prices and live integrations are release gates; sample or stale values must never be presented as live.

## Product and engineering documents

- [Product requirements](docs/PRODUCT_REQUIREMENTS.md)
- [System architecture and data model](docs/ARCHITECTURE_AND_DATA_MODEL.md)
- [Data provider assessment](docs/DATA_PROVIDER_ASSESSMENT.md)
- [AI, governance and regulatory dependencies](docs/AI_GOVERNANCE_AND_REGULATORY.md)
- [Roadmap and initial cost model](docs/ROADMAP_AND_COST_MODEL.md)
- [Phase 1 setup guide](docs/PHASE_1_SETUP.md)

## Current state

Authentication and route/role gates are implemented against Supabase, but an SFI-owned Supabase project and credentials must be configured before sign-in works. No licensed feeds, production data, regulatory sign-off, payment provider or AI provider have been configured. This repository does not claim to provide live market data or production financial analysis.

## Product identity

**Samuel Terminal — Clarity on Markets. Intelligence for Capital.**
