import type { Metadata } from "next";
import { ChartFrame, DataTable, DefinitionList, Notice, PageHeader, Panel, PanelGrid, Unavailable } from "@/components/terminal/ui";
import { RangeSelector } from "@/components/terminal/range-selector";
import { getAuctionResults, getInstruments, getYieldCurve } from "@/lib/data/fixed-income";
import { INSTRUMENT_CLASSES, RATE_CONCEPTS } from "@/lib/catalog/fixed-income";
import { PROVIDERS } from "@/lib/providers/registry";
import { formatAsOf, formatDecimal } from "@/lib/format";

export const metadata: Metadata = { title: "Fixed Income" };

export default async function FixedIncomePage() {
  const [instruments, auctions, curve] = await Promise.all([getInstruments(), getAuctionResults(), getYieldCurve()]);

  return (
    <>
      <PageHeader code="FI" title="Fixed Income" description="FGN bonds, Treasury bills, savings bonds, sukuk and corporate bonds. Coupons, auction rates, market yields and indicative quotes are never mixed." />
      <PanelGrid>
        <Panel title="Rate concepts" span={5}>
          <DefinitionList items={RATE_CONCEPTS.map((c) => ({ term: c.name, detail: c.definition, tag: c.id === "indicative" ? "Not executable" : undefined }))} />
        </Panel>
        <Panel title="Yield curve" span={7} actions={<RangeSelector disabled={curve.state !== "ok"} initial="1D" label="Curve date range" />}>
          <ChartFrame label="FGN yield curve" missing={curve.state === "unavailable" ? curve : undefined} height={240} />
          <Notice tone="caution">Every curve is labelled with its rate concept and date. Indicative quotes are information only and are not executable prices.</Notice>
        </Panel>

        <Panel title="Primary auction results" span={12} flush>
          <DataTable
            caption="Primary auction results"
            columns={[
              { key: "date", label: "Auction date" },
              { key: "instrument", label: "Instrument" },
              { key: "tenor", label: "Tenor" },
              { key: "offered", label: "Offered ₦", numeric: true },
              { key: "subscribed", label: "Subscribed ₦", numeric: true },
              { key: "allotted", label: "Allotted ₦", numeric: true },
              { key: "stop", label: "Stop rate % p.a.", numeric: true },
            ]}
            rows={
              auctions.state === "ok"
                ? auctions.data.map((a) => ({
                    key: a.id,
                    cells: {
                      date: formatAsOf(a.auctionDate, false),
                      instrument: a.instrument,
                      tenor: a.tenor,
                      offered: formatDecimal(a.offered.value, 0),
                      subscribed: formatDecimal(a.subscribed.value, 0),
                      allotted: formatDecimal(a.allotted.value, 0),
                      stop: formatDecimal(a.stopRate.value, 2, 4),
                    },
                  }))
                : []
            }
            empty={auctions.state === "unavailable" && <Unavailable result={auctions} />}
          />
        </Panel>

        <Panel title="Instruments" span={12} flush>
          <DataTable
            caption="Fixed-income instruments"
            columns={[
              { key: "name", label: "Instrument" },
              { key: "issuer", label: "Issuer" },
              { key: "issue", label: "Issue date" },
              { key: "maturity", label: "Maturity" },
              { key: "coupon", label: "Coupon % p.a.", numeric: true },
              { key: "outstanding", label: "Outstanding ₦", numeric: true },
            ]}
            rows={
              instruments.state === "ok"
                ? instruments.data.map((i) => ({
                    key: i.id,
                    cells: {
                      name: i.name,
                      issuer: i.issuer,
                      issue: formatAsOf(i.issueDate, false),
                      maturity: formatAsOf(i.maturityDate, false),
                      coupon: i.coupon ? formatDecimal(i.coupon.value, 2, 4) : undefined,
                      outstanding: i.outstanding ? formatDecimal(i.outstanding.value, 0) : undefined,
                    },
                  }))
                : []
            }
            empty={instruments.state === "unavailable" && <Unavailable result={instruments} />}
          />
        </Panel>

        <Panel title="Instrument classes and sources" span={12}>
          <DefinitionList
            items={INSTRUMENT_CLASSES.map((c) => ({
              id: c.id,
              term: c.name,
              tag: [c.primarySource, c.secondarySource].filter(Boolean).map((p) => PROVIDERS[p!].shortName).join(" · "),
              detail: `${c.issuer}. ${c.notes}`,
            }))}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
