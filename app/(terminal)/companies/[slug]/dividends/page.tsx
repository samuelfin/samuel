import type { Metadata } from "next";
import { Notice, Panel, PanelGrid } from "@/components/terminal/ui";
import { DividendsPanel } from "@/components/terminal/company-panels";
import { listFinancialsForCompany } from "@/lib/data/financials";
import { listCompanyMetrics, listMetricDefinitions } from "@/lib/data/metrics";
import { CompanyFrame, companyForTab, companyTabMetadata, panel } from "../shared";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return companyTabMetadata(slug, "Dividends");
}

export default async function CompanyDividendsPage({ params }: Props) {
  const { slug } = await params;
  const company = await companyForTab(slug, "dividends");

  const dividends = await panel(
    Promise.all([
      listFinancialsForCompany(company.id),
      listCompanyMetrics(company.id),
      listMetricDefinitions(),
    ]),
    "Could not load the dividend record.",
  );

  return (
    <CompanyFrame company={company} tab="dividends">
      <PanelGrid>
        <Panel title="Dividends" span={12} meta="As reported, with the page for every figure">
          {!dividends.ok ? (
            <Notice tone="caution">{dividends.error}</Notice>
          ) : (
            <DividendsPanel
              companyName={company.name}
              statements={dividends.data[0]}
              metrics={dividends.data[1]}
              definitions={dividends.data[2]}
            />
          )}
        </Panel>
      </PanelGrid>
    </CompanyFrame>
  );
}
