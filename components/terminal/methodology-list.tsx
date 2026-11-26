import {
  formulaText,
  METRIC_GROUP_LABELS,
  METRIC_KIND_LABELS,
  METRIC_STATUS_LABELS,
  type MetricDefinition,
  type MetricGroup,
} from "@/lib/metrics/definitions";
import type { MetricStatusRow } from "@/lib/data/metrics";

/**
 * The published formulas, and the names of the ones still waiting.
 *
 * A published definition is shown in full, because a calculated figure can only
 * be audited against its definition. One nobody has approved is shown as a name
 * and a status: publishing a proposal as though it were methodology is the thing
 * the approval step exists to prevent.
 */
export function MethodologyList({
  definitions,
  statuses,
}: {
  definitions: readonly MetricDefinition[];
  statuses: readonly MetricStatusRow[];
}) {
  const published = new Map(definitions.map((definition) => [definition.code, definition]));
  const waiting = statuses
    .filter((row) => row.status === "awaiting_approval" && !published.has(row.code))
    .filter((row, index, all) => all.findIndex((other) => other.code === row.code) === index);

  const groups = [
    ...new Set([
      ...definitions.map((definition) => definition.group),
      ...waiting.map((row) => row.group),
    ]),
  ] as MetricGroup[];

  if (groups.length === 0) {
    return <p className="empty-state">No metric definitions have been recorded yet.</p>;
  }

  const selfApproved = definitions.filter((definition) => definition.selfApproved).length;

  return (
    <div className="methodology">
      <p className="ratio-interim">
        Interim methodology, not yet reviewed by an economist.{" "}
        {definitions.length > 0
          ? definitions.length +
            " formula" +
            (definitions.length === 1 ? "" : "s") +
            " published, " +
            selfApproved +
            " of them approved by the person who recorded them."
          : "Nothing is published yet, so no ratio is calculated on this platform."}{" "}
        A reviewed definition is recorded as a new version, never an edit, and the version that
        produced a figure is shown beside it.
      </p>

      {groups.map((group) => (
        <section className="methodology-group" key={group}>
          <h3>{METRIC_GROUP_LABELS[group]}</h3>

          {definitions
            .filter((definition) => definition.group === group)
            .map((definition) => (
              <article className="methodology-entry" key={definition.code}>
                <header>
                  <h4>{definition.label}</h4>
                  <span className="ratio-labels">
                    v{definition.version} · {METRIC_STATUS_LABELS[definition.status]}
                    {definition.templateName ? " · " + definition.templateName + " only" : ""}
                  </span>
                </header>
                <code>{formulaText(definition)}</code>
                <p>{definition.definition}</p>
                <dl>
                  <dt>Shape</dt>
                  <dd>{METRIC_KIND_LABELS[definition.kind]}</dd>
                  <dt>Owner</dt>
                  <dd>{definition.ownerName}</dd>
                  <dt>Approved by</dt>
                  <dd>
                    {definition.approvedByName ?? "a platform administrator"}
                    {definition.selfApproved ? ", who also recorded it" : ""}
                    {definition.decisionReason ? " — " + definition.decisionReason : ""}
                  </dd>
                  <dt>In force from</dt>
                  <dd>{definition.effectiveFrom}</dd>
                  {definition.disclosedLabel ? (
                    <>
                      <dt>Stands aside for</dt>
                      <dd>
                        {definition.disclosedLabel} as the issuer disclosed it, with its page,
                        wherever the filing states it.
                      </dd>
                    </>
                  ) : null}
                </dl>
              </article>
            ))}

          {waiting
            .filter((row) => row.group === group)
            .map((row) => (
              <article className="methodology-entry is-waiting" key={row.code}>
                <header>
                  <h4>{row.label}</h4>
                  <span className="ratio-labels">Awaiting approval</span>
                </header>
                <p>
                  No formula is published for this metric yet, so nothing is calculated from it. The
                  proposed formula is not shown until somebody has approved it.
                </p>
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
