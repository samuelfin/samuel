import { coverageSentence, type CoverageScore } from "@/lib/metrics/coverage";

/**
 * How much of this company's history SFI holds, said plainly.
 *
 * A year nobody has checked is not covered, and the panel says which required
 * figures a held year is still missing — the honest version is also the useful
 * one, because it is a list of work rather than a reassurance.
 *
 * A year entered but not yet checked does not appear here at all: row-level
 * security keeps unreviewed figures to the desk, so a reader is told only what
 * has been verified. The desk sees the pending ones in its own queue.
 */
export function CoveragePanel({ score }: { score: CoverageScore }) {
  return (
    <div className="coverage-score">
      <p className="coverage-headline">{coverageSentence(score)}</p>

      <ul className="coverage-years">
        {score.years.map((year) => (
          <li key={year.financialYear} data-held={year.held ? "yes" : "no"}>
            <span>FY{year.financialYear}</span>
            {year.held ? (
              year.missing.length === 0 ? (
                <strong>Complete</strong>
              ) : (
                <strong>{year.missing.length} missing</strong>
              )
            ) : (
              <em>Pending verification</em>
            )}
            {year.held && year.missing.length > 0 ? <small>{year.missing.join(", ")}</small> : null}
          </li>
        ))}
      </ul>

      <p className="form-note">
        A year counts only once a person has checked its figures against the filing. Nothing is
        estimated to fill a gap, and a missing year is not a statement that the company reported
        nothing.
      </p>
    </div>
  );
}
