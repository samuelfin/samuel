import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, Panel, PanelGrid } from "@/components/terminal/ui";
import { getEditorialBySlug } from "@/lib/data/editorial";
import {
  EDITORIAL_KIND_LABELS,
  VIDEO_DISCLAIMER,
  toParagraphs,
  youTubeThumbnailUrl,
  youTubeWatchUrl,
} from "@/lib/editorial/validation";
import { formatAsOf } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const found = await getEditorialBySlug(slug);
  return { title: found?.item.title ?? "Research" };
}

export default async function EditorialItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await getEditorialBySlug(slug);
  if (!found) notFound();

  const { item, citations } = found;
  const withdrawn = item.status === "withdrawn";
  const corrected = item.version > 1;
  const paragraphs = item.bodyText ? toParagraphs(item.bodyText) : [];

  return (
    <PanelGrid>
      <Panel title={EDITORIAL_KIND_LABELS[item.kind]} span={12}>
        <article className={withdrawn ? "article is-withdrawn" : "article"}>
          <div className="story-flags">
            {withdrawn ? <span className="flag flag-withdrawn">Withdrawn</span> : null}
            {corrected ? <span className="flag flag-corrected">Corrected</span> : null}
            {item.aiAssisted ? <span className="flag flag-ai">AI-assisted</span> : null}
          </div>

          <h1>{item.title}</h1>
          {item.standfirst ? <p className="article-standfirst">{item.standfirst}</p> : null}
          <p className="article-meta">
            Published {formatAsOf(item.publishedAt ?? item.updatedAt)}
            {corrected ? ` · corrected, version ${item.version}` : ""}
          </p>

          {withdrawn ? (
            <p className="article-flagline">
              This was withdrawn {formatAsOf(item.withdrawnAt)}
              {item.withdrawalReason ? ` — ${item.withdrawalReason}` : ""}. It is kept here rather than
              removed, so that anyone who read it can see what changed.
            </p>
          ) : null}

          {corrected && !withdrawn && item.correctionReason ? (
            <p className="article-flagline">Corrected: {item.correctionReason}</p>
          ) : null}

          {item.aiAssisted ? (
            <p className="article-flagline">
              Produced with AI assistance{item.aiModel ? ` (${item.aiModel})` : ""} and reviewed before
              publication. Every factual claim is cited below.
            </p>
          ) : null}

          {item.kind === "video" && item.videoId ? (
            <div className="video-block">
              <a href={youTubeWatchUrl(item.videoId)} rel="noopener noreferrer" target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail, not an optimised asset */}
                <img src={youTubeThumbnailUrl(item.videoId)} alt="" width={480} height={270} loading="lazy" />
                <span>Watch on YouTube</span>
              </a>
              {item.guestName ? <p className="article-meta">With {item.guestName}</p> : null}
              <p className="article-flagline">{VIDEO_DISCLAIMER}</p>
            </div>
          ) : (
            // Plain text in a text node. Nothing in the body is ever interpreted
            // as markup, so there is no sanitiser to get wrong.
            paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
          )}
        </article>

        {citations.length > 0 ? (
          <section className="sources">
            <h2>Sources</h2>
            <ol>
              {citations.map((c) => {
                const label = c.documentTitle ?? c.announcementHeadline ?? "Source";
                const href = c.documentSourceUri ?? c.announcementSourceUri;
                return (
                  <li key={c.id}>
                    <span>{c.claim}</span>
                    <span>
                      {href ? (
                        <a href={href} rel="noopener noreferrer" target="_blank">{label}</a>
                      ) : (
                        label
                      )}
                      {c.sourcePage ? `, page ${c.sourcePage}` : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null}

        <div className="panel-foot">
          <Notice>
            Links go to the publisher&apos;s own page. SFI describes and cites source documents; it does
            not republish them.
          </Notice>
          <p className="panel-note"><Link href="/research">← All research</Link></p>
        </div>
      </Panel>
    </PanelGrid>
  );
}
