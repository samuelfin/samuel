import type { Metadata } from "next";
import { Notice, Panel, PanelGrid } from "@/components/terminal/ui";
import { FinancialsPanel } from "@/components/terminal/financials-panel";
import { listFinancialsForCompany } from "@/lib/data/financials";
import { CompanyFrame, companyForTab, companyTabMetadata, panel } from "../shared";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return companyTabMetadata(slug, "Financials");
}

export default async function CompanyFinancialsPage({ params }: Props) {
  const { slug } = await params;
  const company = await companyForTab(slug, "financials");

  const figures = await panel(listFinancialsForCompany(company.id), "Could not load figures.");

  return (
    <CompanyFrame company={company} tab="financials">
      <PanelGrid>
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
