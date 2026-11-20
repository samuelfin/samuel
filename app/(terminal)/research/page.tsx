import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Panel, PanelGrid } from "@/components/terminal/ui";
import { listLiveEditorial, type EditorialItem } from "@/lib/data/editorial";
import { EDITORIAL_KIND_LABELS, youTubeThumbnailUrl } from "@/lib/editorial/validation";
import { formatAsOf } from "@/lib/format";

export const metadata: Metadata = { title: "Research" };

/**
 * A card in the research list.
 *
 * Three labels carry weight beyond the headline: a correction says so, a
 * withdrawal stays visible and says so, and AI-assisted work is named as such
 * rather than passed off as analyst writing.
 */
function Card({ item }: { item: EditorialItem }) {
  const withdrawn = item.status === "withdrawn";
  const corrected = item.version > 1;

  return (
    <li className={withdrawn ? "story is-withdrawn" : "story"}>
      <div className="story-flags">
        {withdrawn ? <span className="flag flag-withdrawn">Withdrawn</span> : null}
        {corrected ? <span className="flag flag-corrected">Corrected</span> : null}
        {item.aiAssisted ? <span className="flag flag-ai">AI-assisted</span> : null}
        <span className="flag flag-plain">{EDITORIAL_KIND_LABELS[item.kind]}</span>
      </div>

      <div className="story-body">
        {item.kind === "video" && item.videoId ? (
          // eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail, not an optimised asset
          <img
            className="video-thumb"
            src={youTubeThumbnailUrl(item.videoId)}
            alt=""
            width={160}
            height={90}
            loading="lazy"
          />
        ) : null}
        <div>
          <Link href={`/research/${item.slug}`}>{item.title}</Link>
          {item.standfirst ? <p>{item.standfirst}</p> : null}
          {item.kind === "video" && item.guestName ? (
            <p className="story-note">With {item.guestName}</p>
          ) : null}
          <span>
            {withdrawn ? "Withdrawn " : corrected ? "Corrected " : ""}
            {formatAsOf(item.publishedAt ?? item.updatedAt)}
          </span>
        </div>
      </div>
    </li>
  );
}

export default async function ResearchPage() {
  const items = await listLiveEditorial();

  return (
    <>
      <PageHeader
        code="RES"
        title="Research & analysis"
        description="SFI articles and analysis, each citing the documents and announcements behind it, plus video conversations."
      />
      <PanelGrid>
        <Panel title="Published" span={12}>
          {items.length === 0 ? (
            <div className="provider-empty">
              <span className="provider-orbit">◌</span>
              <strong>Nothing has been published yet</strong>
              <p>Articles, analysis and video conversations appear here once an editor publishes them.</p>
            </div>
          ) : (
            <ul className="story-list">
              {items.map((item) => <Card key={item.id} item={item} />)}
            </ul>
          )}
          <Notice>
            Every article and analysis cites the approved document or published announcement behind
            each claim. Work produced with AI assistance is labelled, and videos carry their guest&apos;s name.
          </Notice>
        </Panel>
      </PanelGrid>
    </>
  );
}
