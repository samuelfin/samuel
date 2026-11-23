import { MAGNITUDE_LABELS, STATEMENT_TYPE_LABELS, formatReported } from "@/lib/financials/validation";
import type { ReaderStatement } from "@/lib/data/financials";

/**
 * A company's reported figures, as the filings report them.
 *
 * Three rules shape what this shows.
 *
 * Every figure names the page it came from, so a reader can check any number
 * against the filing. Where the source carries a public link, the link goes to
 * the issuer's own copy — never to SFI's stored one, which is licensed material
 * behind a signed URL.
 *
 * A year we have not verified is absent, and says so. "Pending verification" is
 * the honest answer; an estimate, an interpolation, or a figure carried forward
 * from another year would all be inventions.
 *
 * And figures appear in the scale and currency the filing used. Airtel Africa
 * reports in dollars, so its figures are dollars here. A naira equivalent is a
 * calculation with its own rate and its own source, and it arrives with the
 * metrics in 3d, labelled as a conversion.
 */

const YEARS_EXPECTED = 5;

function periodLabel(statement: ReaderStatement): string {
  return `${statement.periodType} to ${statement.periodEnd}`;
}

export function FinancialsPanel({
  statements,
  companyName,
}: {
  statements: readonly ReaderStatement[];
  companyName: string;
}) {
  if (statements.length === 0) {
    return (
      <p className="empty-state">
        No figures yet for {companyName}. Pending verification — the five-year history is entered from
        the audited annual reports, and a year appears here only once a person has checked it against
        the filing.
      </p>
    );
  }

  // Grouped by statement, newest period first, so a reader sees the income
  // statement across the years rather than one period at a time.
  const byType = new Map<string, ReaderStatement[]>();
  for (const statement of statements) {
    const list = byType.get(statement.statementType) ?? [];
    list.push(statement);
    byType.set(statement.statementType, list);
  }

  const years = [...new Set(statements.map((s) => s.periodEnd.slice(0, 4)))].sort().reverse();
  const missing = Math.max(0, YEARS_EXPECTED - years.length);

  return (
    <div className="financials-panel">
      {missing > 0 ? (
        <p className="form-note">
          {years.length} of {YEARS_EXPECTED} years verified. The remaining {missing} are pending
          verification, not estimated.
        </p>
      ) : null}

      {[...byType.entries()].map(([statementType, group]) => (
        <section key={statementType} className="financials-statement">
          <h3>{STATEMENT_TYPE_LABELS[statementType as keyof typeof STATEMENT_TYPE_LABELS] ?? statementType}</h3>

          {group.map((statement) => (
            <div key={statement.id} className="financials-period">
              <h4>
                {periodLabel(statement)}
                <span>
                  {statement.audited ? "Audited" : "Unaudited"} ·{" "}
                  {statement.consolidated ? "Consolidated" : "Company only"} · {statement.currency}
                  {statement.version > 1 ? ` · Version ${statement.version}` : ""}
                </span>
              </h4>

              {statement.restatementKind === "issuer_restated" ? (
                <p className="article-flagline">Restated by the issuer. {statement.correctionReason ?? ""}</p>
              ) : null}
              {statement.restatementKind === "sfi_correction" ? (
                <p className="article-flagline">Corrected by SFI. {statement.correctionReason ?? ""}</p>
              ) : null}
              {statement.aiAssisted ? (
                <p className="article-flagline">
                  Some figures in this period were suggested by extraction software and verified by a
                  person against the page.
                </p>
              ) : null}

              <table className="figure-table">
                <thead>
                  <tr>
                    <th>Figure</th>
                    <th>As reported</th>
                    <th>Page</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.figures.map((figure) => (
                    <tr key={figure.lineItem}>
                      <td>
                        {figure.label}
                        {figure.asRestated ? " (restated)" : ""}
                        {figure.note ? <small>{figure.note}</small> : null}
                      </td>
                      <td>{formatReported(figure.valueReported, figure.reportedMagnitude, figure.unitLabel)}</td>
                      <td>{figure.sourcePage || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="muted">
                {statement.sourceTitle ? (
                  statement.sourceUri ? (
                    // The issuer's own copy. SFI's stored file is licensed
                    // material behind a signed URL and is never linked from here.
                    <a href={statement.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                      {statement.sourceTitle}
                    </a>
                  ) : (
                    statement.sourceTitle
                  )
                ) : (
                  "Source on file"
                )}
                {statement.figures.length > 0
                  ? ` · figures as printed, in ${MAGNITUDE_LABELS[
                      statement.figures[0].reportedMagnitude
                    ].toLowerCase()} where the filing used a scale`
                  : ""}
              </p>
            </div>
          ))}
        </section>
      ))}

      <p className="form-note">
        Reported figures, not calculated ones. Margins, growth and returns are computed separately and
        labelled as derived metrics, with the formula and its version shown. Nothing here is converted
        between currencies.
      </p>
    </div>
  );
}
