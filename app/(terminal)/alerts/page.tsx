import type { Metadata } from "next";
import { DefinitionList, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { getWorkspaceItems } from "@/lib/data/content";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage() {
  const alerts = await getWorkspaceItems("alerts");
  return (
    <>
      <PageHeader code="ALRT" title="Alerts" description="Notifications for price moves, announcements, results, dividends and economic releases." />
      <PanelGrid>
        <Panel title="Your alerts" span={8}>
          {alerts.state === "ok" ? <ul>{alerts.data.map((a) => <li key={a.id}>{a.name}</li>)}</ul> : <Unavailable result={alerts} />}
        </Panel>
        <Panel title="Planned alert types" span={4}>
          <DefinitionList
            items={[
              { term: "Price", detail: "Price thresholds and percentage changes." },
              { term: "Company", detail: "Announcements, financial results and dividend declarations." },
              { term: "Economy", detail: "Scheduled economic releases and market events." },
              { term: "Delivery", detail: "Email first; push notifications later." },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
