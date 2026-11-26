"use client";

import { useActionState } from "react";
import {
  decideMetricDefinitionAction,
  retireMetricDefinitionAction,
  type FinancialsActionState,
} from "@/app/admin/financials/actions";
import {
  formulaText,
  METRIC_GROUP_LABELS,
  METRIC_KIND_LABELS,
  METRIC_STATUS_LABELS,
  type MetricDefinition,
  type MetricGroup,
} from "@/lib/metrics/definitions";

/**
 * The metric register, as the desk reads and decides it.
 *
 * A reported figure can be checked against a page. A calculated one can only be
 * checked against its definition, so the definition is visible here in full:
 * what it divides, by what, who recorded it and why, who decided and why, and
 * which version is published.
 *
 * Nothing is editable. A formula is corrected by recording a new version, and
 * the only acts available here are the ones a person must take — approve,
 * reject, retire, reinstate — each with a reason that is kept.
 */

function approval(definition: MetricDefinition): string {
  if (definition.rejectedAt) {
    return `Rejected${definition.decisionReason ? `: ${definition.decisionReason}` : ""}`;
  }
  if (!definition.approvedAt) return "Awaiting approval — nobody has decided on this yet";
  const who = definition.approvedByName ?? "a platform administrator";
  return definition.selfApproved ? `Approved by ${who}, who also recorded it` : `Approved by ${who}`;
}

function DecisionForm({ definition }: { definition: MetricDefinition }) {
  const [state, action, pending] = useActionState<FinancialsActionState, FormData>(
    decideMetricDefinitionAction,
    {},
  );

  return (
    <form action={action} className="review-decision">
      <input type="hidden" name="definitionId" value={definition.id} />
      <label>
        What you checked, or why not
        <input name="reason" placeholder="Checked against the issuer's own wording on page 39" required />
      </label>
      <button name="decision" value="approved" disabled={pending}>
        Approve and publish
      </button>
      <button name="decision" value="rejected" disabled={pending}>
        Reject
      </button>
      {state.error ? <p className="auth-message">{state.error}</p> : null}
      {state.notice ? <p className="auth-message">{state.notice}</p> : null}
    </form>
  );
}

function ServiceForm({ definition, reinstate }: { definition: MetricDefinition; reinstate: boolean }) {
  const [state, action, pending] = useActionState<FinancialsActionState, FormData>(
    retireMetricDefinitionAction,
    {},
  );

  return (
    <form action={action} className="review-decision">
      <input type="hidden" name="definitionId" value={definition.id} />
      <input type="hidden" name="reinstate" value={reinstate ? "true" : "false"} />
      <label>
        Reason
        <input
          name="reason"
          placeholder={
            reinstate
              ? "Putting the previous definition back after the correction was rejected"
              : "Taking this out of service until the economist has reviewed it"
          }
          required
        />
      </label>
      <button disabled={pending}>{reinstate ? "Put back into service" : "Retire"}</button>
      {state.error ? <p className="auth-message">{state.error}</p> : null}
      {state.notice ? <p className="auth-message">{state.notice}</p> : null}
    </form>
  );
}

export function MetricLibrary({
  definitions,
  canDecide,
}: {
  definitions: readonly MetricDefinition[];
  canDecide: boolean;
}) {
  if (definitions.length === 0) {
    return <p className="empty-state">No metric definitions yet.</p>;
  }

  // Only the newest version of a metric can be decided on: an earlier one no
  // longer supersedes the latest, and the database refuses it for that reason.
  const newestVersion = new Map<string, number>();
  for (const definition of definitions) {
    newestVersion.set(
      definition.code,
      Math.max(newestVersion.get(definition.code) ?? 0, definition.version),
    );
  }
  const decidable = (definition: MetricDefinition) =>
    newestVersion.get(definition.code) === definition.version &&
    definition.status === "awaiting_approval";

  const waiting = definitions.filter(decidable);
  const published = definitions.filter((d) => d.status === "published");
  const groups = [...new Set(definitions.map((d) => d.group))] as MetricGroup[];

  return (
    <div className="metric-library">
      <p className="form-note">
        {published.length} published, {waiting.length} awaiting approval. Interim methodology: no
        economist has reviewed these formulas, and every ratio built from them carries that label. A
        formula computes nothing until a person approves it, and a figure is never estimated to fill
        one — a missing input makes the answer &ldquo;Not available&rdquo;, with the reason stated.
        {canDecide
          ? " Approving a version a migration recorded counts as self-approval, because the recorder is nobody, and it is flagged as such."
          : " Only a platform administrator may decide on a formula."}
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
                <th>Standing</th>
              </tr>
            </thead>
            <tbody>
              {definitions
                .filter((definition) => definition.group === group)
                .map((definition) => (
                  <tr key={definition.id} data-status={definition.status}>
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
                      {definition.recordReason ? (
                        <small>Recorded because: {definition.recordReason}</small>
                      ) : null}
                    </td>
                    <td>
                      v{definition.version}
                      <small>{METRIC_STATUS_LABELS[definition.status]}</small>
                      <small>from {definition.effectiveFrom}</small>
                    </td>
                    <td>
                      {definition.ownerName}
                      <small>{approval(definition)}</small>
                      {canDecide && decidable(definition) ? <DecisionForm definition={definition} /> : null}
                      {canDecide && definition.status === "published" ? (
                        <ServiceForm definition={definition} reinstate={false} />
                      ) : null}
                      {canDecide && definition.status === "retired" ? (
                        <ServiceForm definition={definition} reinstate />
                      ) : null}
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
