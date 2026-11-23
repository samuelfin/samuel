"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffRole } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignmentFor, listTemplateAssignments, listTemplateLines } from "@/lib/data/financials";
import {
  type LineInput,
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
