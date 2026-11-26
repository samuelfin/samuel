import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, DefinitionList, Notice, PageHeader, Panel, PanelGrid } from "@/components/terminal/ui";
import { listCompanies, LISTING_STATUS_LABELS, type CompanyProfile } from "@/lib/data/companies";
import { unstable_rethrow } from "next/navigation";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
   
  let companies: CompanyProfile[] | null = null;
  let failure: string | null = null;
  try {
    companies = await listCompanies();
  } catch (error) {
    
    unstable_rethrow(error);
    failure = error instanceof Error ? error.message : "The directory could not be loaded.";
  }

  const listed = companies?.filter((c) => c.listingStatus === "listed") ?? [];
  const other = companies?.filter((c) => c.listingStatus !== "listed") ?? [];

  return (
    <>
      <PageHeader
        code="CO"
        title="Companies"
        description="Nigerian listed companies: who they are, what they file, and what their financials say."
      />
      <PanelGrid>
        <Panel
          title="Company directory"
          span={8}
          flush
          meta={companies ? `${companies.length} on the register` : undefined}
        >
          {failure ? (
            <div className="panel-foot">
              <Notice tone="caution">{failure}</Notice>
            </div>
          ) : (
            <DataTable
              caption="Company directory"
              columns={[
                { key: "symbol", label: "Symbol" },
                { key: "name", label: "Company" },
                { key: "sector", label: "Sector" },
                { key: "industry", label: "Industry" },
                { key: "board", label: "Board" },
              ]}
              rows={[...listed, ...other].map((company) => ({
                key: company.slug,
                cells: {
                  // A company awaiting its offer has no ticker, so its listing
                  // status stands in rather than an empty cell.
                  symbol: (
                    <Link className="sym" href={`/companies/${company.slug}`}>
                      {company.symbol ?? LISTING_STATUS_LABELS[company.listingStatus]}
                    </Link>
                  ),
                  name: <Link href={`/companies/${company.slug}`}>{company.name}</Link>,
                  sector: company.sector ?? "—",
                  industry: company.industry ?? "—",
                  board: company.listingBoard ?? "—",
                },
              }))}
              empty={
                <div className="provider-empty">
                  <span className="provider-orbit">◌</span>
                  <strong>No companies yet</strong>
                  <p>
                    Companies appear here once a profile has been written and reviewed. Nothing has
                    been approved so far.
                  </p>
                </div>
              }
            />
          )}
        </Panel>

        <Panel title="What a company page holds" span={4}>
          <DefinitionList
            items={[
              {
                term: "Profile",
                detail: "Name, ticker, sector, listing status and board, and what the business does.",
              },
              {
                term: "Documents",
                detail:
                  "Annual and interim reports and other filings, each reviewed before it appears, linked to the issuer's own copy.",
              },
              {
                term: "Announcements",
                detail: "What the company has told the market, published from an approved document.",
              },
              { term: "Research", detail: "SFI articles and analysis that cite this company." },
              {
                term: "Financials",
                detail:
                  "Revenue, profit, assets, and the margins and growth computed from them — entered by an analyst from the filings, each figure citing a document and page. Not yet open.",
              },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
