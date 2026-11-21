import type { Metadata } from "next";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { DataTable, DefinitionList, Notice, PageHeader, Panel, PanelGrid } from "@/components/terminal/ui";
import { listPeople, type PersonCard } from "@/lib/data/people";

export const metadata: Metadata = { title: "Leadership" };

export default async function PeoplePage() {
  // The loader throws rather than returning an empty list, so a broken query is
  // never mistaken for an empty register. The panel reports the failure on its
  // own instead of taking the page down.
  let people: PersonCard[] | null = null;
  let failure: string | null = null;
  try {
    people = await listPeople();
  } catch (error) {
    // redirect(), notFound() and prerender bailouts all arrive as thrown
    // errors; reporting one as a panel failure would swallow it.
    unstable_rethrow(error);
    failure = error instanceof Error ? error.message : "The directory could not be loaded.";
  }

  return (
    <>
      <PageHeader
        code="LD"
        title="Leadership"
        description="Who runs Nigeria's listed companies, and since when — each office taken from the company's own filings."
      />
      <PanelGrid>
        <Panel
          title="People"
          span={8}
          flush
          meta={people ? `${people.length} on the register` : undefined}
        >
          {failure ? (
            <div className="panel-foot">
              <Notice tone="caution">{failure}</Notice>
            </div>
          ) : (
            <DataTable
              caption="People directory"
              columns={[
                { key: "name", label: "Name" },
                { key: "role", label: "Office" },
                { key: "offices", label: "Offices held" },
              ]}
              rows={(people ?? []).map((person) => ({
                key: person.slug,
                cells: {
                  name: (
                    <Link href={`/people/${person.slug}`}>
                      {person.honorific ? `${person.honorific} ` : ""}
                      {person.fullName}
                    </Link>
                  ),
                  role: person.headline,
                  offices: person.officeCount,
                },
              }))}
              empty={
                <div className="provider-empty">
                  <span className="provider-orbit">◌</span>
                  <strong>No data yet</strong>
                  <p>
                    Executives and board members appear here once an analyst has recorded an office
                    from a filing and someone has checked it. Nobody is listed on a name alone.
                  </p>
                </div>
              }
            />
          )}
        </Panel>

        <Panel title="What is recorded, and what is not" span={4}>
          <DefinitionList
            items={[
              {
                term: "Recorded",
                detail:
                  "Name, the title a filing gives, the company, and the dates each office began and ended — with the document page or announcement each comes from.",
              },
              {
                term: "Not recorded",
                detail:
                  "Date of birth, address, family, photographs, pay. None of it is held, and there is nowhere in the schema to put it.",
              },
              {
                term: "Dates",
                detail:
                  "Shown exactly as precisely as the filing gives them. A report that says 2015 is shown as 2015, never as a day in January.",
              },
              {
                term: "Corrections",
                detail:
                  "An office we get wrong is withdrawn and stops being published, with the reason kept in the record. Write to the research desk if something here is wrong.",
              },
              {
                term: "Performance",
                detail:
                  "A company's figures will be shown beside the dates of each tenure, sourced and dated. They are not a score, a ranking, or a claim about the individual.",
              },
            ]}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
