import type { Metadata } from "next";
import Link from "next/link";
import { DefinitionList, Notice, Panel, PanelGrid } from "@/components/terminal/ui";
import { OverviewTiles, type HeadlineYear } from "@/components/terminal/company-panels";
import { CoveragePanel } from "@/components/terminal/coverage-panel";
import { LeadershipPanel } from "@/components/terminal/leadership-panel";
import { listAnnouncementsForCompany } from "@/lib/data/announcements";
import { listEditorialForCompany } from "@/lib/data/editorial";
import { listLeadershipForCompany } from "@/lib/data/people";
import {
  assignmentFor,
  listFinancialsForCompany,
  listTemplateAssignments,
  listTemplateLines,
  type ReaderStatement,
} from "@/lib/data/financials";
import { coverageScore } from "@/lib/metrics/coverage";
import { listCompanyMetrics, listMetricDefinitions } from "@/lib/data/metrics";
import { ANNOUNCEMENT_CATEGORY_LABELS, type AnnouncementCategory } from "@/lib/announcements/validation";
import { EDITORIAL_KIND_LABELS } from "@/lib/editorial/validation";
import {
  CompanyFrame,
  companyForTab,
  companyTabMetadata,
  formatDate,
  LISTING_STATUS_LABELS,
  panel,
} from "./shared";

type Props = { params: Promise<{ slug: string }> };

/** The pilot window: FY2021 to FY2025, as the roadmap and the figures desk use. */
const COVERAGE_YEARS = [2021, 2022, 2023, 2024, 2025] as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return companyTabMetadata(slug, "Overview");
}

/**
 * The one financial year the headline tiles describe.
 *
 * The latest full year held, on the basis that year is read on: consolidated
 * where the company published consolidated figures, otherwise company-only.
 * Audited only when every statement of that year and basis says so — a year
 * assembled from an audited balance sheet and an unaudited release is not an
 * audited year.
 */
function headlineYear(statements: readonly ReaderStatement[]): HeadlineYear | null {
  const annual = statements.filter((statement) => statement.periodType === "FY");
  if (annual.length === 0) return null;

  const periodEnd = annual
    .map((statement) => statement.periodEnd.slice(0, 10))
    .sort()
    .at(-1) as string;

  const forYear = annual.filter((statement) => statement.periodEnd.slice(0, 10) === periodEnd);
  const consolidated = forYear.some((statement) => statement.consolidated);
  const onBasis = forYear.filter((statement) => statement.consolidated === consolidated);

  return {
    financialYear: Number(periodEnd.slice(0, 4)),
    periodEnd,
    consolidated,
    currency: onBasis[0].currency,
    audited: onBasis.every((statement) => statement.audited),
  };
}

export default async function CompanyOverviewPage({ params }: Props) {
  const { slug } = await params;
  const company = await companyForTab(slug, "");

  // Each panel stands or falls on its own: a failing query reports itself rather
  // than taking the page down, and an empty result is never dressed up as a
  // failure.
  const [headline, announcements, research, leadership] = await Promise.all([
    panel(
      Promise.all([
        listFinancialsForCompany(company.id),
        listCompanyMetrics(company.id),
        listMetricDefinitions(),
      ]),
      "Could not load the headline figures.",
    ),
    panel(listAnnouncementsForCompany(company.id), "Could not load announcements."),
    panel(listEditorialForCompany(company.id), "Could not load research."),
    panel(listLeadershipForCompany(company.id), "Could not load leadership."),
  ]);

  // Coverage is loaded on its own: a failure there costs the page one panel, not
  // its headline figures.
  const coverage = await panel(
    Promise.all([listTemplateLines(), listTemplateAssignments()]),
    "Could not work out how much of the history is held.",
  );
  // The sector template in force now decides which figures count as required.
  const sectorTemplate = coverage.ok
    ? (assignmentFor(coverage.data[1], company.id, "9999-12-31")?.templateId ?? null)
    : null;

  return (
    <CompanyFrame company={company} tab="">
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

        <Panel title="Headline figures" span={7} meta="One financial year, named below">
          {!headline.ok ? (
            <Notice tone="caution">{headline.error}</Notice>
          ) : (
            <OverviewTiles
              year={headlineYear(headline.data[0])}
              statements={headline.data[0]}
              metrics={headline.data[1]}
              definitions={headline.data[2]}
            />
          )}
        </Panel>

        <Panel title="How much we hold" span={5} meta="Only years a person has checked">
          {!coverage.ok || !headline.ok ? (
            <Notice tone="caution">
              {!coverage.ok ? coverage.error : "Could not load the figures this is counted from."}
            </Notice>
          ) : (
            <CoveragePanel
              score={coverageScore({
                years: COVERAGE_YEARS,
                statements: headline.data[0]
                  .filter((statement) => statement.periodType === "FY")
                  .map((statement) => ({
                    financialYear: Number(statement.periodEnd.slice(0, 4)),
                    statementType: statement.statementType,
                    lineItems: statement.figures.map((figure) => figure.lineItem),
                  })),
                required: coverage.data[0]
                  .filter(
                    (line) =>
                      line.isRequired &&
                      (line.templateId === "core" || line.templateId === sectorTemplate),
                  )
                  .map((line) => ({
                    statementType: line.statementType,
                    lineItem: line.lineItem,
                    label: line.label,
                  })),
              })}
            />
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
            <span className="provider-orbit">&#9676;</span>
            <strong>No data yet</strong>
            <p>
              Prices, market capitalisation and the ratios that depend on them need a market-data
              licence from the Nigerian Exchange. Nothing else on this page waits on it.
            </p>
          </div>
        </Panel>

        <Panel title="Announcements" span={7}>
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
              <span className="provider-orbit">&#9676;</span>
              <strong>No announcements yet</strong>
              <p>What the company tells the market appears here, published from an approved filing.</p>
            </div>
          )}
        </Panel>

        <Panel title="SFI research" span={12}>
          {!research.ok ? (
            <Notice tone="caution">{research.error}</Notice>
          ) : research.data.length > 0 ? (
            <ul className="doc-list">
              {research.data.map((item) => (
                <li key={item.id}>
                  <Link href={"/research/" + item.slug}>{item.title}</Link>{" "}
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
              <span className="provider-orbit">&#9676;</span>
              <strong>No research yet</strong>
              <p>SFI articles and analysis that cite this company appear here.</p>
            </div>
          )}
        </Panel>
      </PanelGrid>
    </CompanyFrame>
  );
}
