import type { Metadata } from "next";
import { Notice, Panel, PanelGrid } from "@/components/terminal/ui";
import { FinancialsPanel } from "@/components/terminal/financials-panel";
import { HistoryChart } from "@/components/terminal/history-charts";
import { listFinancialsForCompany, type ReaderStatement } from "@/lib/data/financials";
import { figureSeries, seriesYears, type FigureSource } from "@/lib/metrics/series";
import { CompanyFrame, companyForTab, companyTabMetadata, panel } from "../shared";
import { formatReported } from "@/lib/financials/validation";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return companyTabMetadata(slug, "Financials");
}

/**
 * The reported figures, flattened to one row per figure and year, so the chart
 * and the table beside it read one array. Annual periods only: a half-year
 * beside a full one is a different quantity under the same name.
 */
function figureRows(statements: readonly ReaderStatement[]): FigureSource[] {
  return statements
    .filter((statement) => statement.periodType === "FY")
    .flatMap((statement) =>
      statement.figures.map((figure) => ({
        financialYear: Number(statement.periodEnd.slice(0, 4)),
        lineItem: figure.lineItem,
        valueStandardised: figure.valueStandardised,
        reported: formatReported(figure.valueReported, figure.reportedMagnitude, figure.unitLabel),
        sourcePage: figure.sourcePage,
        documentTitle: statement.sourceTitle,
        sourceUri: statement.sourceUri,
        audited: statement.audited,
        consolidated: statement.consolidated,
        currency: statement.currency,
      })),
    );
}

export default async function CompanyFinancialsPage({ params }: Props) {
  const { slug } = await params;
  const company = await companyForTab(slug, "financials");

  const figures = await panel(listFinancialsForCompany(company.id), "Could not load figures.");

  // A bank reports gross earnings and net interest income rather than a
  // retailer's revenue, so the chart draws whichever of the two the filings
  // actually carry rather than an empty axis labelled Revenue.
  const rows = figures.ok ? figureRows(figures.data) : [];
  const years = seriesYears(rows.map((row) => row.financialYear));
  const topLine = rows.some((row) => row.lineItem === "revenue")
    ? { lineItem: "revenue", label: "Revenue" }
    : { lineItem: "net_interest_income", label: "Net interest income" };
  const bars = [
    figureSeries(rows, { ...topLine, years }),
    figureSeries(rows, { lineItem: "profit_after_tax", label: "Profit after tax", years }),
  ];

  return (
    <CompanyFrame company={company} tab="financials">
      <PanelGrid>
        <Panel title="Five-year history" span={12} meta="Drawn from the figures below, gaps left as gaps">
          {!figures.ok ? (
            <Notice tone="caution">{figures.error}</Notice>
          ) : (
            <HistoryChart
              title={topLine.label + " and profit after tax"}
              caption="As reported · a year with no figure is left blank, never estimated"
              series={bars}
              kind="bars"
            />
          )}
        </Panel>

        <Panel title="Financial history" span={12} meta="As reported, with the page for every figure">
          {!figures.ok ? (
            <Notice tone="caution">{figures.error}</Notice>
          ) : (
            <FinancialsPanel statements={figures.data} companyName={company.name} />
          )}
        </Panel>
      </PanelGrid>
    </CompanyFrame>
  );
}
