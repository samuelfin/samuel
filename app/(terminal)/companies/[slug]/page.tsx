import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect, unstable_rethrow } from "next/navigation";
import { DefinitionList, Notice, PageHeader, Panel, PanelGrid } from "@/components/terminal/ui";
import { listAnnouncementsForCompany } from "@/lib/data/announcements";
import {
  currentSlugForFormerSlug,
  getCompanyBySlug,
  getCompanyDocuments,
  LISTING_STATUS_LABELS,
  normalizeSlug,
  normalizeSymbol,
  slugForSymbol,
  type CompanyProfile,
} from "@/lib/data/companies";
import { listEditorialForCompany } from "@/lib/data/editorial";
import { listLeadershipForCompany } from "@/lib/data/people";
import { listFinancialsForCompany } from "@/lib/data/financials";
import { LeadershipPanel } from "@/components/terminal/leadership-panel";
import { FinancialsPanel } from "@/components/terminal/financials-panel";
import { ANNOUNCEMENT_CATEGORY_LABELS, type AnnouncementCategory } from "@/lib/announcements/validation";
import { EDITORIAL_KIND_LABELS } from "@/lib/editorial/validation";

type Props = { params: Promise<{ slug: string }> };

const DOCUMENT_KINDS: Record<string, string> = {
  annual_report: "Annual report",
  interim_report: "Interim report",
  financial_statements: "Financial statements",
  presentation: "Presentation",
  announcement: "Announcement",
  regulatory_filing: "Regulatory filing",
  statistical_release: "Statistical release",
  auction_result: "Auction result",
  circular: "Circular",
  other: "Document",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" }).format(
    new Date(iso),
  );
}

/**
 * A panel's data, or the reason it could not be loaded. Discriminated on `ok`
 * rather than on the error being absent, because an error string could in
 * principle be empty and TypeScript would then narrow neither case.
 */
type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

function panel<T>(promise: Promise<T>, whatFailed: string): Promise<Loaded<T>> {
  return promise.then<Loaded<T>, Loaded<T>>(
    (data) => ({ ok: true, data }),
    (error: unknown) => {
      // Next signals redirect(), notFound() and prerender bailouts by throwing.
      // Reporting one of those as a panel failure would strand a reader on a
      // half-rendered page instead of sending them to the login screen.
      unstable_rethrow(error);
      return { ok: false, error: error instanceof Error ? error.message : whatFailed };
    },
  );
}

/**
 * One address, three ways in.
 *
 * The slug is the company's own address. A slug it used to carry redirects
 * permanently, because the page really has moved. A ticker redirects
 * temporarily, because a ticker can be reassigned to another company and no
 * browser or proxy should cache that mapping for good.
 *
 * This returns the company or a destination; the redirect happens in the caller,
 * because redirect() throws and must not sit inside a try block.
 */
async function resolve(
  raw: string,
): Promise<{ company: CompanyProfile } | { moved: string; permanent: boolean } | { missing: true }> {
  const slug = normalizeSlug(raw);

  if (slug) {
    const company = await getCompanyBySlug(slug);
    if (company) return { company };

    const current = await currentSlugForFormerSlug(slug);
    if (current) return { moved: current, permanent: true };
  }

  // A ticker typed into the address bar, which is what an analyst will do.
  const symbol = normalizeSymbol(raw);
  if (symbol) {
    const bySymbol = await slugForSymbol(symbol);
    if (bySymbol) return { moved: bySymbol, permanent: false };
  }

  return { missing: true };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: raw } = await params;
  const slug = normalizeSlug(raw);
  if (!slug) return { title: "Company" };
  try {
    const company = await getCompanyBySlug(slug);
    return { title: company?.name ?? "Company" };
  } catch (error) {
    unstable_rethrow(error);
    // A title is not worth failing a page over.
    return { title: "Company" };
  }
}

export default async function CompanyPage({ params }: Props) {
  const { slug: raw } = await params;
  const resolved = await resolve(raw);

  if ("missing" in resolved) notFound();
  if ("moved" in resolved) {
    if (resolved.permanent) permanentRedirect(`/companies/${resolved.moved}`);
    redirect(`/companies/${resolved.moved}`);
  }

  const company = resolved.company;

  // Each panel stands or falls on its own: a failing query reports itself rather
  // than taking the page down, and an empty result is never dressed up as a
  // failure.
  const [documents, announcements, research, leadership, financials] = await Promise.all([
    panel(getCompanyDocuments(company.id), "Could not load documents."),
    panel(listAnnouncementsForCompany(company.id), "Could not load announcements."),
    panel(listEditorialForCompany(company.id), "Could not load research."),
    panel(listLeadershipForCompany(company.id), "Could not load leadership."),
    panel(listFinancialsForCompany(company.id), "Could not load figures."),
  ]);

  return (
    <>
      <PageHeader
        code={company.symbol ?? "CO"}
        title={company.name}
        description={
          [company.sector, company.industry, company.listingBoard].filter(Boolean).join(" · ") ||
          "Sector not yet recorded."
        }
      />

      <PanelGrid>
        <Panel title="Profile" span={5}>
          <DefinitionList
            items={[
              { term: "What it does", detail: company.description ?? "Not yet recorded." },
              { term: "Registered name", detail: company.legalName ?? company.name },
              {
                term: "Listing",
                detail:
                  [LISTING_STATUS_LABELS[company.listingStatus], company.listingBoard]
                    .filter(Boolean)
                    .join(" · ") || LISTING_STATUS_LABELS[company.listingStatus],
              },
              { term: "NGX symbol", detail: company.symbol ?? "Not listed" },
              {
                term: "Website",
                detail: company.website ? (
                  <a href={company.website} rel="noopener noreferrer nofollow" target="_blank">
                    {company.website}
                  </a>
                ) : (
                  "Not recorded"
                ),
              },
            ]}
          />
        </Panel>

        <Panel title="Financial history" span={7} meta="As reported, with the page for every figure">
          {!financials.ok ? (
            <Notice tone="caution">{financials.error}</Notice>
          ) : (
            <FinancialsPanel statements={financials.data} companyName={company.name} />
          )}
        </Panel>

        <Panel title="Leadership" span={12} meta="Each office cites its source">
          {!leadership.ok ? (
            <Notice tone="caution">{leadership.error}</Notice>
          ) : (
            <LeadershipPanel members={leadership.data} />
          )}
        </Panel>

        <Panel title="Share price" span={5} meta="Awaiting an exchange licence">
          <div className="provider-empty">
            <span className="provider-orbit">◌</span>
            <strong>No data yet</strong>
            <p>
              Prices, market capitalisation and the ratios that depend on them need a market-data
              licence from the Nigerian Exchange. Nothing else on this page waits on it.
            </p>
          </div>
        </Panel>

        <Panel title="Documents" span={7} meta="Reviewed before they appear">
          {!documents.ok ? (
            <Notice tone="caution">{documents.error}</Notice>
          ) : documents.data.length > 0 ? (
            <ul className="doc-list">
              {documents.data.map((document) => (
                <li key={document.id}>
                  {/* Readers are sent to the issuer's own copy, never to our
                      stored one: that is licensed material behind a signed URL. */}
                  {document.sourceUri ? (
                    <a href={document.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                      {document.title}
                    </a>
                  ) : (
                    <span>{document.title}</span>
                  )}{" "}
                  <span>
                    {DOCUMENT_KINDS[document.kind] ?? document.kind} ·{" "}
                    {formatDate(document.publishedAt ?? document.reviewedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="provider-empty">
              <span className="provider-orbit">◌</span>
              <strong>No documents yet</strong>
              <p>Annual reports, interim results and other filings appear here once reviewed.</p>
            </div>
          )}
        </Panel>

        <Panel title="Announcements" span={6}>
          {!announcements.ok ? (
            <Notice tone="caution">{announcements.error}</Notice>
          ) : announcements.data.length > 0 ? (
            <div className="review-list">
              {announcements.data.map((announcement) => (
                <article className="review-row" key={announcement.id}>
                  <div className="review-row-main">
                    <strong>{announcement.headline}</strong>
                    <p className="review-row-meta">
                      {ANNOUNCEMENT_CATEGORY_LABELS[announcement.category as AnnouncementCategory] ??
                        announcement.category}{" "}
                      · {formatDate(announcement.announcedAt)}
                      {announcement.version > 1 ? " · Corrected" : ""}
                      {announcement.status === "withdrawn" ? " · Withdrawn" : ""}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="provider-empty">
              <span className="provider-orbit">◌</span>
              <strong>No announcements yet</strong>
              <p>
                What the company tells the market appears here, published from an approved filing.
              </p>
            </div>
          )}
        </Panel>

        <Panel title="SFI research" span={6}>
          {!research.ok ? (
            <Notice tone="caution">{research.error}</Notice>
          ) : research.data.length > 0 ? (
            <ul className="doc-list">
              {research.data.map((item) => (
                <li key={item.id}>
                  <Link href={`/research/${item.slug}`}>{item.title}</Link>{" "}
                  <span>
                    {EDITORIAL_KIND_LABELS[item.kind]} · {formatDate(item.publishedAt)}
                    {item.aiAssisted ? " · AI-assisted" : ""}
                    {item.status === "withdrawn" ? " · Withdrawn" : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="provider-empty">
              <span className="provider-orbit">◌</span>
              <strong>No research yet</strong>
              <p>SFI articles and analysis that cite this company appear here.</p>
            </div>
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
