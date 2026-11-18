import type { Metadata } from "next";
import { DefinitionList, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { getWorkspaceItems } from "@/lib/data/content";

export const metadata: Metadata = { title: "Watchlists" };

export default async function WatchlistsPage() {
  const lists = await getWorkspaceItems("watchlists");
  return (
    <>
      <PageHeader code="WL" title="Watchlists" description="Follow companies, sectors and indicators in your own lists." />
      <PanelGrid>
        <Panel title="Your watchlists" span={8}>
          {lists.state === "ok" ? <ul>{lists.data.map((l) => <li key={l.id}>{l.name}</li>)}</ul> : <Unavailable result={lists} />}
        </Panel>
        <Panel title="Planned capabilities" span={4}>
          <DefinitionList
            items={[
              { term: "Lists", detail: "Create, rename and organise multiple watchlists." },
              { term: "Coverage", detail: "Companies, sectors and economic indicators." },
              { term: "Monitoring", detail: "Price changes and announcements for followed items." },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
