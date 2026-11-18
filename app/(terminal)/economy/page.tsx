import type { Metadata } from "next";
import { ChartFrame, DataTable, DefinitionList, Notice, PageHeader, Panel, PanelGrid, StatusBadge } from "@/components/terminal/ui";
import { RangeSelector } from "@/components/terminal/range-selector";
import { getIndicatorRows } from "@/lib/data/economy";
import { unitLabel } from "@/lib/catalog/indicators";
import { PROVIDERS } from "@/lib/providers/registry";
import { FREQUENCY_LABEL } from "@/lib/market-data/status";
import { EMPTY, formatAsOf, formatDecimal } from "@/lib/format";
import { unavailable } from "@/lib/market-data/types";

export const metadata: Metadata = { title: "Economy" };

export default async function EconomyPage() {
  const rows = await getIndicatorRows();
  const anyConnected = rows.some((r) => r.latest.state === "ok");

  return (
    <>
      <PageHeader code="ECO" title="Economy" description="Nigerian macroeconomic indicators from official sources. The period a figure describes and the date it was published are always shown separately." />
      <PanelGrid>
        <Panel title="Indicators" span={12} flush>
          <DataTable
            caption="Nigerian macroeconomic indicators"
            columns={[
              { key: "name", label: "Indicator" },
              { key: "latest", label: "Latest", numeric: true },
              { key: "unit", label: "Unit" },
              { key: "period", label: "Reference period" },
              { key: "published", label: "Published" },
              { key: "frequency", label: "Frequency" },
              { key: "source", label: "Source" },
              { key: "status", label: "Status" },
            ]}
            rows={rows.map(({ definition, latest }) => {
              const obs = latest.state === "ok" ? latest.data : undefined;
              return {
                key: definition.id,
                cells: {
                  name: definition.name,
                  latest: obs ? formatDecimal(obs.value) : EMPTY,
                  unit: unitLabel(definition.unit, definition.magnitude),
                  period: obs?.period ? `${obs.period.start} – ${obs.period.end}` : EMPTY,
                  published: obs ? formatAsOf(obs.provenance.publishedAt, false) : EMPTY,
                  frequency: FREQUENCY_LABEL[definition.frequency],
                  source: PROVIDERS[definition.source].shortName,
                  status: <StatusBadge status={obs ? obs.status : "unavailable"} />,
                },
              };
            })}
          />
          {!anyConnected && (
            <div className="panel-foot">
              <Notice>No official series has been ingested yet. Phase 2a adds controlled imports of CBN, NBS and DMO releases, each with source link, reference period and publication date.</Notice>
            </div>
          )}
        </Panel>

        <Panel title="Indicator history" span={12} actions={<RangeSelector disabled={!anyConnected} initial="1Y" />}>
          <ChartFrame label="Indicator history" missing={anyConnected ? undefined : unavailable("economy.observations", "no_provider", "Select an indicator once official series are ingested.")} />
        </Panel>

        <Panel title="Definitions and caveats" span={12}>
          <DefinitionList
            items={rows.map(({ definition }) => ({
              id: definition.id,
              term: definition.name,
              tag: `${definition.category} · ${PROVIDERS[definition.source].shortName}`,
              detail: (
                <>
                  {definition.definition}
                  {definition.caveat && <span className="caveat"> Caveat: {definition.caveat}</span>}
                </>
              ),
            }))}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
