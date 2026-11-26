import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import type {
  MetricDefinition,
  MetricGroup,
  MetricInputRole,
  MetricKind,
  MetricResultUnit,
  MetricStatus,
  UnavailableReason,
} from "@/lib/metrics/definitions";

/**
 * The metric register and its answers, read for display.
 *
 * Nothing here calculates anything. A ratio is computed in the database from
 * approved figures, under a definition that is itself approved data; this module
 * carries the definitions, the values and the figures each value used. Keeping
 * the arithmetic in one place is the point — the lesson of 3c was that two
 * pieces of code computing the same number eventually disagree.
 *
 * Read through the caller's own session, so row-level security decides what is
 * visible: a published definition is methodology and anyone signed in may read
 * it, a proposal is the desk's, and a ratio exists only where its inputs do.
 */

function reportFailure(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

const DEFINITION_COLUMNS =
  "id, code, version, label, definition, kind, result_unit, decimals, metric_group, " +
  "template_id, disclosed_line_item, window_years, owner_name, approved_by_name, approved_at, " +
  "review_self_approved, rejected_at, decision_reason, record_reason, created_by, " +
  "effective_from, is_active, sort_order, " +
  "statement_templates(name), " +
  "metric_definition_inputs(role, line_item, sign, use_absolute, sort_order)";

interface DefinitionRow {
  id: string;
  code: string;
  version: number;
  label: string;
  definition: string;
  kind: MetricKind;
  result_unit: MetricResultUnit;
  decimals: number;
  metric_group: MetricGroup;
  template_id: string | null;
  disclosed_line_item: string | null;
  window_years: number | null;
  owner_name: string;
  approved_by_name: string | null;
  approved_at: string | null;
  review_self_approved: boolean;
  rejected_at: string | null;
  decision_reason: string | null;
  record_reason: string | null;
  created_by: string | null;
  effective_from: string;
  is_active: boolean;
  sort_order: number;
  statement_templates: { name: string } | null;
  metric_definition_inputs: Array<{
    role: MetricInputRole;
    line_item: string;
    sign: number;
    use_absolute: boolean;
    sort_order: number;
  }> | null;
}

function statusOf(row: {
  is_active: boolean;
  approved_at: string | null;
  rejected_at: string | null;
}): MetricStatus {
  if (row.is_active) return "published";
  if (row.rejected_at) return "rejected";
  if (row.approved_at) return "retired";
  return "awaiting_approval";
}

function toDefinition(row: DefinitionRow, labels: Map<string, string>): MetricDefinition {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    label: row.label,
    definition: row.definition,
    kind: row.kind,
    resultUnit: row.result_unit,
    decimals: row.decimals,
    group: row.metric_group,
    templateId: row.template_id,
    templateName: row.statement_templates?.name ?? null,
    disclosedLineItem: row.disclosed_line_item,
    disclosedLabel: row.disclosed_line_item
      ? (labels.get(row.disclosed_line_item) ?? row.disclosed_line_item)
      : null,
    windowYears: row.window_years,
    ownerName: row.owner_name,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    selfApproved: row.review_self_approved,
    rejectedAt: row.rejected_at,
    decisionReason: row.decision_reason,
    recordReason: row.record_reason,
    recordedBy: row.created_by,
    effectiveFrom: row.effective_from,
    isActive: row.is_active,
    status: statusOf(row),
    sortOrder: row.sort_order,
    inputs: (row.metric_definition_inputs ?? [])
      .map((input) => ({
        role: input.role,
        lineItem: input.line_item,
        label: labels.get(input.line_item) ?? input.line_item,
        sign: (input.sign < 0 ? -1 : 1) as 1 | -1,
        useAbsolute: input.use_absolute,
        sortOrder: input.sort_order,
      }))
      .sort((a, b) => a.role.localeCompare(b.role) || a.sortOrder - b.sortOrder),
  };
}

async function catalogueLabels(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("statement_line_catalogue").select("line_item, label");
  if (error || !data) reportFailure("the figure catalogue", error);
  return new Map((data as Array<{ line_item: string; label: string }>).map((l) => [l.line_item, l.label]));
}

/**
 * Metric definitions with their inputs named as a reader would see them.
 *
 * `published` alone by default, which is what a reader may be shown. The desk
 * passes `all` and gets the proposals and the decisions too — row-level security
 * is what actually decides, so a reader asking for everything still receives
 * only what has been published.
 */
export async function listMetricDefinitions(
  options: { scope?: "published" | "all" } = {},
): Promise<MetricDefinition[]> {
  const user = await requireUser();
  // Local preview runs without Supabase, where createClient() throws.
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  let query = supabase.from("metric_definitions").select(DEFINITION_COLUMNS);
  if (options.scope !== "all") query = query.eq("is_active", true);

  const { data, error } = await query.order("metric_group").order("sort_order").order("version");
  if (error || !data) reportFailure("the metric definitions", error);

  const labels = await catalogueLabels();
  return (data as unknown as DefinitionRow[]).map((row) => toDefinition(row, labels));
}

export interface MetricStatusRow {
  id: string;
  code: string;
  label: string;
  group: MetricGroup;
  templateId: string | null;
  version: number;
  sortOrder: number;
  status: MetricStatus;
}

/**
 * What a reader may know about a formula nobody has published: that the metric
 * exists, what it is called, and that it is waiting. Not the formula itself.
 */
export async function listMetricStatuses(): Promise<MetricStatusRow[]> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("metric_definition_status")
    .select("id, code, label, metric_group, template_id, version, sort_order, status")
    .order("metric_group")
    .order("sort_order")
    .order("version");
  if (error || !data) reportFailure("the metric statuses", error);

  return (
    data as Array<{
      id: string;
      code: string;
      label: string;
      metric_group: MetricGroup;
      template_id: string | null;
      version: number;
      sort_order: number;
      status: MetricStatus;
    }>
  ).map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    group: row.metric_group,
    templateId: row.template_id,
    version: row.version,
    sortOrder: row.sort_order,
    status: row.status,
  }));
}

export type MetricValueStatus = "available" | "disclosed" | "not_available";

export interface CompanyMetricValue {
  code: string;
  definitionVersion: number;
  kind: MetricKind;
  resultUnit: MetricResultUnit;
  status: MetricValueStatus;
  reason: UnavailableReason | null;
  value: string | null;
  financialYear: number;
  periodEnd: string;
  consolidated: boolean;
  currency: string;
  disclosedLineItem: string | null;
  disclosedPage: number | null;
  priorPeriodEnd: string | null;
  windowSpan: number | null;
  missingInputs: string[];
  /** Null where there is no figure to describe. Never read as audited. */
  allAudited: boolean | null;
  anyRestated: boolean | null;
  anyAiAssisted: boolean | null;
}

const VALUE_COLUMNS =
  "code, definition_version, kind, result_unit, status, reason, value, financial_year, period_end, " +
  "consolidated, currency, disclosed_line_item, disclosed_page, prior_period_end, window_span, " +
  "missing_inputs, all_audited, any_restated, any_ai_assisted";

interface ValueRow {
  code: string;
  definition_version: number;
  kind: MetricKind;
  result_unit: MetricResultUnit;
  status: MetricValueStatus;
  reason: UnavailableReason | null;
  value: string | number | null;
  financial_year: number;
  period_end: string;
  consolidated: boolean;
  currency: string;
  disclosed_line_item: string | null;
  disclosed_page: number | null;
  prior_period_end: string | null;
  window_span: number | null;
  missing_inputs: string[] | null;
  all_audited: boolean | null;
  any_restated: boolean | null;
  any_ai_assisted: boolean | null;
}

/**
 * Every metric this company has an answer — or a reason — for.
 *
 * The values are the database's, formatted nowhere but on the page. No
 * arithmetic happens in this module: a ratio TypeScript recomputed would be a
 * second implementation waiting to disagree with the first.
 */
export async function listCompanyMetrics(companyId: string): Promise<CompanyMetricValue[]> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_metric_values")
    .select(VALUE_COLUMNS)
    .eq("company_id", companyId)
    .order("financial_year", { ascending: false })
    .order("code");
  if (error || !data) reportFailure("that company's ratios", error);

  return (data as unknown as ValueRow[]).map((row) => ({
    code: row.code,
    definitionVersion: row.definition_version,
    kind: row.kind,
    resultUnit: row.result_unit,
    status: row.status,
    reason: row.reason,
    value: row.value === null ? null : String(row.value),
    financialYear: row.financial_year,
    periodEnd: String(row.period_end).slice(0, 10),
    consolidated: row.consolidated,
    currency: row.currency,
    disclosedLineItem: row.disclosed_line_item,
    disclosedPage: row.disclosed_page,
    priorPeriodEnd: row.prior_period_end ? String(row.prior_period_end).slice(0, 10) : null,
    windowSpan: row.window_span,
    missingInputs: row.missing_inputs ?? [],
    allAudited: row.all_audited,
    anyRestated: row.any_restated,
    anyAiAssisted: row.any_ai_assisted,
  }));
}

export type MetricPeriodRole = "current" | "prior" | "window_start";

export interface CompanyMetricInput {
  code: string;
  financialYear: number;
  role: MetricInputRole;
  periodRole: MetricPeriodRole;
  lineItem: string;
  label: string;
  figurePeriodEnd: string | null;
  valueReported: string | null;
  valueStandardised: string | null;
  reportedMagnitude: string | null;
  sourcePage: number | null;
  documentId: string | null;
  documentTitle: string | null;
  sourceUri: string | null;
  statementType: string | null;
  audited: boolean | null;
  asRestated: boolean;
  aiAssisted: boolean;
  sortOrder: number;
}

const INPUT_COLUMNS =
  "code, financial_year, role, period_role, line_item, figure_period_end, value_reported, " +
  "value_standardised, reported_magnitude, source_page, document_id, statement_type, " +
  "audited, as_restated, ai_assisted, sort_order";

interface InputRow {
  code: string;
  financial_year: number;
  role: MetricInputRole;
  period_role: MetricPeriodRole;
  line_item: string;
  figure_period_end: string | null;
  value_reported: string | number | null;
  value_standardised: string | number | null;
  reported_magnitude: string | null;
  source_page: number | null;
  document_id: string | null;
  statement_type: string | null;
  audited: boolean | null;
  as_restated: boolean | null;
  ai_assisted: boolean | null;
  sort_order: number;
}

/**
 * The figures each ratio used, with the document and page they came from: the
 * "how calculated" record. A figure that resolved to nothing is still a row,
 * because "we are waiting for this one" is the useful half of the answer.
 */
export async function listCompanyMetricInputs(companyId: string): Promise<CompanyMetricInput[]> {
  const user = await requireUser();
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_metric_inputs")
    .select(INPUT_COLUMNS)
    .eq("company_id", companyId)
    .order("financial_year", { ascending: false })
    .order("code")
    .order("role")
    .order("sort_order");
  if (error || !data) reportFailure("how that company's ratios were calculated", error);

  const rows = data as unknown as InputRow[];
  const labels = await catalogueLabels();

  // The documents are fetched separately rather than embedded: these are views,
  // and a view carries no foreign key for PostgREST to follow. Readers are sent
  // to the issuer's own copy, never to SFI's stored object.
  const documentIds = [...new Set(rows.map((r) => r.document_id).filter((id): id is string => Boolean(id)))];
  const documents = new Map<string, { title: string; sourceUri: string | null }>();
  if (documentIds.length > 0) {
    const { data: docs, error: docError } = await supabase
      .from("documents")
      .select("id, title, source_uri")
      .in("id", documentIds);
    if (docError || !docs) reportFailure("the filings those figures came from", docError);
    for (const doc of docs as Array<{ id: string; title: string; source_uri: string | null }>) {
      documents.set(doc.id, { title: doc.title, sourceUri: doc.source_uri });
    }
  }

  return rows.map((row) => {
    const document = row.document_id ? documents.get(row.document_id) : undefined;
    return {
      code: row.code,
      financialYear: row.financial_year,
      role: row.role,
      periodRole: row.period_role,
      lineItem: row.line_item,
      label: labels.get(row.line_item) ?? row.line_item,
      figurePeriodEnd: row.figure_period_end ? String(row.figure_period_end).slice(0, 10) : null,
      valueReported: row.value_reported === null ? null : String(row.value_reported),
      valueStandardised: row.value_standardised === null ? null : String(row.value_standardised),
      reportedMagnitude: row.reported_magnitude,
      sourcePage: row.source_page,
      documentId: row.document_id,
      documentTitle: document?.title ?? null,
      sourceUri: document?.sourceUri ?? null,
      statementType: row.statement_type,
      audited: row.audited,
      asRestated: row.as_restated ?? false,
      aiAssisted: row.ai_assisted ?? false,
      sortOrder: row.sort_order,
    };
  });
}
