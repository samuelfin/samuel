import "server-only";
import { requireStaffRole } from "@/lib/auth/staff";
import { createClient } from "@/lib/supabase/server";
import type { Magnitude, Presentation, StandardSign, StatementType, UnitKind } from "@/lib/financials/validation";

/**
 * Financial statements, the templates they are entered under, and the catalogue
 * that defines every figure.
 *
 * Read through the caller's own session, so row-level security decides what is
 * visible: the figures desk sees the review queue, a reader sees an approved
 * statement of an approved company whose dataset is licensed for display. The
 * loaders throw rather than returning an empty list, because an empty table and
 * a broken query look identical on the page, and "this company has published no
 * figures" is a claim we should not make by accident.
 */

function reportFailure(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

export interface CatalogueLine {
  lineItem: string;
  label: string;
  statementType: StatementType;
  unitKind: UnitKind;
  unitLabel: string;
  standardSign: StandardSign;
  definitionNote: string | null;
}

export interface TemplateSummary {
  id: string;
  name: string;
  scope: "core" | "sector";
  description: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface TemplateLine extends CatalogueLine {
  templateId: string;
  templateName: string;
  isHeadline: boolean;
  isRequired: boolean;
  sortOrder: number;
}

export interface StatementLine {
  lineItem: string;
  label: string;
  unitKind: UnitKind;
  unitLabel: string;
  standardSign: StandardSign;
  valueReported: number;
  valueStandardised: number;
  reportedMagnitude: Magnitude;
  reportedPresentation: Presentation;
  sourcePage: number;
  asRestated: boolean;
  aiAssisted: boolean;
  note: string | null;
  sortOrder: number;
}

export interface StatementForDesk {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  statementType: StatementType;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  audited: boolean;
  consolidated: boolean;
  currency: string;
  magnitude: Magnitude;
  publishedAt: string | null;
  documentId: string | null;
  documentTitle: string | null;
  templateId: string | null;
  version: number;
  supersedesId: string | null;
  restatementKind: string | null;
  correctionReason: string | null;
  reviewStatus: "pending" | "approved" | "rejected" | "superseded";
  reviewSelfApproved: boolean;
  reviewedAt: string | null;
  aiAssisted: boolean;
  lines: StatementLine[];
}

export interface CompanyTemplateAssignment {
  id: string;
  companyId: string;
  templateId: string;
  templateName: string;
  validFrom: string;
  validTo: string | null;
  note: string | null;
}

/**
 * Projections are named constants so the embed guard can resolve them, and so a
 * hint cannot be added in one place and forgotten in another.
 *
 * financial_statements holds one foreign key to documents, so `documents(title)`
 * is unambiguous here — unlike company_roles, which points at documents twice
 * and broke the leadership desk in 3b.
 */
const CATALOGUE_COLUMNS = "line_item, label, statement_type, unit_kind, unit_label, standard_sign, definition_note";

const TEMPLATE_LINE_COLUMNS =
  "template_id, line_item, is_headline, is_required, sort_order, " +
  "statement_templates(name), " +
  "statement_line_catalogue(label, statement_type, unit_kind, unit_label, standard_sign, definition_note)";

const STATEMENT_COLUMNS =
  "id, company_id, statement_type, period_type, period_start, period_end, audited, consolidated, " +
  "currency, magnitude, published_at, document_id, template_id, version, supersedes_id, " +
  "restatement_kind, correction_reason, review_status, review_self_approved, reviewed_at, ai_assisted, " +
  "companies(name, slug), documents(title), " +
  "financial_statement_lines(line_item, value_reported, value_standardised, reported_magnitude, " +
  "reported_presentation, source_page, as_restated, ai_assisted, note)";

const ASSIGNMENT_COLUMNS = "id, company_id, template_id, valid_from, valid_to, note, statement_templates(name)";

interface CatalogueRow {
  line_item: string;
  label: string;
  statement_type: StatementType;
  unit_kind: UnitKind;
  unit_label: string;
  standard_sign: StandardSign;
  definition_note: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  scope: "core" | "sector";
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

interface TemplateLineRow {
  template_id: string;
  line_item: string;
  is_headline: boolean;
  is_required: boolean;
  sort_order: number;
  statement_templates: { name: string } | null;
  statement_line_catalogue: {
    label: string;
    statement_type: StatementType;
    unit_kind: UnitKind;
    unit_label: string;
    standard_sign: StandardSign;
    definition_note: string | null;
  } | null;
}

interface StatementLineRow {
  line_item: string;
  value_reported: number | string | null;
  value_standardised: number | string;
  reported_magnitude: Magnitude | null;
  reported_presentation: Presentation | null;
  source_page: number | null;
  as_restated: boolean;
  ai_assisted: boolean;
  note: string | null;
}

interface StatementRow {
  id: string;
  company_id: string;
  statement_type: StatementType;
  period_type: string;
  period_start: string;
  period_end: string;
  audited: boolean;
  consolidated: boolean;
  currency: string;
  magnitude: Magnitude;
  published_at: string | null;
  document_id: string | null;
  template_id: string | null;
  version: number;
  supersedes_id: string | null;
  restatement_kind: string | null;
  correction_reason: string | null;
  review_status: "pending" | "approved" | "rejected" | "superseded";
  review_self_approved: boolean;
  reviewed_at: string | null;
  ai_assisted: boolean;
  companies: { name: string; slug: string } | null;
  documents: { title: string } | null;
  financial_statement_lines: StatementLineRow[] | null;
}

interface AssignmentRow {
  id: string;
  company_id: string;
  template_id: string;
  valid_from: string;
  valid_to: string | null;
  note: string | null;
  statement_templates: { name: string } | null;
}

/** Postgres `numeric` arrives as a string, because a double would lose it. */
function toNumber(value: number | string | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number(value);
}

export async function listCatalogue(): Promise<CatalogueLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("statement_line_catalogue").select(CATALOGUE_COLUMNS).order("line_item");
  if (error || !data) reportFailure("the figure catalogue", error);
  return (data as unknown as CatalogueRow[]).map((row) => ({
    lineItem: row.line_item,
    label: row.label,
    statementType: row.statement_type,
    unitKind: row.unit_kind,
    unitLabel: row.unit_label,
    standardSign: row.standard_sign,
    definitionNote: row.definition_note,
  }));
}

export async function listTemplates(): Promise<TemplateSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("statement_templates")
    .select("id, name, scope, description, is_active, sort_order")
    .order("sort_order");
  if (error || !data) reportFailure("the statement templates", error);
  return (data as unknown as TemplateRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    scope: row.scope,
    description: row.description,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  }));
}

/** Every line of every template, so the desk builds a form without a round trip each. */
export async function listTemplateLines(): Promise<TemplateLine[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("statement_template_lines")
    .select(TEMPLATE_LINE_COLUMNS)
    .order("template_id")
    .order("sort_order");
  if (error || !data) reportFailure("the template lines", error);

  const rows = data as unknown as TemplateLineRow[];
  return rows.flatMap((row) => {
    const definition = row.statement_line_catalogue;
    if (!definition) return [];
    return [
      {
        templateId: row.template_id,
        templateName: row.statement_templates?.name ?? row.template_id,
        lineItem: row.line_item,
        label: definition.label,
        statementType: definition.statement_type,
        unitKind: definition.unit_kind,
        unitLabel: definition.unit_label,
        standardSign: definition.standard_sign,
        definitionNote: definition.definition_note,
        isHeadline: row.is_headline,
        isRequired: row.is_required,
        sortOrder: row.sort_order,
      },
    ];
  });
}

function toStatement(row: StatementRow, definitions: Map<string, TemplateLine>): StatementForDesk {
  const lines = (row.financial_statement_lines ?? []).map((line) => {
    const definition = definitions.get(line.line_item);
    return {
      lineItem: line.line_item,
      label: definition?.label ?? line.line_item,
      unitKind: definition?.unitKind ?? ("currency" as UnitKind),
      unitLabel: definition?.unitLabel ?? "",
      standardSign: definition?.standardSign ?? ("signed" as StandardSign),
      valueReported: toNumber(line.value_reported),
      valueStandardised: toNumber(line.value_standardised),
      reportedMagnitude: line.reported_magnitude ?? "units",
      reportedPresentation: line.reported_presentation ?? "plain",
      sourcePage: line.source_page ?? 0,
      asRestated: line.as_restated,
      aiAssisted: line.ai_assisted,
      note: line.note,
      sortOrder: definition?.sortOrder ?? 9999,
    };
  });
  lines.sort((a, b) => a.sortOrder - b.sortOrder || a.lineItem.localeCompare(b.lineItem));

  return {
    id: row.id,
    companyId: row.company_id,
    companyName: row.companies?.name ?? "Unknown company",
    companySlug: row.companies?.slug ?? "",
    statementType: row.statement_type,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    audited: row.audited,
    consolidated: row.consolidated,
    currency: row.currency,
    magnitude: row.magnitude,
    publishedAt: row.published_at,
    documentId: row.document_id,
    documentTitle: row.documents?.title ?? null,
    templateId: row.template_id,
    version: row.version,
    supersedesId: row.supersedes_id,
    restatementKind: row.restatement_kind,
    correctionReason: row.correction_reason,
    reviewStatus: row.review_status,
    reviewSelfApproved: row.review_self_approved,
    reviewedAt: row.reviewed_at,
    aiAssisted: row.ai_assisted,
    lines,
  };
}

export async function listStatementsForDesk(limit = 200): Promise<StatementForDesk[]> {
  await requireStaffRole(["financial_analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_statements")
    .select(STATEMENT_COLUMNS)
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) reportFailure("the entered statements", error);

  const definitions = new Map((await listTemplateLines()).map((line) => [line.lineItem, line]));
  return (data as unknown as StatementRow[]).map((row) => toStatement(row, definitions));
}

export async function getStatementForDesk(id: string): Promise<StatementForDesk | null> {
  await requireStaffRole(["financial_analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_statements")
    .select(STATEMENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) reportFailure("that statement", error);
  if (!data) return null;

  const definitions = new Map((await listTemplateLines()).map((line) => [line.lineItem, line]));
  return toStatement(data as unknown as StatementRow, definitions);
}

export interface CitableFiling {
  id: string;
  title: string;
  companyId: string | null;
  kind: string;
  periodEnd: string | null;
}

/**
 * The filings a figure may cite: approved, with a licence a reader could act on.
 *
 * Deliberately not `listCitableSources` from the editorial layer. That one is
 * scoped to the editorial roles and also offers announcements, and an
 * announcement is not a statement of account — record_statement would refuse it
 * anyway, so offering it here would hand the analyst a source the database then
 * rejects.
 */
export async function listCitableFilings(limit = 200): Promise<CitableFiling[]> {
  await requireStaffRole(["financial_analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, company_id, kind, period_end")
    .eq("review_status", "approved")
    .neq("licence_class", "unverified")
    .order("period_end", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error || !data) reportFailure("the filings figures can cite", error);

  return (
    data as unknown as Array<{
      id: string;
      title: string;
      company_id: string | null;
      kind: string;
      period_end: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    title: row.title,
    companyId: row.company_id,
    kind: row.kind,
    periodEnd: row.period_end,
  }));
}

export interface CitableAnnouncement {
  id: string;
  label: string;
}

/**
 * Published announcements, for a succession that rests on one rather than on a
 * filing page. Scoped to the two roles that may record a succession, and
 * filtered on `status` — the announcement desk's own column, whose vocabulary is
 * published / superseded / withdrawn. Only the first is something a reader can
 * still follow, and reading the wrong column name here is exactly the fault
 * 202611230002 fixed in the database guard.
 */
export async function listCitableAnnouncements(limit = 100): Promise<CitableAnnouncement[]> {
  await requireStaffRole(["financial_analyst", "analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select("id, headline")
    .eq("status", "published")
    .order("announced_at", { ascending: false })
    .limit(limit);
  if (error || !data) reportFailure("published announcements", error);
  return (data as unknown as Array<{ id: string; headline: string }>).map((row) => ({
    id: row.id,
    label: row.headline,
  }));
}

export async function listTemplateAssignments(): Promise<CompanyTemplateAssignment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_statement_templates")
    .select(ASSIGNMENT_COLUMNS)
    .order("valid_from", { ascending: false });
  if (error || !data) reportFailure("the template assignments", error);
  return (data as unknown as AssignmentRow[]).map((row) => ({
    id: row.id,
    companyId: row.company_id,
    templateId: row.template_id,
    templateName: row.statement_templates?.name ?? row.template_id,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    note: row.note,
  }));
}

/**
 * The template a company is entered under for a given period — not simply its
 * current one. A year already entered keeps reading under the template that was
 * in force then, which is why the assignment is effective-dated at all.
 */
export function assignmentFor(
  assignments: readonly CompanyTemplateAssignment[],
  companyId: string,
  periodEnd: string,
): CompanyTemplateAssignment | null {
  const candidates = assignments
    .filter(
      (a) => a.companyId === companyId && a.validFrom <= periodEnd && (a.validTo === null || a.validTo > periodEnd),
    )
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  return candidates[0] ?? null;
}

export interface SuccessionForDesk {
  id: string;
  predecessorId: string;
  predecessorName: string;
  predecessorSlug: string;
  predecessorListingStatus: string;
  successorId: string;
  successorName: string;
  successorSlug: string;
  relationship: string;
  effectiveOn: string;
  effectivePrecision: "day" | "month" | "year";
  note: string | null;
  documentId: string | null;
  documentTitle: string | null;
  sourcePage: number | null;
  announcementId: string | null;
  announcementHeadline: string | null;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewSelfApproved: boolean;
  reviewedAt: string | null;
}

/**
 * company_successions points at companies twice — the predecessor and the
 * successor — so a bare `companies(name)` is ambiguous and PostgREST refuses the
 * whole query. The `!column` hints are what make it resolvable, and they name the
 * column rather than the constraint so a later rename cannot quietly break them.
 * This is the fault that broke the leadership desk on its first request in 3b.
 */
const SUCCESSION_COLUMNS =
  "id, predecessor_company_id, successor_company_id, relationship, effective_on, effective_precision, " +
  "note, document_id, source_page, announcement_id, review_status, review_self_approved, reviewed_at, " +
  "predecessor:companies!predecessor_company_id(name, slug, listing_status), " +
  "successor:companies!successor_company_id(name, slug), " +
  "documents!document_id(title), announcements!announcement_id(headline)";

interface SuccessionRow {
  id: string;
  predecessor_company_id: string;
  successor_company_id: string;
  relationship: string;
  effective_on: string;
  effective_precision: "day" | "month" | "year";
  note: string | null;
  document_id: string | null;
  source_page: number | null;
  announcement_id: string | null;
  review_status: "pending" | "approved" | "rejected";
  review_self_approved: boolean;
  reviewed_at: string | null;
  predecessor: { name: string; slug: string; listing_status: string } | null;
  successor: { name: string; slug: string } | null;
  documents: { title: string } | null;
  announcements: { headline: string } | null;
}

export async function listSuccessionsForDesk(): Promise<SuccessionForDesk[]> {
  await requireStaffRole(["financial_analyst", "analyst"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_successions")
    .select(SUCCESSION_COLUMNS)
    .order("effective_on", { ascending: false });
  if (error || !data) reportFailure("the succession records", error);

  return (data as unknown as SuccessionRow[]).map((row) => ({
    id: row.id,
    predecessorId: row.predecessor_company_id,
    predecessorName: row.predecessor?.name ?? "Unknown company",
    predecessorSlug: row.predecessor?.slug ?? "",
    predecessorListingStatus: row.predecessor?.listing_status ?? "unlisted",
    successorId: row.successor_company_id,
    successorName: row.successor?.name ?? "Unknown company",
    successorSlug: row.successor?.slug ?? "",
    relationship: row.relationship,
    effectiveOn: row.effective_on,
    effectivePrecision: row.effective_precision,
    note: row.note,
    documentId: row.document_id,
    documentTitle: row.documents?.title ?? null,
    sourcePage: row.source_page,
    announcementId: row.announcement_id,
    announcementHeadline: row.announcements?.headline ?? null,
    reviewStatus: row.review_status,
    reviewSelfApproved: row.review_self_approved,
    reviewedAt: row.reviewed_at,
  }));
}

export interface CoverageCell {
  companyId: string;
  companyName: string;
  year: number;
  statementType: StatementType;
  status: "approved" | "pending" | "rejected" | "absent";
}

/**
 * What has been entered and what has not — the honest input to the coverage
 * score 3d will publish. "absent" is a real answer, and reads as "Pending
 * verification" on the page rather than as a zero.
 */
export function coverageGrid(
  statements: readonly StatementForDesk[],
  companies: readonly { id: string; name: string }[],
  years: readonly number[],
  statementTypes: readonly StatementType[],
): CoverageCell[] {
  const cells: CoverageCell[] = [];
  for (const company of companies) {
    for (const year of years) {
      for (const statementType of statementTypes) {
        const matching = statements.filter(
          (s) =>
            s.companyId === company.id &&
            s.statementType === statementType &&
            Number(s.periodEnd.slice(0, 4)) === year &&
            s.reviewStatus !== "superseded",
        );
        // The best status wins. A rejected first attempt followed by an approved
        // second is covered, and showing it as rejected would send an analyst to
        // re-enter a year that is already done.
        const status = matching.some((s) => s.reviewStatus === "approved")
          ? "approved"
          : matching.some((s) => s.reviewStatus === "pending")
            ? "pending"
            : matching.some((s) => s.reviewStatus === "rejected")
              ? "rejected"
              : "absent";
        cells.push({ companyId: company.id, companyName: company.name, year, statementType, status });
      }
    }
  }
  return cells;
}
