import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, DefinitionList, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { listCompanies } from "@/lib/data/companies";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const companies = await listCompanies();

  return (
    <>
      <PageHeader code="CO" title="Companies" description="Profiles of NGX-listed companies: market data, financial statements by reporting period, ratios and source documents." />
      <PanelGrid>
        <Panel title="Company directory" span={8} flush>
          <DataTable
            caption="Company directory"
            columns={[
              { key: "symbol", label: "Symbol" },
              { key: "name", label: "Company" },
              { key: "sector", label: "Sector" },
              { key: "industry", label: "Industry" },
              { key: "board", label: "Board" },
            ]}
            rows={
              companies.state === "ok"
                ? companies.data.map((c) => ({
                    key: c.symbol,
                    cells: { symbol: <Link className="sym" href={`/companies/${c.symbol}`}>{c.symbol}</Link>, name: c.name, sector: c.sector, industry: c.industry, board: c.listingBoard },
                  }))
                : []
            }
            empty={companies.state === "unavailable" && <Unavailable result={companies} />}
          />
        </Panel>
        <Panel title="What a company profile contains" span={4}>
          <DefinitionList
            items={[
              { term: "Overview", detail: "Name, symbol, sector, industry, listing details, website and announcements." },
              { term: "Market information", detail: "Latest price, previous close, change, volume, market capitalisation and price history — each with status and as-of time." },
              { term: "Financial statements", detail: "Annual and interim periods shown separately, with the period, audit status and source for every figure." },
              { term: "Ratios", detail: "Defined formulas, computed only from inputs that share a reporting period." },
              { term: "Documents", detail: "Annual and interim reports, presentations, announcements and filings, linked to their source." },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
