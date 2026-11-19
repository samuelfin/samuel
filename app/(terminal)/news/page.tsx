import type { Metadata } from "next";
import { DataTable, Notice, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { getCorporateActions } from "@/lib/data/content";
import { listPublishedAnnouncements, type Announcement } from "@/lib/data/announcements";
import { ANNOUNCEMENT_CATEGORY_LABELS, type AnnouncementCategory } from "@/lib/announcements/validation";
import { formatAsOf } from "@/lib/format";

export const metadata: Metadata = { title: "News" };

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

function categoryLabel(category: string): string {
  return ANNOUNCEMENT_CATEGORY_LABELS[category as AnnouncementCategory] ?? category;
}

/**
 * One announcement.
 *
 * Two labels matter as much as the headline. A corrected announcement says so,
 * with the date and the reason, because a figure that quietly changed is worse
 * than one openly restated. A withdrawn announcement stays in place, marked, for
 * the same reason: a reader who saw it yesterday deserves to learn it was
 * retracted rather than find it gone.
 */
function Story({ item }: { item: Announcement }) {
  const withdrawn = item.status === "withdrawn";
  const corrected = item.version > 1;

  return (
    <li className={withdrawn ? "story is-withdrawn" : "story"}>
      <div className="story-flags">
        {withdrawn ? <span className="flag flag-withdrawn">Withdrawn</span> : null}
        {corrected ? <span className="flag flag-corrected">Corrected</span> : null}
        {item.isPriceSensitive && !withdrawn ? (
          <span className="flag flag-sensitive">Price sensitive</span>
        ) : null}
        <span className="flag flag-plain">{categoryLabel(item.category)}</span>
      </div>

      <a href={item.sourceUri} rel="noopener noreferrer" target="_blank">{item.headline}</a>
      {item.summary ? <p>{item.summary}</p> : null}

      {withdrawn ? (
        <p className="story-note">
          Withdrawn {formatAsOf(item.withdrawnAt ?? item.publishedAt)}
          {item.withdrawalReason ? ` — ${item.withdrawalReason}` : ""}
        </p>
      ) : null}

      {corrected && !withdrawn ? (
        <p className="story-note">
          Corrected {formatAsOf(item.publishedAt)}
          {item.correctionReason ? ` — ${item.correctionReason}` : ""}
        </p>
      ) : null}

      <span>
        {item.companyName ? `${item.companyName} · ` : ""}
        Announced {formatAsOf(item.announcedAt)} · Last updated {formatAsOf(item.publishedAt)}
      </span>
    </li>
  );
}

export default async function NewsPage() {
  const [announcements, actions] = await Promise.all([
    listPublishedAnnouncements(),
    getCorporateActions(),
  ]);

  return (
    <>
      <PageHeader
        code="NEWS"
        title="News & corporate actions"
        description="Company announcements published from reviewed source documents, each linked to the issuer's own page."
      />
      <PanelGrid>
        <Panel title="Announcements" span={12}>
          {announcements.length === 0 ? (
            <div className="provider-empty">
              <span className="provider-orbit">◌</span>
              <strong>No announcements have been published yet</strong>
              <p>
                Announcements appear here once an analyst publishes one from an approved source
                document. Nothing is shown in the meantime.
              </p>
            </div>
          ) : (
            <ul className="story-list">
              {announcements.map((item) => <Story key={item.id} item={item} />)}
            </ul>
          )}
          <Notice>
            Each announcement links to the publisher&apos;s own page. Headlines and summaries are
            SFI&apos;s description of a source document, not the document itself.
          </Notice>
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
