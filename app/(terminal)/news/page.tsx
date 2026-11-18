import type { Metadata } from "next";
import { DataTable, Notice, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { getCorporateActions, getNews } from "@/lib/data/content";
import { formatAsOf } from "@/lib/format";

export const metadata: Metadata = { title: "News" };

const CATEGORIES = [
  "Markets",
  "Listed companies",
  "Earnings",
  "Banking & financial services",
  "Monetary policy",
  "Fiscal & economic policy",
  "Capital markets",
  "Public offers",
  "Corporate actions",
  "Regulatory",
];

const ACTION_LABEL: Record<string, string> = {
  ipo: "IPO",
  rights_issue: "Rights issue",
  public_offer: "Public offer",
  bonus: "Bonus issue",
  dividend: "Dividend",
  split: "Stock split",
  merger_acquisition: "Merger / acquisition",
  other: "Other",
};

export default async function NewsPage() {
  const [news, actions] = await Promise.all([getNews(), getCorporateActions()]);

  return (
    <>
      <PageHeader code="NEWS" title="News & corporate actions" description="Market news, company announcements, public offers and corporate actions — each with original source, link and publication date." />
      <PanelGrid>
        <Panel title="News desk" span={12}>
          <ul className="tag-list" aria-label="Editorial categories">
            {CATEGORIES.map((c) => <li key={c} className="tag">{c}</li>)}
          </ul>
          {news.state === "ok" ? (
            <ul className="story-list">
              {news.data.map((item) => (
                <li key={item.id}>
                  <a href={item.sourceUrl} rel="noopener noreferrer" target="_blank">{item.headline}</a>
                  <p>{item.summary}</p>
                  <span>{item.sourceName} · {formatAsOf(item.publishedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Unavailable result={news} />
          )}
          <Notice>Stories are summarised and linked to the original publisher. Full text is republished only where SFI holds syndication rights.</Notice>
        </Panel>

        <Panel title="IPOs and corporate actions" span={12} flush>
          <DataTable
            caption="IPOs and corporate actions"
            columns={[
              { key: "issuer", label: "Issuer" },
              { key: "type", label: "Event" },
              { key: "announced", label: "Announced" },
              { key: "status", label: "Status" },
              { key: "source", label: "Official source" },
            ]}
            rows={
              actions.state === "ok"
                ? actions.data.map((a) => ({
                    key: a.id,
                    cells: {
                      issuer: a.issuer,
                      type: ACTION_LABEL[a.type],
                      announced: formatAsOf(a.announcedAt, false),
                      status: a.status,
                      source: <a href={a.sourceUrl} rel="noopener noreferrer" target="_blank">Document</a>,
                    },
                  }))
                : []
            }
            empty={actions.state === "unavailable" && <Unavailable result={actions} />}
          />
          <div className="panel-foot">
            <Notice>Official issuer information and SFI commentary are labelled separately.</Notice>
          </div>
        </Panel>
      </PanelGrid>
    </>
  );
}
