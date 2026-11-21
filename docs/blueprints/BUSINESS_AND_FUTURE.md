# Business and Future Directions

> **Status: brainstorm, not decided.** Nothing here is approved scope, a
> commitment or a price. It exists so that the things we may want later do not
> require a redesign when we want them — and so that the decisions each one
> depends on are visible before anyone builds toward it.
>
> The approved scope and build order remain `SFI_ARCHITECTURE_V2.md`,
> `Nigeria_Financial_Intelligence_Platform_Blueprint.md`,
> `Samuel_Financial_Intelligence_Project_Overview.md` and
> `../ARCHITECTURE_AND_DATA_MODEL.md`. Where this file and those disagree, those
> win. Each section below ends with **Hook** — the smallest thing the current
> design should hold open — and **Decide first**, the question that blocks it.

---

## 1. Revenue streams

Six candidates, in order of how little they depend on anyone else's permission.
That is not the same as order of size.

| Stream | What it sells | Depends on |
| --- | --- | --- |
| **Terminal seats** | Named access for a firm's analysts, billed per seat, with team workspaces | Nothing external. Needs `subscriptions`, `entitlements`, seat counting |
| **Premium subscriptions** | Depth for individuals: full financial history, exports, alerts, screening, AI research | Nothing external, beyond what we publish ourselves |
| **IR services** | Work sold *to issuers*: a maintained profile, a filings page, investor-facing reporting | A hard editorial firewall (§6) |
| **Sponsored video and events** | Labelled sponsorship of explainers, interviews, briefings and live events | Disclosure rules; the sponsor must not touch editorial |
| **Fintech data API** | Programmatic access for banks, brokers, apps and other builders | **Redistribution** licences, not display licences (§3) |
| **Indices** | SFI-calculated indices, published and possibly licensed | Price data under a licence permitting derived works; a published methodology |

Three observations are worth more than the table.

**The streams that need nobody's permission are the ones built on our own work.**
Editorial, analyst-entered financial history and computed metrics are things SFI
makes. Seats and subscriptions sell those. Every stream that sells *market* data —
the API at full strength, and indices — is gated on a licence we do not hold, and
no amount of engineering removes that gate.

**IR services are the one stream that can damage the product.** Being paid by an
issuer whose figures we also publish is the clearest conflict on this list. It is
not disqualifying — several credible data businesses are funded this way — but it
survives only if the firewall is real and visible: separate staff, no client or
sponsor sight of unpublished editorial, and a disclosure on every page about a
paying issuer. The platform already separates roles and records who did what, so
the mechanism exists. The policy is the part that has to be decided and written
down before the first naira is taken.

**Indices are a heavier commitment than they look.** An index anyone trades
against carries a governance obligation: a frozen methodology, a stated review
calendar, a record of every constituent change, and a position on what happens
when a constituent is suspended mid-period. Worth doing eventually; worth not
starting casually.

> **Hook.** `subscription_plans`, `subscriptions`, `entitlements`, `api_keys` and
> `usage_records` are already named in the architecture's core model and are not
> yet built. Keep them as the single place entitlement is decided, so no feature
> grows its own private notion of "is this user allowed".
>
> **Decide first.** Whether IR services are in scope at all — because if they
> are, the firewall has to be designed before the first client, not after.

---

## 2. External provider adapters

**One rule: everything outside SFI enters through an adapter, and SFI owns the
core data.**

That covers more than market-data feeds. A price provider, a news wire, an
exchange file, an OCR service, an LLM provider, an email sender, a payment
processor — each is a replaceable component behind an interface we define, never a
type that spreads through the codebase.

What this buys is the ability to lose a supplier without losing the product. A
provider that changes its schema, raises its price, withdraws a licence or simply
fails is then a change in one directory. The alternative — provider shapes
reaching the domain, the pages and the database — is how a data business ends up
unable to leave a vendor it no longer wants.

The architecture already states the interface: `fetch(cursor, window)`,
`normalize(record)`, `validate(record)`, `rights(product, use)`. Three properties
matter as much as the shape:

- **Provenance survives normalization.** The original payload, the provider's own
  identifier, the retrieval time and the source URI are kept. A figure that
  cannot be traced to where it came from is not publishable, and we would rather
  learn that at ingestion than at correction time.
- **Rights travel with the data.** `rights(product, use)` is not decoration. It is
  what lets a reader see a figure we may display while an API consumer does not
  receive it — the same row, two different permissions (§3).
- **An adapter never writes an approved row.** It writes pending work; approval is
  a human act, recorded. This already holds for document upload, and it is the
  property that must not be relaxed when automated collectors arrive.

**AI providers are adapters too, with two extra constraints:** an AI adapter reads
only approved data, and every claim it returns carries a citation. It has no
privileged path to the database and no ability to publish. Phase 8 (§5) is built
on that boundary rather than negotiating with it.

> **Hook.** Keep the provider registry (`data_providers`, `data_licences`,
> `datasets`) as the place a supplier is configured and its terms recorded, and
> extend it to non-market suppliers — AI, extraction, email — rather than letting
> those arrive as bare environment variables and direct calls.
>
> **Decide first.** Nothing. This is a discipline to hold, not a decision to make.

---

## 3. A public data API

A keyed, metered API over the same approved data the terminal reads. Same rows,
same citations, same review state — a different door.

The shape is not the hard part: API keys scoped to an organisation and a plan,
per-key rate limits, usage recorded per request for both billing and abuse
detection, versioned endpoints returning typed domain records rather than provider
payloads.

**The hard part is rights.** Showing a figure to a signed-in reader and handing
that figure to a third party who will put it in their own product are different
permissions, usually priced differently, and sometimes one is granted while the
other is refused. An API built without that distinction in the data model will
either leak licensed data into someone else's product — a contract breach, and the
fastest way to lose a licence — or be unable to serve anything at all.

So the API is really two products, and separating them early is what makes it
buildable:

1. **What SFI owns.** Company profiles, our editorial, analyst-entered financial
   history compiled from public filings, computed metrics, our indices. We can
   license these on our own terms. This part can ship with no provider agreement
   at all, and is probably where the first paying API customer comes from.
2. **What SFI licenses in.** Prices, exchange statistics, third-party series. Each
   row is served only where its licence permits redistribution, decided by
   `rights(product, use)` at request time and never by a hand-maintained list of
   what is safe to return.

> **Hook.** `api_keys` and `usage_records` already appear in the core model. Two
> properties to preserve from now on: every readable row resolves to a licence,
> and display rights and redistribution rights are recorded **separately** on
> `data_licences`. Collapsing them into one flag is the mistake that is expensive
> to undo.
>
> **Decide first.** Whether analyst-compiled financial history — our own
> structured record of figures taken from public annual reports — is ours to
> license. The figures are public facts; the compilation is our work. That
> distinction is a legal question, not an engineering one, and the API's most
> valuable product depends on the answer.

---

## 4. People: executives and board members

> **Now scheduled: Phase 3b**, directly after company profiles and before the
> financial entry desk — see `SFI_ARCHITECTURE_V2.md` §6. The leadership record
> and its tenure facts land there; the performance panel described below fills as
> Phases 3c and 3d deliver figures and metrics.

Named individuals linked to companies, each with a role and tenure dates, so that
"who ran this company while these results happened" becomes a fact we hold rather
than something a reader has to assemble.

What it unlocks is real. Tenure dates intersected with financial periods give
revenue, margin and ROE over a named person's time in post, across every company
they have run — a CEO performance profile built from figures rather than
reputation. Board overlap becomes visible: who sits on which boards together.
Appointment and resignation announcements gain a subject instead of being loose
text. None of that is available from any Nigerian source we know of, and it is the
kind of thing a terminal gets bought for.

The shape follows patterns the schema already uses:

- `people` — the individual, with identity kept deliberately thin.
- `company_roles` — person, company, role, `valid_from`, `valid_to`: exactly the
  effective-dated pattern `company_identifiers` uses today, so an executive who
  returns gets a second row rather than an edited one.
- Both versioned and reviewed like `companies`, with every role citing the
  document or announcement that evidences it.

**Three things make this harder than it looks, and none of them is technical.**

*It is personal data about real people.* The Nigeria Data Protection Act applies.
Role and tenure taken from a company's own filings and announcements is about the
safest category of personal data there is — published by the subject's own
employer, for exactly this purpose — but it is still personal data, carrying
obligations around accuracy, retention and correction. Anything beyond role and
tenure (age, education, pay, directorships we inferred rather than read) raises
the stakes, and should be decided deliberately rather than added because a column
was free.

*A performance profile is a claim about a named person.* "Revenue fell 40% under
this CEO" is a reputational statement. It needs the same citation discipline as
every other published figure, plus something editorial we have not needed so far:
a correction path and, plausibly, a right of reply. Attributing a company's
results to an individual is also analytically weak on its own — a tenure overlaps
a currency devaluation, a commodity cycle, a predecessor's decisions. The figures
belong on the page as what they are, dated and sourced, not as a verdict.

*Identity resolution is genuinely difficult.* Nigerian filings spell names
inconsistently, titles and honorifics come and go, and two different people share
a name more often than you would like. Merging two records that turn out to be
different people is worse than leaving them apart. That argues for the same
maker-checker treatment as financial figures, not for automatic matching.

> **Hook.** Keep `valid_from`/`valid_to` effective dating as the standard way any
> company relationship is dated — identifiers do this now, roles would do it too —
> and keep financial periods queryable by date range, so a tenure can intersect
> them without new machinery.
>
> **Decide first.** Which fields we hold beyond name, role and tenure; whether we
> publish performance profiles attributing results to individuals at all; and if
> so, what the correction and reply path is.

---

## 5. The AI layer (Phase 8)

Three parts, deliberately separate, because they fail in different ways:

1. **A general model**, reached through an adapter like any other provider (§2),
   for language — explaining, summarising, rephrasing.
2. **Retrieval over our own approved data**, which is where every fact comes from.
   Approved rows and approved documents only. Every claim carries a citation the
   reader can follow to a filing and a page.
3. **Python analytics** for anything numeric. Ratios, growth, comparisons and
   screens are computed deterministically with a recorded formula version — the
   discipline already settled for computed metrics. A language model does not do
   arithmetic a reader will act on.

The division is the whole design. The model supplies language, retrieval supplies
facts, Python supplies numbers. Where the three are blurred you get a system that
states a confident figure nobody can trace, which is the one failure this platform
cannot absorb.

**No buy, sell or hold output until legal review.** Not as a setting, not behind a
flag, not as a disclaimer on a page that says it anyway. The boundary between
financial information and regulated investment advice is a question for a Nigerian
securities lawyer, and the answer shapes what Phase 8 may say. Until it is
answered, the AI explains what the figures are and where they came from, and stops
there.

Worth noting what this is *not*: a chatbot with database access. It is a retrieval
and calculation system that uses a model for presentation. That distinction is
also what makes evaluation possible — `ai_runs` and `ai_citations` exist so an
answer can be checked after the fact against the evidence it claimed.

> **Hook.** `ai_conversations`, `ai_messages`, `ai_citations` and `ai_runs` are
> already in the core model, including model and prompt version. The hook that
> matters is upstream of all of them: **every published figure already resolves to
> a document and a page.** Phases 3c and 3d build that for financial history. If it
> holds, retrieval with citations is a query; if it does not, no amount of prompt
> engineering repairs it.
>
> **Decide first.** Legal review of the advice boundary — before Phase 8 is
> scoped, not before it ships.

---

## 6. What cuts across all of it

Five properties every section above assumes. They are cheap to keep and expensive
to retrofit.

1. **Provenance is not optional.** Every figure resolves to a document and a page;
   every row to a source and a licence. This is the asset. The API, the AI layer
   and the people data are all ways of selling or presenting it, and each is
   worthless without it.
2. **Rights are data, not policy documents.** What may be displayed, exported,
   redistributed or fed to a model is recorded per licence and enforced at query
   time.
3. **Approval is a human act, and it is recorded.** No adapter, collector or model
   writes an approved row. Self-approval is flagged rather than forbidden; the
   switch to requiring a second person is a setting.
4. **Money never touches editorial.** Whatever is sold — seats, IR work,
   sponsorship — the figures and the writing are produced by people with no sight
   of who is paying, and anything sponsored is labelled where it is read.
5. **Entitlement is decided in one place.** Plans, subscriptions and entitlements
   answer "may this user see this", for the terminal and the API alike.

---

## Open questions, collected

For the CEO:

- Are IR services in scope? If yes, the editorial firewall is a policy decision
  needed before the first client.
- Which revenue stream are we building toward first? Seats and subscriptions need
  no external permission; the API at full strength and indices do.
- Do we publish performance profiles attributing company results to named
  individuals?

For the financial lead:

- Index methodology, if indices are wanted: constituent rules, review calendar,
  treatment of a constituent suspended mid-period.
- Which executive and board fields are worth holding beyond name, role and tenure.

For legal review:

- Is analyst-compiled financial history, drawn from public filings, ours to
  license through an API?
- Where is the line between financial information and regulated investment advice,
  for Phase 8?
- NDPA obligations for holding and publishing executive role and tenure data, and
  what correction or reply path a performance profile requires.
