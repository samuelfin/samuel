import { requireUser } from "@/lib/auth/session";
import { notConnected } from "@/lib/providers/registry";
import { INDICATORS, type IndicatorDefinition } from "@/lib/catalog/indicators";
import type { DataResult, Observation } from "@/lib/market-data/types";

export interface IndicatorRow {
  definition: IndicatorDefinition;
  latest: DataResult<Observation>;
}

/**
 * Latest observation per indicator. Each indicator resolves independently, so one
 * source being connected does not imply the others are.
 */
export async function getIndicatorRows(ids?: readonly string[]): Promise<IndicatorRow[]> {
  await requireUser();
  const definitions = ids ? INDICATORS.filter((i) => ids.includes(i.id)) : INDICATORS;
  return definitions.map((definition) => ({
    definition,
    latest: notConnected("economy.observations", definition.source),
  }));
}
