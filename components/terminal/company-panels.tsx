import {
  formatMetricValue,
  formulaText,
  METRIC_GROUP_LABELS,
  REASON_TAGS,
  reasonText,
  type MetricDefinition,
  type MetricGroup,
} from "@/lib/metrics/definitions";
import type { CompanyMetricInput, CompanyMetricValue, MetricStatusRow } from "@/lib/data/metrics";
import type { ReaderStatement } from "@/lib/data/financials";
import { formatReported } from "@/lib/financials/validation";

/**
 * The panels a company page is made of, beyond the figures table 3c shipped.
 *
 * Everything numeric here was either reported in a filing a person checked, or
 * divided by the database from such figures under a formula a person approved.
 * No arithmetic happens in this file; it formats what it was handed and says
 * where that came from.
 *
 * Four rules shape what a reader sees.
 *
 * A value is labelled: calculated by SFI or disclosed by the issuer with its
 * page, audited or unaudited, consolidated or company-only, its currency, and
 * whether any input was restated or AI-assisted. A calculated ratio and a
 * disclosed one are different kinds of claim and are never shown alike.
 *
 * An answer that does not exist is a sentence, never a zero and never a blank.
 * "No prior year" and "Pending verification" are different facts about a
 * company, and only one of them asks anybody to do something.
 *
 * Every ratio can be opened to show the formula that produced it, its version,
 * who owns and approved it, the interim-methodology notice, and each input
 * figure with its period, its document and its page.
 *
 * And a ratio whose formula nobody has approved publishes nothing. The metric is
 * still listed, so its absence is explained rather than silent.
 */

const PERIOD_ROLE_LABELS: Record<CompanyMetricInput["periodRole"], string> = {
  current: "this year",
  prior: "the year before",
  window_start: "the start of the window",
};

function missingLabels(value: CompanyMetricValue, definition: MetricDefinition): string[] {
  return value.missingInputs.map(
    (code) => definition.inputs.find((input) => input.lineItem === code)?.label ?? code,
  );
}

function sentence(value: CompanyMetricValue, definition: MetricDefinition): string {
  return reasonText(value.reason ?? "input_missing", {
    kind: value.kind,
    windowYears: definition.windowYears,
    missingLabels: missingLabels(value, definition),
  });
}

function ValueLabels({ value }: { value: CompanyMetricValue }) {
  const labels: string[] = [];
  if (value.status === "disclosed") {
    labels.push(
      value.disclosedPage
        ? "Disclosed by the issuer, page " + value.disclosedPage
        : "Disclosed by the issuer",
    );
  } else if (value.status === "available") {
    labels.push("Calculated by SFI");
  }
  // An unavailable row carries no audit label: there is no figure to describe,
  // and "audited" over nothing was a defect once already.
  if (value.allAudited !== null) labels.push(value.allAudited ? "Audited" : "Unaudited");
  labels.push(value.consolidated ? "Consolidated" : "Company only");
  if (value.resultUnit === "currency") labels.push(value.currency);
  if (value.anyRestated) labels.push("Restated");
  if (value.anyAiAssisted) labels.push("AI-assisted");
  return <span className="ratio-labels">{labels.join(" · ")}</span>;
}

function HowCalculated({
  definition,
  years,
  inputs,
}: {
  definition: MetricDefinition;
  years: readonly CompanyMetricValue[];
  inputs: readonly CompanyMetricInput[];
}) {
  const who = definition.approvedByName ?? "a platform administrator";
  const approval = definition.approvedAt
    ? definition.selfApproved
      ? "Approved by " + who + ", who also recorded it"
      : "Approved by " + who
    : "Not approved";

  return (
    <details className="ratio-how">
      <summary>How calculated</summary>
      <dl>
        <dt>Formula</dt>
        <dd>
          <code>{formulaText(definition)}</code>
        </dd>
        <dt>In words</dt>
        <dd>{definition.definition}</dd>
        <dt>Version</dt>
        <dd>
          v{definition.version}, in force from {definition.effectiveFrom}
        </dd>
        <dt>Owner</dt>
        <dd>
          {definition.ownerName} · {approval}
          {definition.decisionReason ? " · " + definition.decisionReason : ""}
        </dd>
      </dl>
      <p className="ratio-interim">Interim methodology, not yet reviewed by an economist.</p>

      {years.map((year) => {
        const used = inputs.filter((input) => input.financialYear === year.financialYear);
        if (used.length === 0) return null;
        return (
          <div className="ratio-inputs" key={year.financialYear}>
            <h5>
              FY{year.financialYear}
              {year.status === "not_available" ? " — " + sentence(year, definition) : ""}
            </h5>
            <ul>
              {used.map((input) => (
                <li key={input.role + "-" + input.periodRole + "-" + input.lineItem}>
                  <strong>{input.label}</strong> <span>({PERIOD_ROLE_LABELS[input.periodRole]})</span>{" "}
                  {input.valueStandardised === null ? (
                    <em>Pending verification — not entered yet</em>
                  ) : (
                    <>
                      <span className="num">{input.valueReported}</span>
                      {input.reportedMagnitude && input.reportedMagnitude !== "units"
                        ? " " + input.reportedMagnitude
                        : ""}{" "}
                      ·{" "}
                      {input.sourceUri ? (
                        <a href={input.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                          {input.documentTitle ?? "the filing"}
                        </a>
                      ) : (
                        (input.documentTitle ?? "the filing")
                      )}
                      {input.sourcePage ? ", page " + input.sourcePage : ""}
                      {input.figurePeriodEnd ? " · period to " + input.figurePeriodEnd : ""}
                      {input.audited === false ? " · unaudited" : ""}
                      {input.asRestated ? " · restated" : ""}
                      {input.aiAssisted ? " · AI-assisted" : ""}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </details>
  );
}

function Ratio({
  definition,
  years,
  inputs,
}: {
  definition: MetricDefinition;
  years: readonly CompanyMetricValue[];
  inputs: readonly CompanyMetricInput[];
}) {
  const latest = years[0];

  return (
    <article className="ratio">
      <header>
        <h4>{definition.label}</h4>
        <ValueLabels value={latest} />
      </header>

      <p className="ratio-latest">
        {latest.status === "not_available" ? (
          <span className="ratio-unavailable">{sentence(latest, definition)}</span>
        ) : (
          <>
            <strong className="num">
              {formatMetricValue(latest.value, latest.resultUnit, definition.decimals, latest.currency)}
            </strong>
            <span> FY{latest.financialYear}</span>
          </>
        )}
      </p>

      {years.length > 1 ? (
        <ul className="ratio-series">
          {years.map((year) => (
            <li key={year.financialYear}>
              <span>FY{year.financialYear}</span>
              {year.status === "not_available" ? (
                <em title={sentence(year, definition)}>{REASON_TAGS[year.reason ?? "input_missing"]}</em>
              ) : (
                <strong className="num">
                  {formatMetricValue(year.value, year.resultUnit, definition.decimals, year.currency)}
                </strong>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <HowCalculated definition={definition} years={years} inputs={inputs} />
    </article>
  );
}

export function RatiosPanel({
  companyName,
  values,
  inputs,
  definitions,
  statuses,
  templateId,
}: {
  companyName: string;
  values: readonly CompanyMetricValue[];
  inputs: readonly CompanyMetricInput[];
  definitions: readonly MetricDefinition[];
  statuses: readonly MetricStatusRow[];
  templateId: string | null;
}) {
  const published = new Map(definitions.map((definition) => [definition.code, definition]));

  // A metric applies to this company when it has no template of its own, or when
  // it matches the sector template the company is entered under.
  const applies = (metricTemplate: string | null) =>
    metricTemplate === null || metricTemplate === templateId;

  const waiting = statuses
    .filter(
      (row) => row.status === "awaiting_approval" && !published.has(row.code) && applies(row.templateId),
    )
    .filter((row, index, all) => all.findIndex((other) => other.code === row.code) === index);

  const byCode = new Map<string, CompanyMetricValue[]>();
  for (const value of values) {
    const list = byCode.get(value.code) ?? [];
    list.push(value);
    byCode.set(value.code, list);
  }
  for (const list of byCode.values()) list.sort((a, b) => b.financialYear - a.financialYear);

  const groups = [
    ...new Set([
      ...definitions.filter((definition) => byCode.has(definition.code)).map((d) => d.group),
      ...waiting.map((row) => row.group),
    ]),
  ] as MetricGroup[];

  if (groups.length === 0) {
    return (
      <p className="empty-state">
        No ratios yet for {companyName}. A ratio is calculated from figures a person has checked
        against the filing, under a formula a person has approved, and neither is in place for this
        company yet. Nothing here is estimated to fill the gap.
      </p>
    );
  }

  return (
    <div className="ratios-panel">
      {groups.map((group) => (
        <section className="ratio-group" key={group}>
          <h3>{METRIC_GROUP_LABELS[group]}</h3>

          {definitions
            .filter((definition) => definition.group === group && byCode.has(definition.code))
            .map((definition) => (
              <Ratio
                key={definition.code}
                definition={definition}
                years={byCode.get(definition.code) ?? []}
                inputs={inputs.filter((input) => input.code === definition.code)}
              />
            ))}

          {waiting
            .filter((row) => row.group === group)
            .map((row) => (
              <article className="ratio is-waiting" key={row.code}>
                <header>
                  <h4>{row.label}</h4>
                  <span className="ratio-labels">Awaiting approval</span>
                </header>
                <p className="ratio-latest">
                  <span className="ratio-unavailable">
                    Not published: the formula for this ratio has not been approved, so nothing is
                    calculated from it. The formula itself is not shown until it has been.
                  </span>
                </p>
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}

export interface HeadlineYear {
  financialYear: number;
  periodEnd: string;
  consolidated: boolean;
  currency: string;
  audited: boolean;
}

/**
 * The headline tiles, all from one financial year.
 *
 * One year, named on the panel, on the basis shown. A tile whose figure is not
 * in that year reads "Pending verification" rather than quietly reaching back to
 * an earlier one — a row of tiles from four different years looks like a
 * snapshot and is not one.
 */
export function OverviewTiles({
  year,
  statements,
  metrics,
  definitions,
}: {
  year: HeadlineYear | null;
  statements: readonly ReaderStatement[];
  metrics: readonly CompanyMetricValue[];
  definitions: readonly MetricDefinition[];
}) {
  if (!year) {
    return (
      <p className="empty-state">
        Pending verification. No financial year has been entered and checked for this company yet, so
        there are no headline figures to show. Nothing is estimated in the meantime.
      </p>
    );
  }

  const figures = new Map<string, { reported: string; page: number }>();
  for (const statement of statements) {
    if (statement.periodType !== "FY") continue;
    if (statement.periodEnd.slice(0, 10) !== year.periodEnd) continue;
    if (statement.consolidated !== year.consolidated) continue;
    if (statement.currency !== year.currency) continue;
    for (const figure of statement.figures) {
      figures.set(figure.lineItem, {
        reported: formatReported(figure.valueReported, figure.reportedMagnitude, figure.unitLabel),
        page: figure.sourcePage,
      });
    }
  }

  const reported = [
    { lineItem: "revenue", label: "Revenue" },
    { lineItem: "profit_after_tax", label: "Profit after tax" },
    { lineItem: "earnings_per_share", label: "Earnings per share" },
    { lineItem: "dividend_per_share", label: "Dividend per share" },
  ];
  const calculated = [
    { code: "net_margin", fallback: "Net profit margin" },
    { code: "roe", fallback: "Return on equity" },
  ];

  return (
    <div className="headline-tiles">
      <p className="form-note">
        FY{year.financialYear}, period to {year.periodEnd} · {year.audited ? "Audited" : "Unaudited"} ·{" "}
        {year.consolidated ? "Consolidated" : "Company only"} · {year.currency}. Every tile is from
        this year; a figure from another year is not shown in its place.
      </p>

      <div className="tile-row">
        {reported.map((entry) => {
          const figure = figures.get(entry.lineItem);
          return (
            <div className="tile" key={entry.lineItem}>
              <span className="tile-label">{entry.label}</span>
              <strong className="tile-value num">
                {figure ? figure.reported : "Pending verification"}
              </strong>
              <span className="tile-foot">
                {figure
                  ? "As reported, page " + figure.page
                  : "Not entered for FY" + year.financialYear}
              </span>
            </div>
          );
        })}

        {calculated.map((entry) => {
          const definition = definitions.find((row) => row.code === entry.code);
          const value = definition
            ? metrics.find(
                (row) => row.code === entry.code && row.financialYear === year.financialYear,
              )
            : undefined;

          if (!definition || !value) {
            return (
              <div className="tile" key={entry.code}>
                <span className="tile-label">{definition?.label ?? entry.fallback}</span>
                <strong className="tile-value num">Pending verification</strong>
                <span className="tile-foot">
                  {definition
                    ? "Not calculated for FY" + year.financialYear
                    : "The formula for this ratio is awaiting approval"}
                </span>
              </div>
            );
          }

          return (
            <div className="tile" key={entry.code}>
              <span className="tile-label">{definition.label}</span>
              <strong className="tile-value num">
                {value.status === "not_available"
                  ? REASON_TAGS[value.reason ?? "input_missing"]
                  : formatMetricValue(value.value, value.resultUnit, definition.decimals, value.currency)}
              </strong>
              <span className="tile-foot">
                {value.status === "not_available"
                  ? sentence(value, definition)
                  : (value.status === "disclosed" ? "Disclosed by the issuer" : "Calculated by SFI") +
                    " · v" +
                    value.definitionVersion}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Dividends, as far as 3d can honestly go: the dividend per share a filing
 * reported, and the payout ratio calculated from it. Declaration, ex and payment
 * dates, bonus issues and rights arrive with corporate actions in 3e — until
 * then this says so, rather than implying the company has never paid.
 */
export function DividendsPanel({
  companyName,
  statements,
  metrics,
  definitions,
}: {
  companyName: string;
  statements: readonly ReaderStatement[];
  metrics: readonly CompanyMetricValue[];
  definitions: readonly MetricDefinition[];
}) {
  const perShare = statements
    .filter((statement) => statement.periodType === "FY")
    .flatMap((statement) =>
      statement.figures
        .filter((figure) => figure.lineItem === "dividend_per_share")
        .map((figure) => ({
          financialYear: Number(statement.periodEnd.slice(0, 4)),
          audited: statement.audited,
          consolidated: statement.consolidated,
          currency: statement.currency,
          reported: formatReported(figure.valueReported, figure.reportedMagnitude, figure.unitLabel),
          page: figure.sourcePage,
          sourceTitle: statement.sourceTitle,
          sourceUri: statement.sourceUri,
        })),
    )
    .sort((a, b) => b.financialYear - a.financialYear);

  const payout = definitions.find((definition) => definition.code === "payout_ratio");
  const payoutValues = metrics
    .filter((value) => value.code === "payout_ratio")
    .sort((a, b) => b.financialYear - a.financialYear);

  return (
    <div className="dividends-panel">
      {perShare.length === 0 ? (
        <p className="empty-state">
          No data yet. No dividend per share has been entered and checked for {companyName}, and the
          dividend history — declaration, ex and payment dates, bonus issues and rights — arrives with
          corporate actions in a later stage. An empty panel here means nothing has been verified, not
          that nothing was paid.
        </p>
      ) : (
        <table className="figure-table">
          <caption>Dividend per share, as reported in the filings</caption>
          <thead>
            <tr>
              <th>Year</th>
              <th>Per share</th>
              <th>Basis</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {perShare.map((entry) => (
              <tr key={entry.financialYear}>
                <th scope="row">FY{entry.financialYear}</th>
                <td className="num">{entry.reported}</td>
                <td>
                  {entry.audited ? "Audited" : "Unaudited"} ·{" "}
                  {entry.consolidated ? "Consolidated" : "Company only"} · {entry.currency}
                </td>
                <td>
                  {entry.sourceUri ? (
                    <a href={entry.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                      {entry.sourceTitle ?? "the filing"}
                    </a>
                  ) : (
                    (entry.sourceTitle ?? "the filing")
                  )}
                  , page {entry.page}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {payout && payoutValues.length > 0 ? (
        <Ratio definition={payout} years={payoutValues} inputs={[]} />
      ) : null}

      <p className="form-note">
        Dividend yield needs a share price, and so waits for a market-data licence from the Nigerian
        Exchange. Nothing else on this page waits on it.
      </p>
    </div>
  );
}

export interface DocumentAudit {
  documentId: string;
  audited: boolean;
}

export interface CompanyDocumentRow {
  id: string;
  title: string;
  kind: string;
  publishedAt: string | null;
  reviewedAt: string | null;
  sourceUri: string | null;
}

const DOCUMENT_KINDS: Record<string, string> = {
  annual_report: "Annual report",
  interim_report: "Interim report",
  financial_statements: "Financial statements",
  presentation: "Presentation",
  announcement: "Announcement",
  regulatory_filing: "Regulatory filing",
  statistical_release: "Statistical release",
  auction_result: "Auction result",
  circular: "Circular",
  other: "Document",
};

/**
 * The filings themselves.
 *
 * Audit status is shown only where every approved statement citing the document
 * agrees, because that status is a claim about the document and two statements
 * disagreeing about it means SFI does not know. It is never inferred from the
 * document's kind or its title: an annual report nobody has entered figures from
 * says nothing about whether it was audited.
 */
export function AnnualReportsPanel({
  documents,
  auditStatus,
}: {
  documents: readonly CompanyDocumentRow[];
  auditStatus: readonly DocumentAudit[];
}) {
  if (documents.length === 0) {
    return (
      <p className="empty-state">
        No documents yet. Annual reports, interim results and other filings appear here once they have
        been reviewed.
      </p>
    );
  }

  function audit(documentId: string): string {
    const claims = auditStatus.filter((entry) => entry.documentId === documentId);
    if (claims.length === 0) return "Not recorded";
    const first = claims[0].audited;
    if (claims.some((entry) => entry.audited !== first)) return "Not recorded";
    return first ? "Audited" : "Unaudited";
  }

  return (
    <table className="figure-table">
      <caption>Filings reviewed before they appear, with the audit status their figures carry</caption>
      <thead>
        <tr>
          <th>Document</th>
          <th>Kind</th>
          <th>Audit status</th>
          <th>Published</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((document) => (
          <tr key={document.id}>
            <th scope="row">
              {/* Readers are sent to the issuer's own copy, never to our stored
                  one: that is licensed material behind a signed URL. */}
              {document.sourceUri ? (
                <a href={document.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                  {document.title}
                </a>
              ) : (
                document.title
              )}
            </th>
            <td>{DOCUMENT_KINDS[document.kind] ?? document.kind}</td>
            <td>{audit(document.id)}</td>
            <td>{(document.publishedAt ?? document.reviewedAt ?? "").slice(0, 10) || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
