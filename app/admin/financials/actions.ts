"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffRole } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignmentFor, listTemplateAssignments, listTemplateLines } from "@/lib/data/financials";
import { getExtractor } from "@/lib/adapters/extraction";
import {
  MAGNITUDES,
  PERIOD_TYPES,
  STATEMENT_TYPES,
  type LineInput,
  parsePeriod,
  validateStatement,
  validateSuccession,
  validateTemplateAssignment,
} from "@/lib/financials/validation";

/**
 * Server actions for the figures desk.
 *
 * Each re-checks the caller's role: a server action is a public endpoint, and
 * rendering a form only for the figures desk proves nothing about who posts to
 * it. The database checks again inside every function, which is what actually
 * holds — these are the readable messages.
 *
 * The template decides which figures a submission may carry, and it is read here
 * rather than taken from the form. A form rendered for a bank does not get to
 * post a bank's figures for a cement company because its hidden fields say so.
 */

export interface FinancialsActionState {
  error?: string;
  notice?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function flag(form: FormData, name: string): boolean {
  return form.get(name) === "on" || form.get(name) === "true";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function explain(error: { code?: string; message?: string; details?: string }): string {
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "42501") {
    if (/other than the person who entered/i.test(detail)) {
      return "Someone other than the person who entered these figures has to check them.";
    }
    if (/immutable|append-only/i.test(detail)) {
      return "These figures cannot be edited. Record a new version instead, saying whether the issuer restated them or we are correcting our own entry.";
    }
    return "You may not enter or review financial figures.";
  }
  if (error.code === "23505") {
    if (/appears twice/i.test(detail)) return "The same figure was entered twice.";
    return "That company, statement and period has already been entered at this version. Record a correction instead.";
  }
  if (error.code === "23503") {
    if (/no figure called/i.test(detail)) return "A figure was entered that is not in the catalogue.";
    if (/No such company/i.test(detail)) return "That company is not on the register.";
    if (/No such document/i.test(detail)) return "That filing is not on the register.";
    if (/no provenance record/i.test(detail)) {
      return "That filing has no provenance record, so it cannot support a figure. Re-upload it through the documents desk.";
    }
    return "Something these figures refer to no longer exists.";
  }
  if (error.code === "23514") {
    // The function's own messages are written for a person to read.
    return error.message ?? "That is not allowed.";
  }
  return "The figures could not be saved.";
}

function explainSuccession(error: { code?: string; message?: string; details?: string }): string {
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "42501") {
    if (/fixed once recorded/i.test(detail)) {
      return "A succession claim is fixed once recorded. Reject it and record the correct one, so the register says plainly that it was wrong.";
    }
    if (/other than the person/i.test(detail)) {
      return "Someone other than the person who recorded this has to review it.";
    }
    return "You may not record a succession.";
  }
  if (error.code === "23505") {
    return "That link between those two companies on that date is already recorded.";
  }
  if (error.code === "23503") return "One of those companies is no longer on the register.";
  if (error.code === "23514") return error.message ?? "That is not allowed.";
  return "The succession could not be saved.";
}

function explainSuggestion(error: { code?: string; message?: string; details?: string }): string {
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  if (error.code === "42501") {
    if (/fixed once proposed/i.test(detail)) {
      return "A suggested figure cannot be edited. Reject it and queue a fresh reading.";
    }
    return "You may not queue or review suggested figures.";
  }
  if (error.code === "23505") return "That figure was proposed twice in one reading.";
  if (error.code === "23503") {
    if (/no figure called/i.test(detail)) return "The reading proposed a figure that is not in the catalogue.";
    return "Something that reading refers to no longer exists.";
  }
  if (error.code === "23514") return error.message ?? "That is not allowed.";
  return "The suggestion could not be saved.";
}

function revalidateFinancials(companySlug?: string | null) {
  revalidatePath("/admin/financials");
  if (companySlug) revalidatePath(`/companies/${companySlug}`);
}

/**
 * The figures a submission is allowed to carry, and the ones it must.
 *
 * Derived from the catalogue and the company's assignment for that period, never
 * from the form. The database enforces the same rule; this exists so the analyst
 * is told which figure is wrong instead of being handed a constraint violation.
 */
async function templateContext(companyId: string, statementType: string, periodEnd: string) {
  const [lines, assignments] = await Promise.all([listTemplateLines(), listTemplateAssignments()]);
  const assignment = assignmentFor(assignments, companyId, periodEnd);
  const applicable = lines.filter(
    (line) =>
      line.statementType === statementType &&
      (line.templateId === "core" || (assignment !== null && line.templateId === assignment.templateId)),
  );
  return {
    assignment,
    definitions: applicable,
    required: applicable.filter((line) => line.isRequired).map((line) => line.lineItem),
  };
}

export async function saveStatementAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);

  const companyId = field(form, "companyId");
  const statementType = field(form, "statementType");
  const periodEnd = field(form, "periodEnd");
  if (!UUID.test(companyId)) return { error: "Choose the company these figures belong to." };

  const { definitions, required } = await templateContext(companyId, statementType, periodEnd);

  // One entry per figure the template offers; a blank one is simply not entered.
  const lines: LineInput[] = definitions.map((definition) => ({
    lineItem: definition.lineItem,
    raw: field(form, `figure:${definition.lineItem}`),
    magnitude: field(form, `magnitude:${definition.lineItem}`),
    sourcePage: field(form, `page:${definition.lineItem}`),
    asRestated: flag(form, `restated:${definition.lineItem}`),
    aiAssisted: flag(form, `ai:${definition.lineItem}`),
    note: field(form, `note:${definition.lineItem}`),
  }));

  const validation = validateStatement(
    {
      companyId,
      statementType,
      periodType: field(form, "periodType"),
      periodEnd,
      periodStart: field(form, "periodStart"),
      audited: flag(form, "audited"),
      consolidated: flag(form, "consolidated"),
      currency: field(form, "currency"),
      magnitude: field(form, "magnitude"),
      documentId: field(form, "documentId"),
      publishedAt: field(form, "publishedAt"),
      supersedesId: field(form, "supersedesId"),
      restatementKind: field(form, "restatementKind"),
      correctionReason: field(form, "correctionReason"),
      lines,
    },
    definitions,
    required,
  );
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const prepared = validation.value;
  const { data: savedId, error } = await admin.rpc("record_statement", {
    actor_user: staff.userId,
    p_company_id: prepared.companyId,
    p_statement_type: prepared.statementType,
    p_period_type: prepared.periodType,
    p_period_start: prepared.periodStart,
    p_period_end: prepared.periodEnd,
    p_audited: prepared.audited,
    p_consolidated: prepared.consolidated,
    p_currency: prepared.currency,
    p_magnitude: prepared.magnitude,
    p_document_id: prepared.documentId,
    // The standardised figure is deliberately not sent: the database computes
    // it. Sending it would create a second opinion about what is stored.
    p_lines: prepared.lines.map((line) => ({
      line_item: line.line_item,
      value_reported: line.value_reported,
      presentation: line.presentation,
      magnitude: line.magnitude,
      source_page: line.source_page,
      as_restated: line.as_restated,
      ai_assisted: line.ai_assisted,
      note: line.note,
    })),
    p_published_at: prepared.publishedAt,
    p_supersedes_id: prepared.supersedesId,
    p_restatement_kind: prepared.restatementKind,
    p_correction_reason: prepared.correctionReason,
  });

  if (error) return { error: explain(error) };

  revalidateFinancials(field(form, "companySlug") || null);

  // A fresh entry moves to its own view. Leaving the form in create mode is how
  // a second submit becomes a duplicate period.
  if (typeof savedId === "string") {
    redirect(`/admin/financials?statement=${savedId}`);
  }

  return { notice: "Entered, and waiting for a check." };
}

export async function reviewStatementAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);

  const statementId = field(form, "statementId");
  const decision = field(form, "decision");
  const reason = field(form, "reason");

  if (!UUID.test(statementId)) return { error: "Choose a statement to check." };
  if (decision !== "approved" && decision !== "rejected") return { error: "Approve or reject it." };
  if (decision === "rejected" && !reason) return { error: "Say why the figures are being rejected." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("review_statement", {
    target_statement: statementId,
    actor_user: staff.userId,
    p_decision: decision,
    p_reason: reason || null,
  });

  if (error) return { error: explain(error) };

  revalidateFinancials(field(form, "companySlug") || null);
  return {
    notice:
      decision === "approved"
        ? "Approved. These figures can now be seen, and any earlier version of the same period is superseded."
        : "Rejected. Readers cannot see these figures.",
  };
}

/**
 * Queue a run of the extractor.
 *
 * The extractor is reached through the adapter, never called directly, and the
 * adapter's only implementation reads text a person pasted. Its id is recorded
 * as the batch's provider, so the register says what actually produced a
 * suggestion rather than implying a model was involved.
 */
export async function queueSuggestionsAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);

  const companyId = field(form, "companyId");
  const documentId = field(form, "documentId");
  const statementType = field(form, "statementType");
  const periodEnd = field(form, "periodEnd");
  const text = typeof form.get("pastedText") === "string" ? (form.get("pastedText") as string) : "";

  if (!UUID.test(companyId)) return { error: "Choose the company these figures belong to." };
  if (!UUID.test(documentId)) return { error: "Choose the filing the figures were read from." };
  if (!text.trim()) return { error: "Paste the figures to read." };
  // A statement is a page or two of a filing. Beyond this the paste is not a
  // table, and the figure matcher would be walking a large string for nothing.
  if (text.length > 100_000) {
    return { error: "That is more text than a statement. Paste the table, not the filing." };
  }

  // Checked here rather than left to the table's CHECK. A forged value would be
  // refused either way, but a constraint violation comes back carrying
  // constraint and relation names, and explainSuggestion passes a 23514 message
  // through verbatim because the functions' own messages are written to be read.
  const periodType = field(form, "periodType") || "FY";
  const currency = field(form, "currency") || "NGN";
  const magnitude = field(form, "magnitude") || "thousands";
  if (!(STATEMENT_TYPES as readonly string[]).includes(statementType)) {
    return { error: "Choose which statement this is." };
  }
  if (!(PERIOD_TYPES as readonly string[]).includes(periodType)) {
    return { error: "Choose the reporting period." };
  }
  if (!/^[A-Za-z]{3}$/.test(currency)) {
    return { error: "Give the currency the filing reports in, as a three-letter code." };
  }
  if (!(MAGNITUDES as readonly string[]).includes(magnitude)) {
    return { error: "Choose the scale the filing presents its figures in." };
  }

  const extractor = getExtractor(field(form, "provider") || "manual_paste");
  if (!extractor) {
    return { error: "Figure extraction is switched off, or that extractor is not one we have." };
  }

  const period = parsePeriod({ periodEnd, periodStart: field(form, "periodStart") });
  if (!period) return { error: "Give the period's reporting date." };

  const { definitions } = await templateContext(companyId, statementType, period.periodEnd);
  if (definitions.length === 0) {
    return { error: "This company has no figures defined for that statement. Assign a template first." };
  }

  const result = await extractor.extract({
    documentId,
    text,
    allowedLineItems: definitions.map((line) => ({ lineItem: line.lineItem, label: line.label })),
  });

  if (result.figures.length === 0) {
    return {
      error:
        "Nothing could be read from that. Each line needs a label this desk knows, a figure and a page — " +
        'for example "Revenue 1,234,567 p.40".',
    };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("record_figure_suggestions", {
    actor_user: staff.userId,
    p_company_id: companyId,
    p_document_id: documentId,
    p_statement_type: statementType,
    p_period_type: periodType,
    p_period_start: period.periodStart,
    p_period_end: period.periodEnd,
    p_currency: currency.toUpperCase(),
    p_magnitude: magnitude,
    p_provider: extractor.id,
    p_suggestions: result.figures.map((figure) => ({
      line_item: figure.lineItem,
      value_reported: figure.valueReported,
      presentation: figure.presentation,
      magnitude: figure.magnitude,
      source_page: figure.sourcePage,
      raw_label: figure.rawLabel,
      raw_value: figure.rawValue,
      confidence: figure.confidence,
    })),
    p_model: extractor.model,
    p_prompt_version: extractor.promptVersion,
    p_note: null,
  });

  if (error) return { error: explainSuggestion(error) };

  revalidateFinancials();
  const skipped = result.unmatched.length;
  return {
    notice:
      `${result.figures.length} figure(s) queued for checking` +
      (skipped > 0 ? `, and ${skipped} line(s) left out because they could not be read with certainty.` : ".") +
      " Nothing has been entered: each one has to be confirmed against the page.",
  };
}

export async function decideSuggestionAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);

  const suggestionId = field(form, "suggestionId");
  const decision = field(form, "decision");
  const reason = field(form, "reason");

  if (!UUID.test(suggestionId)) return { error: "Choose a suggestion." };
  if (decision !== "accepted" && decision !== "rejected") return { error: "Accept or reject it." };
  if (decision === "rejected" && !reason) {
    return { error: "Say why it is wrong. That is what stops the next one being wrong the same way." };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("decide_figure_suggestion", {
    target_suggestion: suggestionId,
    actor_user: staff.userId,
    p_decision: decision,
    p_reason: reason || null,
  });

  if (error) return { error: explainSuggestion(error) };

  revalidateFinancials();
  return {
    notice:
      decision === "accepted"
        ? "Accepted. It is still not a figure: enter the statement to record it."
        : "Rejected, with the reason kept.",
  };
}

export async function closeBatchAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);

  const batchId = field(form, "batchId");
  const statementId = field(form, "statementId");
  if (!UUID.test(batchId)) return { error: "Choose a run to close." };
  if (statementId && !UUID.test(statementId)) return { error: "That is not a statement." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("close_suggestion_batch", {
    target_batch: batchId,
    actor_user: staff.userId,
    p_statement_id: statementId || null,
  });

  if (error) return { error: explainSuggestion(error) };

  revalidateFinancials();
  return { notice: statementId ? "Closed against that statement." : "Closed." };
}

/**
 * Records a reading's accepted figures as a statement, so a person who has
 * checked every suggestion against the page does not type the same numbers in
 * a second time.
 *
 * What it does not do is decide anything on the person's behalf. Every figure
 * it records was accepted one at a time by a person; the run must have no
 * suggestion left undecided; rejected ones are left out; and whether the
 * statement is audited and consolidated is asserted on the form, never
 * inferred. The figures go in exactly as read — value as printed, its
 * presentation, its page — through record_statement, which applies the same
 * template, sign and required-line rules as a typed entry, marks each line
 * ai_assisted, and leaves the statement waiting for a check like any other.
 */
export async function recordAcceptedAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);

  const batchId = field(form, "batchId");
  const audited = field(form, "audited");
  const consolidated = field(form, "consolidated");
  if (!UUID.test(batchId)) return { error: "Choose a run to record." };
  if (audited !== "yes" && audited !== "no") return { error: "Say whether the statement is audited." };
  if (consolidated !== "yes" && consolidated !== "no") {
    return { error: "Say whether these are group (consolidated) or company-only figures." };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { data: batch, error: batchError } = await admin
    .from("figure_suggestion_batches")
    .select(
      "id, company_id, document_id, statement_type, period_type, period_start, period_end, currency, magnitude, status",
    )
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) return { error: "The run could not be read." };
  if (!batch) return { error: "That run no longer exists." };
  if (batch.status !== "open") return { error: "That run is already closed." };

  const { data: suggestions, error: suggestionError } = await admin
    .from("figure_suggestions")
    .select("line_item, value_reported, presentation, magnitude, source_page, status")
    .eq("batch_id", batchId);
  if (suggestionError || !suggestions) return { error: "The run's figures could not be read." };

  const pending = suggestions.filter((s) => s.status === "pending").length;
  if (pending > 0) {
    return {
      error: `${pending} figure${pending === 1 ? " is" : "s are"} still to check. Accept or reject each one first.`,
    };
  }
  const accepted = suggestions.filter((s) => s.status === "accepted");
  if (accepted.length === 0) return { error: "Nothing in this run was accepted, so there is nothing to record." };

  const { data: document } = await admin
    .from("documents")
    .select("published_at")
    .eq("id", batch.document_id)
    .maybeSingle();

  const { data: statementId, error } = await admin.rpc("record_statement", {
    actor_user: staff.userId,
    p_company_id: batch.company_id,
    p_statement_type: batch.statement_type,
    p_period_type: batch.period_type,
    p_period_start: batch.period_start,
    p_period_end: batch.period_end,
    p_audited: audited === "yes",
    p_consolidated: consolidated === "yes",
    p_currency: batch.currency,
    p_magnitude: batch.magnitude,
    p_document_id: batch.document_id,
    p_lines: accepted.map((s) => ({
      line_item: s.line_item,
      value_reported: Number(s.value_reported),
      presentation: s.presentation,
      magnitude: s.magnitude,
      source_page: s.source_page,
      as_restated: false,
      ai_assisted: true,
      note: null,
    })),
    p_published_at: document?.published_at ?? null,
    p_supersedes_id: null,
    p_restatement_kind: null,
    p_correction_reason: null,
  });
  if (error) return { error: explain(error) };

  // Tie the run to what it produced, so an AI-assisted statement can be traced
  // back to the reading. The statement stands even if this step fails.
  const { error: closeError } = await admin.rpc("close_suggestion_batch", {
    target_batch: batchId,
    actor_user: staff.userId,
    p_statement_id: statementId,
  });

  revalidateFinancials();
  if (closeError) {
    return {
      notice: `Recorded ${accepted.length} figures, waiting for a check. The run could not be closed against it: ${explainSuggestion(closeError)}`,
    };
  }
  return { notice: `Recorded ${accepted.length} figures as a statement, waiting for a check.` };
}

export async function recordSuccessionAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  // A succession is a fact about corporate identity rather than a figure, so the
  // register's analyst may record it as well as the figures desk — matching the
  // function's own check.
  const staff = await requireStaffRole(["financial_analyst", "analyst"]);

  const validation = validateSuccession({
    predecessorCompanyId: field(form, "predecessorCompanyId"),
    successorCompanyId: field(form, "successorCompanyId"),
    relationship: field(form, "relationship"),
    effectiveOn: field(form, "effectiveOn"),
    sourceKind: field(form, "sourceKind"),
    documentId: field(form, "documentId"),
    sourcePage: field(form, "sourcePage"),
    announcementId: field(form, "announcementId"),
    note: field(form, "note"),
  });
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const prepared = validation.value;
  const { error } = await admin.rpc("record_company_succession", {
    actor_user: staff.userId,
    p_predecessor_company_id: prepared.predecessorCompanyId,
    p_successor_company_id: prepared.successorCompanyId,
    p_relationship: prepared.relationship,
    p_effective_on: prepared.effectiveOn,
    p_effective_precision: prepared.effectivePrecision,
    p_document_id: prepared.documentId,
    p_source_page: prepared.sourcePage,
    p_announcement_id: prepared.announcementId,
    p_note: prepared.note,
  });

  if (error) return { error: explainSuccession(error) };

  revalidateFinancials();
  return {
    notice:
      "Recorded, and waiting for review. The predecessor's figures stay under the predecessor — they are linked, never merged into one series.",
  };
}

export async function reviewSuccessionAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst", "analyst"]);

  const successionId = field(form, "successionId");
  const decision = field(form, "decision");
  const reason = field(form, "reason");

  if (!UUID.test(successionId)) return { error: "Choose a succession to review." };
  if (decision !== "approved" && decision !== "rejected") return { error: "Approve or reject it." };
  if (decision === "rejected" && !reason) return { error: "Say why the succession is being rejected." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("review_company_succession", {
    target_succession: successionId,
    actor_user: staff.userId,
    p_decision: decision,
    p_reason: reason || null,
  });

  if (error) return { error: explainSuccession(error) };

  revalidateFinancials();
  return {
    notice:
      decision === "approved"
        ? "Approved. The link between the two entities can now be seen."
        : "Rejected. Readers cannot see this link.",
  };
}

export async function assignTemplateAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);

  const validation = validateTemplateAssignment({
    companyId: field(form, "companyId"),
    templateId: field(form, "templateId"),
    validFrom: field(form, "validFrom"),
    note: field(form, "note"),
  });
  if (!validation.ok) return { error: validation.error };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("assign_company_template", {
    actor_user: staff.userId,
    p_company_id: validation.value.companyId,
    p_template_id: validation.value.templateId,
    p_valid_from: validation.value.validFrom,
    p_note: validation.value.note,
  });

  if (error) return { error: explain(error) };

  revalidateFinancials();
  return {
    notice:
      "Assigned. Periods already entered keep reading under the template that was in force when they were entered.",
  };
}

/**
 * Deciding on a formula.
 *
 * Methodology is a platform-administration act: the figures desk enters and
 * checks figures, and deciding what a ratio means is a different job. Every
 * action re-checks that, names a reason, and leaves the real enforcement to the
 * database — these are the readable messages, not the guard.
 */

function explainMethodology(error: { code?: string; message?: string; details?: string }): string {
  const detail = `${error.message ?? ""} ${error.details ?? ""}`;
  if (/other than the person who recorded/i.test(detail)) {
    return "Someone other than the person who recorded this formula has to approve it. Two-person review is switched on.";
  }
  if (/newer version of/i.test(detail)) {
    return "A newer version of this metric has been recorded since. Record yours again against the current version.";
  }
  if (/already been decided/i.test(detail)) {
    return "Somebody has already decided on this version. Record a new one rather than revisiting it.";
  }
  if (/approval cannot be withdrawn/i.test(detail)) {
    return "An approval cannot be withdrawn. Retire the version and record a new one.";
  }
  if (error.code === "42501") {
    return "Only a platform administrator may decide on a metric definition.";
  }
  return error.message ?? "That could not be recorded.";
}

export async function decideMetricDefinitionAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);
  if (!staff.isPlatformAdmin) {
    return { error: "Only a platform administrator may decide on a metric definition." };
  }

  const definitionId = field(form, "definitionId");
  const decision = field(form, "decision");
  const reason = field(form, "reason");

  if (!UUID.test(definitionId)) return { error: "Choose a formula to decide on." };
  if (decision !== "approved" && decision !== "rejected") return { error: "Approve or reject it." };
  if (!reason) {
    return {
      error:
        decision === "approved"
          ? "Say what you checked. The reason is published with the formula."
          : "Say why the formula is being rejected. The reason is published with it.",
    };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc("decide_metric_definition", {
    target: definitionId,
    actor_user: staff.userId,
    p_decision: decision,
    p_reason: reason,
  });
  if (error) return { error: explainMethodology(error) };

  revalidateFinancials(null);
  return {
    notice:
      decision === "approved"
        ? "Approved and published. Ratios under this formula now appear on company pages, with the version recorded beside each figure."
        : "Rejected, with the reason recorded. Nothing was put back into service; a published version this replaced stays retired until somebody reinstates it deliberately.",
  };
}

export async function retireMetricDefinitionAction(
  _prev: FinancialsActionState,
  form: FormData,
): Promise<FinancialsActionState> {
  const staff = await requireStaffRole(["financial_analyst"]);
  if (!staff.isPlatformAdmin) {
    return { error: "Only a platform administrator may retire a metric definition." };
  }

  const definitionId = field(form, "definitionId");
  const reason = field(form, "reason");
  const reinstate = flag(form, "reinstate");

  if (!UUID.test(definitionId)) return { error: "Choose a formula." };
  if (!reason) return { error: "Say why. The reason is recorded in the audit log." };

  const admin = createAdminClient();
  if (!admin) return { error: "Server credentials are not configured." };

  const { error } = await admin.rpc(
    reinstate ? "reinstate_metric_definition" : "retire_metric_definition",
    { target: definitionId, actor_user: staff.userId, p_reason: reason },
  );
  if (error) return { error: explainMethodology(error) };

  revalidateFinancials(null);
  return {
    notice: reinstate
      ? "Back in service. Ratios under this formula appear again."
      : "Retired. The metric now reads as awaiting approval, which is the truth: there is a formula on file and nobody is standing behind it.",
  };
}
