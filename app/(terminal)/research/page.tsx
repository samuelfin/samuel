import type { Metadata } from "next";
import { DataTable, DefinitionList, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { getResearchReports, type ReportReviewState } from "@/lib/data/content";
import { formatAsOf } from "@/lib/format";

export const metadata: Metadata = { title: "Research" };

const REVIEW_LABEL: Record<ReportReviewState, string> = {
  ai_generated: "AI-generated",
  analyst_reviewed: "Analyst-reviewed",
  approved: "SFI-approved",
};

export default async function ResearchPage() {
  const reports = await getResearchReports();

  return (
    <>
      <PageHeader code="RES" title="Research" description="SFI research: company performance, sector analysis, economic briefings and market summaries. Every report states how it was produced and reviewed." />
      <PanelGrid>
        <Panel title="Reports" span={8} flush>
          <DataTable
            caption="Research reports"
            columns={[
              { key: "title", label: "Title" },
              { key: "kind", label: "Type" },
              { key: "review", label: "Review state" },
              { key: "published", label: "Published" },
            ]}
            rows={
              reports.state === "ok"
                ? reports.data.map((r) => ({
                    key: r.id,
                    cells: { title: r.title, kind: r.kind, review: <span className={`review-state is-${r.reviewState}`}>{REVIEW_LABEL[r.reviewState]}</span>, published: formatAsOf(r.publishedAt, false) },
                  }))
                : []
            }
            empty={reports.state === "unavailable" && <Unavailable result={reports} />}
          />
        </Panel>
        <Panel title="Review states" span={4}>
          <DefinitionList
            items={[
              { term: REVIEW_LABEL.ai_generated, detail: "Drafted by the AI engine from cited platform data. Not yet reviewed by an analyst." },
              { term: REVIEW_LABEL.analyst_reviewed, detail: "Checked by an SFI analyst against its sources." },
              { term: REVIEW_LABEL.approved, detail: "Formally approved for publication under SFI's research policy." },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
