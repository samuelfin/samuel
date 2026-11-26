import {
  formulaText,
  METRIC_GROUP_LABELS,
  METRIC_KIND_LABELS,
  type MetricDefinition,
  type MetricGroup,
} from "@/lib/metrics/definitions";

/**
 * The metric register, as the desk reads it.
 *
 * A reported figure can be checked against a page. A calculated one can only be
 * checked against its definition, so the definition has to be visible to the
 * people who enter the figures it consumes: what it divides, by what, who owns
 * it, who approved it, and which version is live. The same definitions reach a
 * reader on the methodology page.
 *
 * Nothing here is editable. A formula is corrected by recording a new version,
 * exactly as a figure is, and until that desk exists a change is a migration
 * with a test — which for a library this small is the honest trade.
 */

function approval(definition: MetricDefinition): string {
  if (!definition.approvedAt) return "Not approved — draft";
  const who = definition.approvedByName ?? "a platform administrator";
  return definition.selfApproved ? `Approved by ${who}, who also owns it` : `Approved by ${who}`;
}

export function MetricLibrary({ definitions }: { definitions: readonly MetricDefinition[] }) {
  if (definitions.length === 0) {
    return <p className="empty-state">No metric definitions yet.</p>;
  }

  const groups = [...new Set(definitions.map((d) => d.group))] as MetricGroup[];
  const selfApproved = definitions.filter((d) => d.selfApproved).length;

  return (
    <div className="metric-library">
      <p className="form-note">
        {definitions.length} live definitions, {selfApproved} of them approved by their own owner.
        Interim methodology: no economist has reviewed these formulas, and every ratio built from them
        carries that label. Figures are never estimated to fill a formula — an input that is missing
        makes the answer &ldquo;Not available&rdquo;, with the reason stated.
      </p>

      {groups.map((group) => (
        <section className="metric-group" key={group}>
          <h3>{METRIC_GROUP_LABELS[group]}</h3>
          <table className="metric-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Formula</th>
                <th>Version</th>
                <th>Owner and approval</th>
              </tr>
            </thead>
            <tbody>
              {definitions
                .filter((definition) => definition.group === group)
                .map((definition) => (
                  <tr key={definition.id}>
                    <th scope="row">
                      {definition.label}
                      <small>{definition.code}</small>
                      {definition.templateName ? <small>{definition.templateName} only</small> : null}
                    </th>
                    <td>
                      <code>{formulaText(definition)}</code>
                      <small>{METRIC_KIND_LABELS[definition.kind]}</small>
                      <p>{definition.definition}</p>
                      {definition.disclosedLabel ? (
                        <small>
                          Stands aside wherever the issuer discloses{" "}
                          {definition.disclosedLabel.toLowerCase()}: the disclosed figure is shown
                          instead, with its page.
                        </small>
                      ) : null}
                    </td>
                    <td>
                      v{definition.version}
                      <small>from {definition.effectiveFrom}</small>
                    </td>
                    <td>
                      {definition.ownerName}
                      <small>{approval(definition)}</small>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
