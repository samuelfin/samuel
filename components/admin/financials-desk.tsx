"use client";

import { useActionState, useMemo, useState } from "react";
import {
  assignTemplateAction,
  closeBatchAction,
  decideSuggestionAction,
  queueSuggestionsAction,
  recordSuccessionAction,
  reviewStatementAction,
  reviewSuccessionAction,
  saveStatementAction,
  type FinancialsActionState,
} from "@/app/admin/financials/actions";
// Values come from the pure validation module: this is a client component, and
// lib/data/financials is server-only. The shapes below are type-only imports,
// erased at compile time, so they never pull that module into the bundle.
import {
  MAGNITUDES,
  MAGNITUDE_LABELS,
  PERIOD_TYPES,
  RESTATEMENT_KINDS,
  RESTATEMENT_LABELS,
  STATEMENT_TYPES,
  SUCCESSION_LABELS,
  SUCCESSION_RELATIONSHIPS,
  STATEMENT_TYPE_LABELS,
  type Magnitude,
  type RestatementKind,
  type StatementType,
  type SuccessionRelationship,
  footingWarnings,
  formatReported,
  formatSourceDate,
  magnitudeAllowed,
  magnitudeApplies,
  parseFigure,
  parsePeriod,
  standardisePreview,
  validateLine,
} from "@/lib/financials/validation";
import type {
  CitableFiling,
  CompanyTemplateAssignment,
  CoverageCell,
  StatementForDesk,
  SuccessionForDesk,
  SuggestionBatch,
  TemplateLine,
  TemplateSummary,
} from "@/lib/data/financials";
import type { CompanyForDesk } from "@/lib/data/companies";

const EMPTY: FinancialsActionState = {};

function Message({ state }: { state: FinancialsActionState }) {
  if (state.error)
    return (
      <p className="auth-message" role="alert">
        {state.error}
      </p>
    );
  if (state.notice)
    return (
      <p className="auth-message" role="status">
        {state.notice}
      </p>
    );
  return null;
}

/** A figure as it will be stored, shown beside what was typed. */
function Preview({
  raw,
  magnitude,
  lineMagnitude,
  definition,
}: {
  raw: string;
  magnitude: Magnitude;
  /** The analyst's own override for this line, where they have set one. */
  lineMagnitude: Magnitude | "";
  definition: TemplateLine;
}) {
  const figure = parseFigure(raw);
  if (!figure) {
    return raw.trim() ? <small className="form-warning">Not a figure yet</small> : null;
  }
  // The override is read, not recomputed. An earlier version derived the scale
  // from the unit kind alone and so ignored what the analyst had chosen, which
  // left the preview showing one figure while another was stored — and the
  // preview is the one place that mistake would be caught.
  const effective: Magnitude = lineMagnitude || (magnitudeApplies(definition.unitKind) ? magnitude : "units");
  const standardised = standardisePreview({
    value: figure.value,
    presentation: figure.presentation,
    magnitude: effective,
    standardSign: definition.standardSign,
  });
  if (standardised === null) {
    return <small className="form-warning">Cannot be negative</small>;
  }
  return (
    <small>
      Stored as {standardised.toLocaleString("en-NG", { maximumFractionDigits: 4 })}
      {definition.unitLabel && definition.unitLabel !== "currency" ? ` ${definition.unitLabel}` : ""}
      {figure.presentation === "bracketed" ? " (read as negative)" : ""}
    </small>
  );
}

export function StatementForm({
  companies,
  sources,
  definitions,
  assignment,
  statementType,
  companyId,
  periodEnd,
  existing,
  supersedes,
}: {
  companies: readonly CompanyForDesk[];
  sources: readonly CitableFiling[];
  definitions: readonly TemplateLine[];
  assignment: CompanyTemplateAssignment | null;
  statementType: StatementType;
  companyId: string;
  periodEnd: string;
  existing?: StatementForDesk;
  supersedes?: StatementForDesk;
}) {
  const [state, action, pending] = useActionState(saveStatementAction, EMPTY);
  const [magnitude, setMagnitude] = useState<Magnitude>(supersedes?.magnitude ?? "thousands");
  // The per-line scale an analyst has chosen, held here rather than left to the
  // DOM so the preview can read the same value the form will post.
  //
  // Seeded from the statement being revised, for the same reason the figures
  // and the statement-level scale are: a count entered as "31.4 billions" came
  // back into an unseeded form as a bare 31.4 and would have been re-stored as
  // 31.4 — a correction that silently changed a figure nobody meant to touch.
  // Only a line whose own scale was recorded is seeded; money inherits the
  // statement's heading, so leaving those blank is what keeps them inheriting.
  const [lineScales, setLineScales] = useState<Record<string, Magnitude | "">>(() => {
    const seeded: Record<string, Magnitude | ""> = {};
    for (const line of supersedes?.lines ?? []) {
      if (!magnitudeApplies(line.unitKind) && line.reportedMagnitude !== "units") {
        seeded[line.lineItem] = line.reportedMagnitude;
      }
    }
    return seeded;
  });
  const [figures, setFigures] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const line of supersedes?.lines ?? []) {
      seeded[line.lineItem] =
        line.reportedPresentation === "bracketed" ? `(${line.valueReported})` : String(line.valueReported);
    }
    return seeded;
  });

  const company = companies.find((c) => c.id === companyId);
  const required = definitions.filter((line) => line.isRequired);

  /**
   * The same checks the reviewer will see, shown while typing. Warnings, never
   * blocks: a reported balance sheet that does not foot is still what the filing
   * says, and a form that refused it would make the analyst type something else.
   */
  const warnings = useMemo(() => {
    const prepared = definitions.flatMap((definition) => {
      const raw = figures[definition.lineItem] ?? "";
      if (!raw.trim()) return [];
      const line = validateLine({ lineItem: definition.lineItem, raw, sourcePage: "1" }, definition, magnitude);
      return line.ok ? [line.value] : [];
    });
    return footingWarnings(statementType, prepared);
  }, [definitions, figures, magnitude, statementType]);

  if (!companyId) {
    return <p className="empty-state">Choose a company and a period to enter figures.</p>;
  }

  if (definitions.length === 0) {
    return (
      <p className="empty-state">
        No figures are defined for the {STATEMENT_TYPE_LABELS[statementType].toLowerCase()} under this
        company&apos;s template. Assign a sector template below, or choose another statement.
      </p>
    );
  }

  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="companySlug" value={company?.slug ?? ""} />
      <input type="hidden" name="statementType" value={statementType} />
      {supersedes ? <input type="hidden" name="supersedesId" value={supersedes.id} /> : null}

      <p className="form-note">
        {company ? company.name : "This company"} is entered under{" "}
        <strong>{assignment ? assignment.templateName : "the core template only"}</strong>
        {assignment ? ` from ${assignment.validFrom}` : ""}. Figures are stored exactly as the filing
        reports them, in its own currency and scale. Nothing is converted here.
      </p>

      <div className="form-row">
        <label>
          Reporting date
          <input type="date" name="periodEnd" required defaultValue={periodEnd} />
          <small>The period&apos;s own end date, as the filing gives it.</small>
        </label>

        <label>
          Period start <small>Optional</small>
          <input type="date" name="periodStart" defaultValue={supersedes?.periodStart ?? ""} />
          <small>
            Left blank, it is the twelve months to the reporting date —{" "}
            {periodEnd ? (parsePeriod({ periodEnd })?.periodStart ?? "…") : "…"}.
          </small>
        </label>
      </div>

      <div className="form-row">
        <label>
          Period
          <select name="periodType" defaultValue={supersedes?.periodType ?? "FY"}>
            {PERIOD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label>
          Currency
          <input name="currency" required maxLength={3} defaultValue={supersedes?.currency ?? "NGN"} placeholder="NGN" />
          <small>As reported. Airtel Africa reports in USD, so it is stored in USD.</small>
        </label>

        <label>
          Scale
          <select name="magnitude" value={magnitude} onChange={(event) => setMagnitude(event.target.value as Magnitude)}>
            {MAGNITUDES.map((option) => (
              <option key={option} value={option}>
                {MAGNITUDE_LABELS[option]}
              </option>
            ))}
          </select>
          <small>The heading above the filing&apos;s columns. Applies to money only.</small>
        </label>
      </div>

      <div className="form-row">
        <label className="checkbox-label">
          <input type="checkbox" name="audited" defaultChecked={supersedes?.audited ?? true} />
          Audited
        </label>
        <label className="checkbox-label">
          <input type="checkbox" name="consolidated" defaultChecked={supersedes?.consolidated ?? true} />
          Consolidated (group), not the company alone
        </label>
      </div>

      <label>
        The filing these figures come from
        <select name="documentId" required defaultValue={supersedes?.documentId ?? ""}>
          <option value="">Choose a document…</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
            </option>
          ))}
        </select>
        <small>Approved documents only. Every figure also carries its own page.</small>
      </label>

      <label>
        Published <small>Optional</small>
        <input type="date" name="publishedAt" defaultValue={supersedes?.publishedAt?.slice(0, 10) ?? ""} />
      </label>

      {supersedes ? (
        <>
          <label>
            What kind of change is this?
            <select name="restatementKind" required defaultValue="">
              <option value="">Choose…</option>
              {RESTATEMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {RESTATEMENT_LABELS[kind]}
                </option>
              ))}
            </select>
            <small>
              The issuer revising its own history and this desk having typed it wrong are different
              events, and the reader is told which.
            </small>
          </label>
          <label>
            Why
            <input name="correctionReason" required maxLength={1000} />
            <small>Published with the correction.</small>
          </label>
        </>
      ) : null}

      <fieldset className="figure-grid">
        <legend>{STATEMENT_TYPE_LABELS[statementType]}</legend>
        {required.length > 0 ? (
          <p className="form-note">
            Required: {required.map((line) => line.label).join(", ")}. A filing read in part cannot be
            approved as a complete one.
          </p>
        ) : null}

        {definitions.map((definition) => (
          <div key={definition.lineItem} className="figure-row">
            <label>
              {definition.label}
              {definition.isRequired ? <span aria-hidden="true"> *</span> : null}
              <input
                name={`figure:${definition.lineItem}`}
                inputMode="decimal"
                autoComplete="off"
                value={figures[definition.lineItem] ?? ""}
                onChange={(event) =>
                  setFigures((current) => ({ ...current, [definition.lineItem]: event.target.value }))
                }
                placeholder="As printed — 1,234 or (1,234)"
              />
              <Preview
                raw={figures[definition.lineItem] ?? ""}
                magnitude={magnitude}
                lineMagnitude={lineScales[definition.lineItem] ?? ""}
                definition={definition}
              />
              {definition.definitionNote ? <small>{definition.definitionNote}</small> : null}
            </label>

            <label>
              Page
              <input
                name={`page:${definition.lineItem}`}
                inputMode="numeric"
                autoComplete="off"
                defaultValue={supersedes?.lines.find((l) => l.lineItem === definition.lineItem)?.sourcePage ?? ""}
              />
            </label>

            {/* Money inherits the statement's scale, and a percentage or a
                per-share figure carries none at all — an NPL ratio of 5 is five
                per cent whatever heading sits above the column. So this appears
                only for counts and quantities, where a filing really does say
                "77.5 million subscribers". */}
            {magnitudeApplies(definition.unitKind) || !magnitudeAllowed(definition.unitKind) ? null : (
              <label>
                Scale
                <select
                  name={`magnitude:${definition.lineItem}`}
                  value={lineScales[definition.lineItem] ?? ""}
                  onChange={(event) =>
                    setLineScales((current) => ({
                      ...current,
                      [definition.lineItem]: event.target.value as Magnitude | "",
                    }))
                  }
                >
                  <option value="">As printed</option>
                  {MAGNITUDES.map((option) => (
                    <option key={option} value={option}>
                      {MAGNITUDE_LABELS[option]}
                    </option>
                  ))}
                </select>
                <small>
                  {definition.unitLabel} — set this where the filing states the figure in thousands or
                  millions.
                </small>
              </label>
            )}

            <label className="checkbox-label">
              <input type="checkbox" name={`restated:${definition.lineItem}`} />
              Restated comparative
            </label>
            <label className="checkbox-label">
              <input type="checkbox" name={`ai:${definition.lineItem}`} />
              AI-suggested, verified against the page
            </label>
          </div>
        ))}
      </fieldset>

      {warnings.length > 0 ? (
        <div className="form-warnings" role="status">
          {warnings.map((warning) => (
            <p key={warning.message} className="form-warning">
              {warning.message}
            </p>
          ))}
          <small>
            Worth a second look. These do not stop a save: what the filing says is what we record.
          </small>
        </div>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : supersedes ? "Record this version" : "Enter these figures"}
      </button>
      <Message state={state} />
      {existing ? (
        <p className="form-note">
          Version {existing.version} of this period is already entered, and is {existing.reviewStatus}.
        </p>
      ) : null}
    </form>
  );
}

export function ReviewQueue({ statements }: { statements: readonly StatementForDesk[] }) {
  const [state, action, pending] = useActionState(reviewStatementAction, EMPTY);
  const waiting = statements.filter((s) => s.reviewStatus === "pending");

  if (waiting.length === 0) {
    return <p className="empty-state">Nothing is waiting to be checked.</p>;
  }

  return (
    <div className="review-queue">
      <Message state={state} />
      {waiting.map((statement) => (
        <article key={statement.id} className="review-item">
          <h3>
            {statement.companyName} — {STATEMENT_TYPE_LABELS[statement.statementType]} {statement.periodType} to{" "}
            {statement.periodEnd}
          </h3>
          <p className="muted">
            {statement.audited ? "Audited" : "Unaudited"},{" "}
            {statement.consolidated ? "consolidated" : "company only"}, {statement.currency},{" "}
            {MAGNITUDE_LABELS[statement.magnitude].toLowerCase()}. Version {statement.version}
            {statement.restatementKind && statement.restatementKind !== "original"
              ? ` — ${RESTATEMENT_LABELS[statement.restatementKind as RestatementKind] ?? statement.restatementKind}`
              : ""}
            {statement.aiAssisted ? ". Contains AI-suggested figures." : ""}
          </p>
          <p className="muted">
            Source: {statement.documentTitle ?? "—"}
            {statement.correctionReason ? ` · ${statement.correctionReason}` : ""}
          </p>

          <table className="figure-table">
            <thead>
              <tr>
                <th>Figure</th>
                <th>As reported</th>
                <th>Stored</th>
                <th>Page</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line) => (
                <tr key={line.lineItem}>
                  <td>
                    {line.label}
                    {line.asRestated ? " (restated)" : ""}
                    {line.aiAssisted ? " · AI-assisted" : ""}
                  </td>
                  <td>
                    {formatReported(line.valueReported, line.reportedMagnitude, line.unitLabel)}
                    {line.reportedPresentation === "bracketed" ? " (bracketed)" : ""}
                  </td>
                  <td>{line.valueStandardised.toLocaleString("en-NG", { maximumFractionDigits: 4 })}</td>
                  <td>{line.sourcePage}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <form action={action} className="inline-form">
            <input type="hidden" name="statementId" value={statement.id} />
            <input type="hidden" name="companySlug" value={statement.companySlug} />
            <label>
              Reason <small>Required to reject</small>
              <input name="reason" maxLength={500} />
            </label>
            <button type="submit" name="decision" value="approved" disabled={pending}>
              Approve
            </button>
            <button type="submit" name="decision" value="rejected" disabled={pending}>
              Reject
            </button>
          </form>
        </article>
      ))}
    </div>
  );
}

/** What has been entered and what has not. "Pending verification" is the honest answer. */
export function CoverageGrid({
  cells,
  years,
  statementType,
}: {
  cells: readonly CoverageCell[];
  years: readonly number[];
  statementType: StatementType;
}) {
  const companies = [...new Map(cells.map((c) => [c.companyId, c.companyName])).entries()];
  const relevant = cells.filter((c) => c.statementType === statementType);

  if (companies.length === 0) {
    return <p className="empty-state">No companies on the register yet.</p>;
  }

  return (
    <table className="coverage-grid">
      <caption>
        {STATEMENT_TYPE_LABELS[statementType]} — entered and checked, by company and year. A blank year
        reads &ldquo;Pending verification&rdquo; to a reader, never as a zero.
      </caption>
      <thead>
        <tr>
          <th>Company</th>
          {years.map((year) => (
            <th key={year}>{year}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {companies.map(([id, name]) => (
          <tr key={id}>
            <th scope="row">{name}</th>
            {years.map((year) => {
              const cell = relevant.find((c) => c.companyId === id && c.year === year);
              const status = cell?.status ?? "absent";
              return (
                <td key={year} data-status={status}>
                  {status === "approved"
                    ? "Checked"
                    : status === "pending"
                      ? "Entered"
                      : status === "rejected"
                        ? "Rejected"
                        : "—"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TemplateAssignmentForm({
  companies,
  templates,
  assignments,
}: {
  companies: readonly CompanyForDesk[];
  templates: readonly TemplateSummary[];
  assignments: readonly CompanyTemplateAssignment[];
}) {
  const [state, action, pending] = useActionState(assignTemplateAction, EMPTY);
  const sectorTemplates = templates.filter((t) => t.scope === "sector" && t.isActive);
  const current = assignments.filter((a) => a.validTo === null);

  return (
    <div>
      <form action={action} className="auth-form">
        <label>
          Company
          <select name="companyId" required defaultValue="">
            <option value="">Choose a company…</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Template
          <select name="templateId" required defaultValue="">
            <option value="">Choose a template…</option>
            {sectorTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          <small>
            The core indicators apply to every company and are not assigned. This is the sector set on
            top of them.
          </small>
        </label>

        <label>
          From
          <input type="date" name="validFrom" required />
          <small>
            Periods already entered keep reading under the template in force when they were entered, so
            a reclassification does not rewrite history.
          </small>
        </label>

        <label>
          Note <small>Optional</small>
          <input name="note" maxLength={500} placeholder="Reclassified after the demerger" />
        </label>

        <button type="submit" disabled={pending}>
          {pending ? "Assigning…" : "Assign"}
        </button>
        <Message state={state} />
      </form>

      {current.length > 0 ? (
        <table className="figure-table">
          <caption>Current assignments</caption>
          <thead>
            <tr>
              <th>Company</th>
              <th>Template</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {current.map((assignment) => (
              <tr key={assignment.id}>
                <td>{companies.find((c) => c.id === assignment.companyId)?.name ?? assignment.companyId}</td>
                <td>{assignment.templateName}</td>
                <td>{assignment.validFrom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">No company is assigned a sector template yet.</p>
      )}
    </div>
  );
}

/**
 * The suggestion queue.
 *
 * There is no accept-all button, and that absence is the design. A single
 * control that accepts forty unexamined figures is this feature's whole risk,
 * and the database could not serve one either: decide_figure_suggestion takes
 * one suggestion. Forty figures is forty decisions, which is the cost of being
 * able to say a person checked each one against the page.
 *
 * Accepting a suggestion does not record a figure. It marks the proposal
 * accepted; the figures still go in through the entry form, where they are
 * flagged AI-assisted for the life of the record.
 */
export function SuggestionQueue({
  batches,
  companies,
  filings,
  extractors,
  companyId,
  statementType,
  periodEnd,
}: {
  batches: readonly SuggestionBatch[];
  companies: readonly CompanyForDesk[];
  filings: readonly CitableFiling[];
  extractors: readonly { id: string; label: string; model: string | null }[];
  companyId: string;
  statementType: StatementType;
  periodEnd: string;
}) {
  const [queueState, queueAction, queueing] = useActionState(queueSuggestionsAction, EMPTY);
  const [decideState, decideAction, deciding] = useActionState(decideSuggestionAction, EMPTY);
  const [closeState, closeAction, closing] = useActionState(closeBatchAction, EMPTY);

  const open = batches.filter((b) => b.status === "open");

  if (extractors.length === 0) {
    return (
      <p className="empty-state">
        Figure extraction is switched off. Nothing queues, and nothing already queued can be decided
        until it is switched back on.
      </p>
    );
  }

  return (
    <div>
      <form action={queueAction} className="auth-form">
        <input type="hidden" name="statementType" value={statementType} />
        <div className="form-row">
          <label>
            Company
            <select name="companyId" required defaultValue={companyId}>
              <option value="">Choose…</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reporting date
            <input type="date" name="periodEnd" required defaultValue={periodEnd} />
          </label>
          <label>
            Period
            <select name="periodType" defaultValue="FY">
              {PERIOD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>
            The filing it was read from
            <select name="documentId" required defaultValue="">
              <option value="">Choose…</option>
              {filings.map((filing) => (
                <option key={filing.id} value={filing.id}>
                  {filing.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Read by
            <select name="provider" defaultValue={extractors[0]?.id}>
              {extractors.map((extractor) => (
                <option key={extractor.id} value={extractor.id}>
                  {extractor.label}
                </option>
              ))}
            </select>
            <small>Recorded on the run, so a wrong figure can be traced to what produced it.</small>
          </label>
          <label>
            Scale
            <select name="magnitude" defaultValue="thousands">
              {MAGNITUDES.map((option) => (
                <option key={option} value={option}>
                  {MAGNITUDE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          The figures, pasted
          <textarea
            name="pastedText"
            rows={6}
            placeholder={"Revenue 1,234,567 p.40\nCost of sales (400,000) p.41\nProfit after tax 200,000 p.40"}
          />
          <small>
            One figure per line: a label this desk knows, the figure as printed, and the page. A line
            that cannot be read with certainty is left out rather than guessed at.
          </small>
        </label>

        <button type="submit" disabled={queueing}>
          {queueing ? "Reading…" : "Queue for checking"}
        </button>
        <Message state={queueState} />
      </form>

      <Message state={decideState} />
      <Message state={closeState} />

      {open.length === 0 ? (
        <p className="empty-state">Nothing queued. Suggestions are never entered without being checked.</p>
      ) : (
        open.map((batch) => {
          const pending = batch.suggestions.filter((s) => s.status === "pending");
          const accepted = batch.suggestions.filter((s) => s.status === "accepted");
          return (
            <article key={batch.id} className="review-item">
              <h3>
                {batch.companyName} — {STATEMENT_TYPE_LABELS[batch.statementType]} {batch.periodType} to{" "}
                {batch.periodEnd}
              </h3>
              <p className="muted">
                Read by {batch.provider}
                {batch.model ? ` · model ${batch.model}` : " · no model"}
                {batch.promptVersion ? ` · prompt ${batch.promptVersion}` : ""} · from{" "}
                {batch.documentTitle ?? "a filing on file"} · {batch.currency},{" "}
                {MAGNITUDE_LABELS[batch.magnitude].toLowerCase()}
              </p>
              <p className="muted">
                {pending.length} to check, {accepted.length} accepted. Accepting one does not record a
                figure: enter the statement to do that.
              </p>

              <table className="figure-table">
                <thead>
                  <tr>
                    <th>Figure</th>
                    <th>Read as</th>
                    <th>On the page</th>
                    <th>Page</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.suggestions.map((suggestion) => (
                    <tr key={suggestion.id}>
                      <td>{suggestion.label}</td>
                      <td>
                        {/* The batch's scale applies to money and nothing else.
                            Falling back to it unconditionally labelled an
                            earnings-per-share figure "4.25 thousands per share"
                            in a thousands batch, while 4.25 is what would be
                            stored — the same preview-against-stored divergence
                            this stage fixed on the entry form, in the other
                            panel. */}
                        {formatReported(
                          suggestion.valueReported,
                          suggestion.magnitude ??
                            (magnitudeApplies(suggestion.unitKind) ? batch.magnitude : "units"),
                          suggestion.unitLabel,
                        )}
                        {suggestion.presentation === "bracketed" ? " (bracketed)" : ""}
                      </td>
                      <td>
                        {suggestion.rawLabel ? <small>{suggestion.rawLabel}</small> : null}
                        {suggestion.rawValue ?? "—"}
                      </td>
                      <td>{suggestion.sourcePage}</td>
                      <td>
                        {suggestion.status === "pending" ? (
                          <form action={decideAction} className="inline-form">
                            <input type="hidden" name="suggestionId" value={suggestion.id} />
                            <input name="reason" maxLength={500} placeholder="Reason to reject" />
                            <button type="submit" name="decision" value="accepted" disabled={deciding}>
                              Accept
                            </button>
                            <button type="submit" name="decision" value="rejected" disabled={deciding}>
                              Reject
                            </button>
                          </form>
                        ) : (
                          <>
                            {suggestion.status === "accepted" ? "Accepted" : "Rejected"}
                            {suggestion.decisionReason ? <small>{suggestion.decisionReason}</small> : null}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <form action={closeAction} className="inline-form">
                <input type="hidden" name="batchId" value={batch.id} />
                <label>
                  Statement it produced <small>Optional</small>
                  <input name="statementId" placeholder="Statement id, once entered" />
                </label>
                <button type="submit" disabled={closing}>
                  Close this run
                </button>
              </form>
            </article>
          );
        })
      )}
    </div>
  );
}

/**
 * Predecessor entities. Access Holdings was established in 2022 and the figures
 * before it belong to Access Bank; BUA Foods listed in 2022 and Aradel in 2024.
 * The link is recorded, and the two sets of figures stay apart — splicing them
 * into one series would publish a continuity that does not exist.
 */
export function SuccessionDesk({
  companies,
  filings,
  announcements,
  successions,
}: {
  companies: readonly CompanyForDesk[];
  filings: readonly CitableFiling[];
  announcements: readonly { id: string; label: string }[];
  successions: readonly SuccessionForDesk[];
}) {
  const [recordState, recordAction, recording] = useActionState(recordSuccessionAction, EMPTY);
  const [reviewState, reviewAction, reviewing] = useActionState(reviewSuccessionAction, EMPTY);
  const [sourceKind, setSourceKind] = useState<"document" | "announcement">("document");

  const waiting = successions.filter((s) => s.reviewStatus === "pending");
  const approved = successions.filter((s) => s.reviewStatus === "approved");
  // A predecessor still marked pre_listing says the opposite of what it is: a
  // company with an offer under way rather than one that is gone. The database
  // refuses it, so the desk says so before the analyst hits that.
  const awaitingListing = companies.filter((c) => c.listingStatus === "pre_listing");

  return (
    <div>
      <form action={recordAction} className="auth-form">
        <div className="form-row">
          <label>
            The former company
            <select name="predecessorCompanyId" required defaultValue="">
              <option value="">Choose…</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                  {company.listingStatus === "pre_listing" ? " — awaiting listing" : ""}
                </option>
              ))}
            </select>
            <small>
              Marked delisted or unlisted, never &ldquo;awaiting listing&rdquo;: a predecessor is an
              entity that is gone.
              {awaitingListing.length > 0
                ? ` ${awaitingListing.length} company on the register is still marked as awaiting listing.`
                : ""}
            </small>
          </label>

          <label>
            The company that succeeded it
            <select name="successorCompanyId" required defaultValue="">
              <option value="">Choose…</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          What happened
          <select name="relationship" required defaultValue="">
            <option value="">Choose…</option>
            {SUCCESSION_RELATIONSHIPS.map((relationship) => (
              <option key={relationship} value={relationship}>
                {SUCCESSION_LABELS[relationship]}
              </option>
            ))}
          </select>
        </label>

        <label>
          When it took effect
          <input name="effectiveOn" required placeholder="2022, 2022-06 or 2022-06-12" />
          <small>
            As precisely as the source gives it, and no more. A filing that says &ldquo;2022&rdquo; is
            stored as a year, not as a day in January.
          </small>
        </label>

        <fieldset className="source-fieldset">
          <legend>What evidences it</legend>
          <label>
            Source
            <select
              name="sourceKind"
              value={sourceKind}
              onChange={(event) => setSourceKind(event.target.value as "document" | "announcement")}
            >
              <option value="document">A filing, and its page</option>
              <option value="announcement">An announcement</option>
            </select>
          </label>

          {sourceKind === "document" ? (
            <div className="form-row">
              <label>
                Filing
                <select name="documentId" required defaultValue="">
                  <option value="">Choose…</option>
                  {filings.map((filing) => (
                    <option key={filing.id} value={filing.id}>
                      {filing.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Page
                <input name="sourcePage" inputMode="numeric" required />
              </label>
            </div>
          ) : (
            <label>
              Announcement
              <select name="announcementId" required defaultValue="">
                <option value="">Choose…</option>
                {announcements.map((announcement) => (
                  <option key={announcement.id} value={announcement.id}>
                    {announcement.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <small>One or the other. A citation pointing at two things supports neither.</small>
        </fieldset>

        <label>
          Note <small>Optional</small>
          <input name="note" maxLength={500} placeholder="The holding company was established in 2022" />
        </label>

        <button type="submit" disabled={recording}>
          {recording ? "Recording…" : "Record this link"}
        </button>
        <Message state={recordState} />
      </form>

      <Message state={reviewState} />

      {waiting.length > 0 ? (
        <table className="figure-table">
          <caption>Waiting for review</caption>
          <thead>
            <tr>
              <th>Former</th>
              <th>Successor</th>
              <th>What happened</th>
              <th>Effective</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {waiting.map((succession) => (
              <tr key={succession.id}>
                <td>{succession.predecessorName}</td>
                <td>{succession.successorName}</td>
                <td>
                  {SUCCESSION_LABELS[succession.relationship as SuccessionRelationship] ??
                    succession.relationship}
                </td>
                <td>{formatSourceDate(succession.effectiveOn, succession.effectivePrecision)}</td>
                <td>
                  {succession.documentTitle
                    ? `${succession.documentTitle} p.${succession.sourcePage}`
                    : (succession.announcementHeadline ?? "—")}
                </td>
                <td>
                  <form action={reviewAction} className="inline-form">
                    <input type="hidden" name="successionId" value={succession.id} />
                    <input name="reason" maxLength={500} placeholder="Reason to reject" />
                    <button type="submit" name="decision" value="approved" disabled={reviewing}>
                      Approve
                    </button>
                    <button type="submit" name="decision" value="rejected" disabled={reviewing}>
                      Reject
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {approved.length > 0 ? (
        <table className="figure-table">
          <caption>Recorded links</caption>
          <thead>
            <tr>
              <th>Former</th>
              <th>Successor</th>
              <th>Effective</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {approved.map((succession) => (
              <tr key={succession.id}>
                <td>{succession.predecessorName}</td>
                <td>{succession.successorName}</td>
                <td>{formatSourceDate(succession.effectiveOn, succession.effectivePrecision)}</td>
                <td>{succession.reviewSelfApproved ? <span className="self-approved-flag">SELF-REVIEWED</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-state">
          No predecessor links recorded. Access Holdings, BUA Foods and Aradel each have history under
          an earlier entity, and that history is linked rather than merged.
        </p>
      )}
    </div>
  );
}

export function StatementPicker({
  companies,
  companyId,
  statementType,
  periodEnd,
}: {
  companies: readonly CompanyForDesk[];
  companyId: string;
  statementType: StatementType;
  periodEnd: string;
}) {
  // A GET form, so the server renders the right template for the choice. Which
  // figures exist is a decision that belongs on the server: a client-side switch
  // would have to be trusted.
  return (
    <form method="get" className="auth-form inline-form">
      <label>
        Company
        <select name="company" defaultValue={companyId}>
          <option value="">Choose…</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Statement
        <select name="statement" defaultValue={statementType}>
          {STATEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {STATEMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Reporting date
        <input type="date" name="period" defaultValue={periodEnd} />
      </label>
      <button type="submit">Show the form</button>
    </form>
  );
}
