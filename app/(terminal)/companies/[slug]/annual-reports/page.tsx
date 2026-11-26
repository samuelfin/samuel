import type { Metadata } from "next";
import { Notice, Panel, PanelGrid } from "@/components/terminal/ui";
import { AnnualReportsPanel } from "@/components/terminal/company-panels";
import { getCompanyDocuments } from "@/lib/data/companies";
import { listDocumentAuditClaims } from "@/lib/data/financials";
import { CompanyFrame, companyForTab, companyTabMetadata, panel } from "../shared";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return companyTabMetadata(slug, "Annual Reports");
}

export default async function CompanyAnnualReportsPage({ params }: Props) {
  const { slug } = await params;
  const company = await companyForTab(slug, "annual-reports");

  const filings = await panel(
    Promise.all([getCompanyDocuments(company.id), listDocumentAuditClaims(company.id)]),
    "Could not load the filings.",
  );

  return (
    <CompanyFrame company={company} tab="annual-reports">
      <PanelGrid>
        <Panel title="Annual reports and other filings" span={12} meta="Reviewed before they appear">
          {!filings.ok ? (
            <Notice tone="caution">{filings.error}</Notice>
          ) : (
            <AnnualReportsPanel documents={filings.data[0]} auditStatus={filings.data[1]} />
          )}
        </Panel>
      </PanelGrid>
    </CompanyFrame>
  );
}
