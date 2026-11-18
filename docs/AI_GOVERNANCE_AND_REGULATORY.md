# AI, Governance and Regulatory Dependencies

## AI architecture and answer contract

The assistant should retrieve approved records from the platform first. Provider documents and data observations are indexed only if their licence and privacy classification permits this processing. Retrieval returns source IDs, exact reporting periods, publication times and page/section references.

Numeric transformations use deterministic, versioned backend functions. The language model can explain validated outputs, but cannot invent or silently recompute them. Each response contains answer text, evidence references, calculation/method identifiers, freshness labels and an uncertainty state. If the retrieved evidence does not cover the question, the system must abstain and state what is missing.

### Proposed flow

1. Authenticate user and check role, tenant, entitlement and data rights.
2. Classify request as retrieval, calculation, comparison, document question or unsupported/advice-like request.
3. Retrieve only records the user may access; filter by approved status and compatible period.
4. Run calculation service for requested metrics with decimal arithmetic and explicit formulas.
5. Generate a structured response from the evidence bundle, requiring citations for material factual claims.
6. Validate citations resolve, facts map to evidence, periods match and no unsupported recommendation language is present.
7. Persist model/provider version, prompt version, evidence IDs, output, user feedback and cost metadata under retention policy.

## Controls

- Label generated interpretation separately from issuer-reported facts.
- Preserve source page/table coordinates for document-derived values.
- Require human approval before extracted values enter authoritative company financials.
- Detect stale feeds; refuse “today/current” answers from expired observations.
- Avoid cross-period ratios unless the metric definition explicitly supports the comparison.
- Run a finance-specific evaluation set covering citation correctness, period alignment, arithmetic, stale data, abstention and prompt injection in uploaded documents.
- Treat retrieved web/document text as untrusted input; it cannot override system policy or trigger tools/actions.
- No autonomous account, trade, payment or publication actions from model output.
- Enforce provider license restrictions on embedding, model processing, caching and retention.

## Regulatory/legal workstream

The brief references the Investments and Securities Act 2025. The SEC-hosted Act is in force from 25 March 2025 according to the published text. SEC materials also state that only SEC-registered entities may promote investment services, provide investment advisory services or solicit funds in the Nigerian capital market. The exact legal treatment depends on actual features, marketing, data distribution and revenue model; obtain Nigerian counsel's opinion before public launch. This document is an engineering dependency list, not legal advice.

Counsel should review:

- Whether each form of company analysis, screening, ranking, alert and AI response remains informational or becomes regulated investment advisory/promotion.
- Market-data provider and redistribution agreements, including display to free/paid users and use in derived metrics/AI retrieval.
- SFI research governance, conflicts, sponsored content and analyst-review disclosures.
- User terms, privacy, security, retention, complaint handling and institutional confidentiality.
- Subscription/payment structure and any future API distribution.
- Current SEC Act, consolidated rules, directives and relevant CBN/NITDA/data-protection requirements as applicable.

## Product safeguards for initial release

- No portfolio recommendations, suitability profiling, personalized buy/sell/hold calls or order routing.
- Separate source facts, deterministic analytics and SFI/AI commentary in UI and exports.
- Attach citations and “as of” dates to material facts; disclose delayed/end-of-day data near the value.
- Apply editorial review and change history to published research.
- Add report footer with source list, period, generation/review state and applicable disclosure.
- Keep complaints and correction workflow auditable.

## Primary references

- Investments and Securities Act 2025 (SEC PDF): https://sec.gov.ng/documents/1326/INVESTMENT-AND-SECURITIES-ACT-NIGERIA-2025_1.pdf
- SEC Acts and Rules: https://sec.gov.ng/our-mandate/regulation/acts/
- SEC public notice on unregistered online investment schemes and services: https://sec.gov.ng/for-investors/keep-track-of-circulars/public-notice-unregistered-online-investment-schemes/
