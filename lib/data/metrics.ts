import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import type {
  MetricDefinition,
  MetricGroup,
  MetricInputRole,
  MetricKind,
  MetricResultUnit,
} from "@/lib/metrics/definitions";

/**
 * The metric register, read for display.
 *
 * Nothing here calculates anything. A ratio is computed in the database from
 * approved figures, under a definition that is itself approved data; this module
 * only carries the definitions to the desk, the methodology page and the
 * company's Ratios tab, so a reader can see which formula produced a number and
 * who answers for it. Keeping the arithmetic in one place is the point — the
 * lesson of 3c was that two pieces of code computing the same number eventually
 * disagree.
 *
 * Read through the caller's own session, so row-level security decides what is
 * visible: an approved definition is methodology and anyone signed in may read
 * it, while one nobody has approved is the desk's working note.
 */

function reportFailure(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}: ${error?.message ?? "unknown error"}`);
}

const DEFINITION_COLUMNS =
  "id, code, version, label, definition, kind, result_unit, decimals, metric_group, " +
  "template_id, disclosed_line_item, window_years, owner_name, approved_by_name, approved_at, " +
  "review_self_approved, effective_from, is_active, sort_order, " +
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

/** Every live definition, with its inputs named as a reader would see them. */
export async function listMetricDefinitions(
  options: { includeRetired?: boolean } = {},
): Promise<MetricDefinition[]> {
  const user = await requireUser();
  // Local preview runs without Supabase, where createClient() throws.
  if (user.mode !== "authenticated") return [];

  const supabase = await createClient();
  let query = supabase.from("metric_definitions").select(DEFINITION_COLUMNS);
  if (!options.includeRetired) query = query.eq("is_active", true);

  const { data, error } = await query.order("metric_group").order("sort_order").order("code");
  if (error || !data) reportFailure("the metric definitions", error);

  const catalogue = await supabase.from("statement_line_catalogue").select("line_item, label");
  if (catalogue.error || !catalogue.data) reportFailure("the figure catalogue", catalogue.error);
  const labels = new Map(
    (catalogue.data as Array<{ line_item: string; label: string }>).map((line) => [line.line_item, line.label]),
  );

  return (data as unknown as DefinitionRow[]).map((row) => ({
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
    effectiveFrom: row.effective_from,
    isActive: row.is_active,
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
  }));
}
