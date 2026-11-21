import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, unstable_rethrow } from "next/navigation";
import { DefinitionList, Notice, PageHeader, Panel, PanelGrid } from "@/components/terminal/ui";
import {
  currentPersonSlugForFormerSlug,
  getPersonBySlug,
  type HeldOffice,
  type PersonProfile,
} from "@/lib/data/people";
import { formatTenure, formatTenureDate, normalizePersonSlug } from "@/lib/people/validation";
import { TenurePerformancePanel } from "@/components/terminal/tenure-performance-panel";

type Props = { params: Promise<{ slug: string }> };

/**
 * One address, two ways in.
 *
 * The slug is the person's own address. A slug they used to carry redirects
 * permanently, because the page really has moved — a married name, a corrected
 * spelling. There is no ticker equivalent here, so unlike a company page there
 * is no temporary redirect to make.
 *
 * Returns the person or a destination; the redirect happens in the caller,
 * because permanentRedirect() throws and must not sit inside a try block.
 */
async function resolve(
  raw: string,
): Promise<{ person: PersonProfile } | { moved: string } | { missing: true }> {
  const slug = normalizePersonSlug(raw);
  if (!slug) return { missing: true };

  const person = await getPersonBySlug(slug);
  if (person) return { person };

  const current = await currentPersonSlugForFormerSlug(slug);
  if (current) return { moved: current };

  return { missing: true };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: raw } = await params;
  const slug = normalizePersonSlug(raw);
  if (!slug) return { title: "Person" };
  try {
    const person = await getPersonBySlug(slug);
    return { title: person?.fullName ?? "Person" };
  } catch (error) {
    unstable_rethrow(error);
    // A title is not worth failing a page over.
    return { title: "Person" };
  }
}

function OfficeRow({ office }: { office: HeldOffice }) {
  const tenure = formatTenure(
    office.validFrom,
    office.validFromPrecision,
    office.validTo,
    office.validToPrecision,
  );

  const sourceLabel = office.sourceTitle
    ? office.sourcePage
      ? `${office.sourceTitle}, page ${office.sourcePage}`
      : office.sourceTitle
    : null;

  return (
    <article className="review-row">
      <div className="review-row-main">
        <strong>
          {office.roleTitle ?? office.roleName}
          {office.isActing ? " (acting)" : ""}
        </strong>
        <p>
          {office.companySlug ? (
            <Link href={`/companies/${office.companySlug}`}>{office.companyName}</Link>
          ) : (
            office.companyName
          )}
          {office.companySymbol ? <span className="sym"> {office.companySymbol}</span> : null}
          {tenure ? ` · ${tenure}` : ""}
        </p>
        <p className="review-row-meta">
          {sourceLabel ? (
            office.sourceUri ? (
              <a href={office.sourceUri} rel="noopener noreferrer nofollow" target="_blank">
                {sourceLabel}
              </a>
            ) : (
              sourceLabel
            )
          ) : (
            "Source not recorded"
          )}
          {office.lastConfirmedOn
            ? ` · Last confirmed: ${formatTenureDate(office.lastConfirmedOn, "day")}`
            : ""}
        </p>
      </div>
    </article>
  );
}

export default async function PersonPage({ params }: Props) {
  const { slug: raw } = await params;
  const resolved = await resolve(raw);

  if ("missing" in resolved) notFound();
  if ("moved" in resolved) permanentRedirect(`/people/${resolved.moved}`);

  const person = resolved.person;
  const current = person.offices.filter((office) => !office.validTo);
  const former = person.offices.filter((office) => office.validTo);
  const companies = new Set(person.offices.map((office) => office.companySlug || office.companyName));

  return (
    <>
      <PageHeader
        code="LD"
        title={`${person.honorific ? `${person.honorific} ` : ""}${person.fullName}`}
        description={
          current.length > 0
            ? current
                .map((office) => `${office.roleTitle ?? office.roleName}, ${office.companyName}`)
                .join(" · ")
            : "No office currently held, on the record we hold."
        }
      />

      <PanelGrid>
        <Panel title="Offices held" span={8} meta="Each cites the filing it comes from">
          {current.length > 0 ? (
            <>
              <p className="panel-note">CURRENT</p>
              <div className="review-list">
                {current.map((office) => (
                  <OfficeRow office={office} key={office.id} />
                ))}
              </div>
            </>
          ) : null}
          {former.length > 0 ? (
            <>
              <p className="panel-note">FORMERLY</p>
              <div className="review-list">
                {former.map((office) => (
                  <OfficeRow office={office} key={office.id} />
                ))}
              </div>
            </>
          ) : null}
          <p className="panel-note">
            Dates are shown exactly as precisely as the source gives them. Offices are recorded as
            reported and are not a judgement of the person named.
          </p>
        </Panel>

        <Panel title="On the record" span={4}>
          <DefinitionList
            items={[
              { term: "Offices held", detail: String(person.offices.length) },
              { term: "Companies", detail: String(companies.size) },
              {
                term: "Currently",
                detail:
                  current.length > 0
                    ? current.map((office) => office.roleTitle ?? office.roleName).join(" · ")
                    : "Nothing current on our record",
              },
              {
                term: "What we hold",
                detail:
                  "Name, the title each filing gives, the company and the dates. No date of birth, address, family, photographs or pay.",
              },
              {
                term: "If this is wrong",
                detail:
                  "An office we get wrong is withdrawn and stops being published, with the reason kept in the record. Write to the research desk.",
              },
            ]}
          />
        </Panel>

        <Panel title="Company performance during tenure" span={12} meta="Sourced figures, no scores">
          {/* Figures arrive at stage 3c. Until then every office reports none,
              and the panel says so rather than implying a company has no
              results. The shape is already the one 3d will fill, so lighting it
              up is a matter of supplying rows — not of rewriting the panel and
              rediscovering the rule it has to obey. */}
          <TenurePerformancePanel
            offices={person.offices.map((office) => ({ office, figures: [] }))}
          />
        </Panel>
      </PanelGrid>

      <Notice tone="info">
        Built from the companies&apos; own filings and announcements. Every office above links to the
        document and page it was taken from.
      </Notice>
    </>
  );
}
