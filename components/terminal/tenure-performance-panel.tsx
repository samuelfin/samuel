import Link from "next/link";
import { formatTenure } from "@/lib/people/validation";
import { OVERLAP_LABELS, tenureRows, type PeriodFigure } from "@/lib/people/tenure-performance";
import type { HeldOffice } from "@/lib/data/people";

/**
 * A company's reported figures, shown beside the dates of a tenure.
 *
 * Presentational only. Everything that decides what a row says lives in
 * lib/people/tenure-performance, where the rule this panel exists under is
 * enforced by tests: each row is a function of its own period and the tenure,
 * so no delta, growth rate, ranking or score can be produced here.
 *
 * Figures arrive at stage 3c, so `figures` is empty for now and the panel says
 * so honestly rather than implying a company has no results.
 */

export interface OfficeFigures {
  office: HeldOffice;
  figures: PeriodFigure[];
}

function OfficeBlock({ office, figures }: OfficeFigures) {
  const rows = tenureRows(figures, { validFrom: office.validFrom, validTo: office.validTo });
  const tenure = formatTenure(
    office.validFrom,
    office.validFromPrecision,
    office.validTo,
    office.validToPrecision,
  );

  return (
    <>
      <p className="panel-note">
        {(office.roleTitle ?? office.roleName).toUpperCase()} ·{" "}
        {office.companySlug ? (
          <Link href={`/companies/${office.companySlug}`}>{office.companyName}</Link>
        ) : (
          office.companyName
        )}
        {tenure ? ` · ${tenure}` : ""}
      </p>

      {rows.length === 0 ? (
        <p className="panel-note">
          No figures recorded for {office.companyName} yet.
        </p>
      ) : (
        <div className="review-list">
          {rows.map((row) => (
            <article className="review-row" key={row.id}>
              <div className="review-row-main">
                <strong>
                  {row.metricLabel}: {row.valueAsReported} {row.unit}
                </strong>
                <p>
                  {row.periodLabel} · {OVERLAP_LABELS[row.overlap]}
                </p>
                <p className="review-row-meta">
                  {row.sourceTitle ? (
                    row.sourceUri ? (
                      <a href={row.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                        {row.sourcePage ? `${row.sourceTitle}, page ${row.sourcePage}` : row.sourceTitle}
                      </a>
                    ) : row.sourcePage ? (
                      `${row.sourceTitle}, page ${row.sourcePage}`
                    ) : (
                      row.sourceTitle
                    )
                  ) : (
                    "Source not recorded"
                  )}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function TenurePerformancePanel({ offices }: { offices: OfficeFigures[] }) {
  const anyFigures = offices.some((entry) => entry.figures.length > 0);

  if (offices.length === 0 || !anyFigures) {
    return (
      <div className="provider-empty">
        <span className="provider-orbit">◌</span>
        <strong>No data yet</strong>
        <p>
          Each company&apos;s reported figures will appear here beside the dates of the relevant
          tenure, every number citing the filing and page it came from. They are shown for reference
          and are not a score, a ranking, or a claim that this person caused them — a tenure
          overlaps currency moves, commodity cycles and a predecessor&apos;s decisions. Financial
          history opens at stage 3c.
        </p>
      </div>
    );
  }

  return (
    <>
      {offices.map((entry) => (
        <OfficeBlock office={entry.office} figures={entry.figures} key={entry.office.id} />
      ))}
      <p className="panel-note">
        Figures are as the company reported them, each citing its filing and page. Periods are
        marked by how they sit against the tenure dates. Nothing here is a judgement of the person
        named, and no figure on this page is calculated from another.
      </p>
    </>
  );
}
