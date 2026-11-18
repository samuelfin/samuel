import type { Metadata } from "next";
import { DefinitionList, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { getWorkspaceItems } from "@/lib/data/content";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const reports = await getWorkspaceItems("reports");
  return (
    <>
      <PageHeader code="RPT" title="Reports & exports" description="Export company summaries, comparisons, market history and indicators as PDF, CSV or Excel." />
      <PanelGrid>
        <Panel title="Your exports" span={8}>
          {reports.state === "ok" ? <ul>{reports.data.map((r) => <li key={r.id}>{r.name}</li>)}</ul> : <Unavailable result={reports} />}
        </Panel>
        <Panel title="Every export includes" span={4}>
          <DefinitionList
            items={[
              { term: "Sources", detail: "Provider and source reference for each figure." },
              { term: "Dates", detail: "As-of times, reporting periods and publication dates." },
              { term: "Disclosures", detail: "Data status, licence notes and research disclaimers." },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
