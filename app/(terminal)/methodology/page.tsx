import type { Metadata } from "next";
import { Notice, PageHeader, Panel, PanelGrid } from "@/components/terminal/ui";
import { MethodologyList } from "@/components/terminal/methodology-list";
import { listMetricDefinitions, listMetricStatuses } from "@/lib/data/metrics";
import { panel } from "../companies/[slug]/shared";

export const metadata: Metadata = { title: "Methodology" };

/**
 * Every formula SFI publishes a number under.
 *
 * A reported figure can be checked against a page; a calculated one can only be
 * checked against its definition, so the definitions are published: the formula,
 * what it means in words, which version is in force, who owns it and who
 * approved it. A metric whose formula nobody has approved is listed by name and
 * status only — the formula itself is not methodology until somebody stands
 * behind it.
 *
 * Behind the login, like the rest of the terminal. A version for readers who
 * have not signed in arrives with the public front in Phase 5.
 */
export default async function MethodologyPage() {
  const [definitions, statuses] = await Promise.all([
    panel(listMetricDefinitions(), "Could not load the published formulas."),
    panel(listMetricStatuses(), "Could not load the formula statuses."),
  ]);

  return (
    <>
      <PageHeader
        code="METH"
        title="Methodology"
        description="Every ratio SFI calculates, the formula behind it, and who answers for it."
      />

      <PanelGrid>
        <Panel title="Calculated metrics" span={12} meta="One published version per metric">
          {!definitions.ok ? (
            <Notice tone="caution">{definitions.error}</Notice>
          ) : !statuses.ok ? (
            <Notice tone="caution">{statuses.error}</Notice>
          ) : (
            <MethodologyList definitions={definitions.data} statuses={statuses.data} />
          )}
        </Panel>

        <Panel title="What is not here" span={12} meta="Reported figures and valuation ratios">
          <div className="form-note">
            <p>
              A figure an issuer reported is not on this page, because it has no formula: it is
              entered from the filing and carries the page it appears on. That includes the ratios
              issuers disclose themselves — NPL ratio, capital adequacy, cost-to-income, net interest
              margin — which are shown as the issuer published them wherever they exist, in
              preference to anything SFI would divide out.
            </p>
            <p>
              Valuation ratios — price to earnings, price to book, dividend yield, market
              capitalisation — need share prices, and wait on a market-data licence from the Nigerian
              Exchange.
            </p>
            <p>
              No figure is converted between currencies. A company that reports in dollars has its
              ratios calculated in dollars and labelled as such.
            </p>
          </div>
        </Panel>
      </PanelGrid>
    </>
  );
}
