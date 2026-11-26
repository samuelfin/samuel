import type { Metadata } from "next";
import { Notice, Panel, PanelGrid } from "@/components/terminal/ui";
import { RatiosPanel } from "@/components/terminal/company-panels";
import { HistoryChart } from "@/components/terminal/history-charts";
import { metricSeries, seriesYears } from "@/lib/metrics/series";
import { assignmentFor, listTemplateAssignments } from "@/lib/data/financials";
import {
  listCompanyMetricInputs,
  listCompanyMetrics,
  listMetricDefinitions,
  listMetricStatuses,
} from "@/lib/data/metrics";
import { CompanyFrame, companyForTab, companyTabMetadata, panel } from "../shared";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return companyTabMetadata(slug, "Ratios");
}

export default async function CompanyRatiosPage({ params }: Props) {
  const { slug } = await params;
  const company = await companyForTab(slug, "ratios");

  // Values from company_metric_values, inputs from company_metric_inputs, and
  // nothing recomputed here. The sector template decides which metrics are
  // offered at all, so a cement company is not told its loan-to-deposit ratio
  // is unavailable.
  const ratios = await panel(
    Promise.all([
      listCompanyMetrics(company.id),
      listCompanyMetricInputs(company.id),
      listMetricDefinitions(),
      listMetricStatuses(),
    ]),
    "Could not load the ratios.",
  );

  // The sector assignment is loaded on its own, so a failure there costs the
  // page the template filter and not the ratios themselves.
  const assignments = await panel(listTemplateAssignments(), "Could not load the sector template.");
  const templateId = assignments.ok
    ? (assignmentFor(assignments.data, company.id, "9999-12-31")?.templateId ?? null)
    : null;

  // The charts read the values the panel reads. One array, two renderings: a
  // chart that disagreed with the table under it would be the stage 3c defect
  // in a new costume.
  const values = ratios.ok ? ratios.data[0] : [];
  const definitions = ratios.ok ? ratios.data[2] : [];
  const chartYears = seriesYears(values.map((value) => value.financialYear));
  const lineCharts = ["net_margin", "roe"]
    .map((code) => {
      const definition = definitions.find((entry) => entry.code === code);
      if (!definition) return null;
      return metricSeries(values, {
        code,
        label: definition.label,
        years: chartYears,
        decimals: definition.decimals,
      });
    })
    .filter((series): series is NonNullable<typeof series> => series !== null);

  return (
    <CompanyFrame company={company} tab="ratios">
      <PanelGrid>
        {lineCharts.length > 0 ? (
          <Panel title="Ratio history" span={12} meta="The same figures the table below carries">
            <HistoryChart
              title={lineCharts.map((series) => series.label).join(" and ")}
              caption="Calculated by SFI unless a point says the issuer reported it · gaps left as gaps"
              series={lineCharts}
              kind="lines"
            />
          </Panel>
        ) : null}

        <Panel
          title="Ratios"
          span={12}
          meta="Calculated in the database from approved figures, under an approved formula"
        >
          {!ratios.ok ? (
            <Notice tone="caution">{ratios.error}</Notice>
          ) : (
            <RatiosPanel
              companyName={company.name}
              values={ratios.data[0]}
              inputs={ratios.data[1]}
              definitions={ratios.data[2]}
              statuses={ratios.data[3]}
              templateId={templateId}
            />
          )}
        </Panel>

        <Panel title="Valuation ratios" span={12} meta="Awaiting an exchange licence">
          <div className="provider-empty">
            <span className="provider-orbit">&#9676;</span>
            <strong>No data yet</strong>
            <p>
              Price to earnings, price to book, dividend yield and market capitalisation all need
              share prices, which wait on a market-data licence from the Nigerian Exchange. The
              accounting ratios above do not, and are published now.
            </p>
          </div>
        </Panel>
      </PanelGrid>
    </CompanyFrame>
  );
}
