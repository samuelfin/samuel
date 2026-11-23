import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import {
  CoverageGrid,
  ReviewQueue,
  StatementForm,
  StatementPicker,
  SuccessionDesk,
  SuggestionQueue,
  TemplateAssignmentForm,
} from "@/components/admin/financials-desk";
import { requireStaffRole } from "@/lib/auth/staff";
import { listCompaniesForDesk } from "@/lib/data/companies";
import {
  assignmentFor,
  coverageGrid,
  getStatementForDesk,
  listCitableAnnouncements,
  listCitableFilings,
  listStatementsForDesk,
  listSuccessionsForDesk,
  listSuggestionBatchesForDesk,
  listTemplateAssignments,
  listTemplateLines,
  listTemplates,
} from "@/lib/data/financials";
import { STATEMENT_TYPES, type StatementType } from "@/lib/financials/validation";
import { availableExtractors } from "@/lib/adapters/extraction";

export const metadata: Metadata = { title: "Figures" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** FY2021–FY2025, the pilot universe's five years. */
const COVERAGE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

function isStatementType(value: string | undefined): value is StatementType {
  return typeof value === "string" && (STATEMENT_TYPES as readonly string[]).includes(value);
}

export default async function FiguresDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; statement?: string; period?: string }>;
}) {
  const staff = await requireStaffRole(["financial_analyst"]);
  const params = await searchParams;

  // `statement` carries either a statement id to revise or a statement type to
  // enter. One parameter for both keeps the links short, and the two shapes
  // cannot be confused: one is a uuid.
  const revisingId = params.statement && UUID.test(params.statement) ? params.statement : undefined;
  const companyId = params.company && UUID.test(params.company) ? params.company : "";
  const periodEnd = params.period ?? "";

  const [
    statements,
    templates,
    templateLines,
    assignments,
    companies,
    filings,
    announcements,
    successions,
    suggestionBatches,
  ] =
    await Promise.all([
      listStatementsForDesk(),
      listTemplates(),
      listTemplateLines(),
      listTemplateAssignments(),
      listCompaniesForDesk(),
      listCitableFilings(),
      listCitableAnnouncements(),
      listSuccessionsForDesk(),
      listSuggestionBatchesForDesk(),
    ]);

  const revising = revisingId ? await getStatementForDesk(revisingId) : null;

  const statementType: StatementType = revising
    ? revising.statementType
    : isStatementType(params.statement)
      ? params.statement
      : "income";

  const formCompanyId = revising ? revising.companyId : companyId;
  const formPeriodEnd = revising ? revising.periodEnd : periodEnd;

  const assignment = formCompanyId
    ? assignmentFor(assignments, formCompanyId, formPeriodEnd || "9999-12-31")
    : null;

  // The figures the form may carry: the core set plus the company's sector set
  // for that period. Read here, and read again in the action — a form's hidden
  // fields are a suggestion, not an authority.
  const definitions = templateLines.filter(
    (line) =>
      line.statementType === statementType &&
      (line.templateId === "core" || (assignment !== null && line.templateId === assignment.templateId)),
  );

  const existing = statements.find(
    (s) =>
      s.companyId === formCompanyId &&
      s.statementType === statementType &&
      s.periodEnd === formPeriodEnd &&
      s.reviewStatus !== "superseded",
  );

  const cells = coverageGrid(
    statements,
    companies.map((c) => ({ id: c.id, name: c.name })),
    COVERAGE_YEARS,
    [statementType],
  );

  const waiting = statements.filter((s) => s.reviewStatus === "pending");
  const selfChecked = statements.filter((s) => s.reviewSelfApproved && s.reviewStatus === "approved");
  const aiAssisted = statements.filter((s) => s.aiAssisted);

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            S<span>•</span>
          </span>
          <span className="brand-copy">
            <strong>SAMUEL</strong>
            <small>FINANCIAL INTELLIGENCE</small>
          </span>
        </Link>
        <div className="admin-context">
          SFI PLATFORM <span>DESK</span>
        </div>
        <div className="admin-nav-label">RESEARCH DESK</div>
        <Link className="admin-nav" href="/admin/companies">
          <i>▢</i> Companies
        </Link>
        <Link className="admin-nav" href="/admin/people">
          <i>☰</i> Leadership
        </Link>
        <Link className="admin-nav active" href="/admin/financials">
          <i>₦</i> Figures
        </Link>
        <Link className="admin-nav" href="/admin/documents">
          <i>▤</i> Document review
        </Link>
        <Link className="admin-nav" href="/admin/announcements">
          <i>◈</i> Announcements
        </Link>
        <Link className="admin-nav" href="/admin/editorial">
          <i>✎</i> Research
        </Link>
        {staff.isPlatformAdmin ? (
          <Link className="admin-nav" href="/admin">
            <i>▦</i> Administration
          </Link>
        ) : null}
        <Link className="admin-nav" href="/companies">
          <i>▣</i> Company directory
        </Link>
        <div className="admin-sidebar-foot">
          <span className="secure-indicator" /> STAFF SESSION ACTIVE
          <br />
          <small>Roles are verified server-side on every action.</small>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <span>Samuel Terminal</span>
            <b>/</b>
            <strong>Figures</strong>
          </div>
          <div className="admin-user">
            <span className="admin-avatar">{staff.name.slice(0, 1).toUpperCase()}</span>
            <span>{staff.name}</span>
            <form action={signOut}>
              <button>Sign out</button>
            </form>
          </div>
        </header>

        <div className="admin-content">
          <div className="admin-title-row">
            <div>
              <div className="admin-eyebrow">FINANCIALS · SFI</div>
              <h1>
                Figures<span>.</span>
              </h1>
              <p>
                Statements as the filings report them. Every figure carries the page it came from, the
                scale it was printed in, and the figure we standardised it to — and nothing is
                converted between currencies here, because a conversion is a calculation with a source
                of its own.
              </p>
            </div>
            <span className="admin-role-pill">
              {staff.roles.length ? staff.roles.join(" · ").toUpperCase() : "PLATFORM ADMIN"}
            </span>
          </div>

          <div className="admin-panels">
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>CHOOSE</span>
                  <h2>What to enter</h2>
                </div>
                {revising ? (
                  <Link className="correct-link" href="/admin/financials">
                    Enter something else
                  </Link>
                ) : null}
              </div>
              <StatementPicker
                companies={companies}
                companyId={formCompanyId}
                statementType={statementType}
                periodEnd={formPeriodEnd}
              />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>{revising ? "REVISE" : "ENTER"}</span>
                  <h2>
                    {revising
                      ? `${revising.companyName} — ${revising.periodType} to ${revising.periodEnd}`
                      : "A statement"}
                  </h2>
                </div>
                <span className="admin-count">{statements.length} ENTERED</span>
              </div>
              {revising ? (
                <p className="form-note">
                  Figures are never edited in place. This records a new version of the same period, and
                  asks whether the issuer restated them or we are correcting our own entry.
                </p>
              ) : null}
              {/* Keyed to the subject, so switching between two periods remounts
                  the form rather than carrying the first one's figures into the
                  second — the stale-state defect found at stage 2c. */}
              <StatementForm
                key={`${revising?.id ?? "new"}-${formCompanyId}-${statementType}-${formPeriodEnd}`}
                companies={companies}
                sources={filings}
                definitions={definitions}
                assignment={assignment}
                statementType={statementType}
                companyId={formCompanyId}
                periodEnd={formPeriodEnd}
                existing={revising ? undefined : existing}
                supersedes={revising ?? undefined}
              />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>CHECK</span>
                  <h2>Waiting to be checked</h2>
                </div>
                <span className="admin-count">{waiting.length} WAITING</span>
              </div>
              <p className="form-note">
                A second pair of eyes against the page. Entering and checking are the same role while
                the team is this small, so a statement checked by whoever entered it is recorded as
                self-checked rather than refused — a switch, not a code change.
              </p>
              <ReviewQueue statements={statements} />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>COVERAGE</span>
                  <h2>What is done, and what is not</h2>
                </div>
                <span className="admin-count">FY2021–FY2025</span>
              </div>
              <CoverageGrid cells={cells} years={COVERAGE_YEARS} statementType={statementType} />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>SUGGESTED</span>
                  <h2>Figures a machine proposed</h2>
                </div>
                <span className="admin-count">
                  {suggestionBatches.filter((b) => b.status === "open").length} OPEN
                </span>
              </div>
              <p className="form-note">
                A suggestion is not a figure. Each one is confirmed against the page, one at a time —
                there is no accept-all, because a button that accepts forty unexamined figures is this
                feature&apos;s whole risk in one control. Anything accepted still goes in through the
                entry form, flagged AI-assisted for the life of the record. No model is wired up: the
                only reader is pasted text, behind the adapter every outside service goes through.
              </p>
              <SuggestionQueue
                batches={suggestionBatches}
                companies={companies}
                filings={filings}
                extractors={availableExtractors().map((e) => ({ id: e.id, label: e.label, model: e.model }))}
                companyId={formCompanyId}
                statementType={statementType}
                periodEnd={formPeriodEnd}
              />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>PREDECESSORS</span>
                  <h2>History that belongs to a different entity</h2>
                </div>
                <span className="admin-count">{successions.length} LINKS</span>
              </div>
              <p className="form-note">
                Access Holdings was established in 2022 and the figures before it belong to Access
                Bank; BUA Foods listed in 2022, Aradel in 2024. The two sets of figures are linked and
                kept apart — splicing them into one series would publish a continuity that does not
                exist.
              </p>
              <SuccessionDesk
                companies={companies}
                filings={filings}
                announcements={announcements}
                successions={successions}
              />
            </section>

            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <span>TEMPLATES</span>
                  <h2>Which figures each company is held to</h2>
                </div>
                <span className="admin-count">{templates.length} TEMPLATES</span>
              </div>
              <TemplateAssignmentForm companies={companies} templates={templates} assignments={assignments} />
            </section>

            {selfChecked.length > 0 || aiAssisted.length > 0 ? (
              <section className="admin-panel">
                <div className="admin-panel-heading">
                  <div>
                    <span>FLAGGED</span>
                    <h2>Worth another look</h2>
                  </div>
                </div>
                {selfChecked.length > 0 ? (
                  <>
                    <h3>Checked by whoever entered them</h3>
                    <ul className="plain-list">
                      {selfChecked.map((statement) => (
                        <li key={statement.id}>
                          <Link href={`/admin/financials?statement=${statement.id}`}>
                            {statement.companyName} — {statement.periodType} to {statement.periodEnd}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {aiAssisted.length > 0 ? (
                  <>
                    <h3>Containing AI-suggested figures</h3>
                    <ul className="plain-list">
                      {aiAssisted.map((statement) => (
                        <li key={statement.id}>
                          <Link href={`/admin/financials?statement=${statement.id}`}>
                            {statement.companyName} — {statement.periodType} to {statement.periodEnd}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
