import type { Metadata } from "next";
import { Change, ChartFrame, DataTable, MetricTile, PageHeader, Panel, PanelGrid, StatusBadge, Unavailable } from "@/components/terminal/ui";
import { RangeSelector } from "@/components/terminal/range-selector";
import { getIndexQuotes, getIndexSeries, getMarketActivity, getMarketBreadth } from "@/lib/data/markets";
import { NGX_INDICES } from "@/lib/catalog/markets";
import { EMPTY, formatAsOf, formatDecimal } from "@/lib/format";

export const metadata: Metadata = { title: "Markets" };

export default async function MarketsPage() {
  const [indices, series, breadth, activity] = await Promise.all([
    getIndexQuotes(),
    getIndexSeries("ngx-asi", "1M"),
    getMarketBreadth(),
    getMarketActivity(),
  ]);
  const act = activity.state === "ok" ? activity.data : undefined;
  const activityMissing = activity.state === "unavailable" ? activity : undefined;

  return (
    <>
      <PageHeader code="MKT" title="Markets" description="NGX indices, market breadth and trading activity. Each figure states whether it is real-time, delayed, end-of-day or historical." />
      <PanelGrid>
        <Panel title="NGX indices" span={7} flush>
          <DataTable
            caption="NGX index levels"
            columns={[
              { key: "name", label: "Index" },
              { key: "level", label: "Level", numeric: true },
              { key: "chg", label: "Chg %", numeric: true },
              { key: "asof", label: "As of" },
              { key: "status", label: "Status" },
            ]}
            rows={NGX_INDICES.map((index) => {
              const quote = indices.state === "ok" ? indices.data.find((q) => q.indexId === index.id) : undefined;
              return {
                key: index.id,
                cells: {
                  name: index.name,
                  level: quote ? formatDecimal(quote.level.value) : EMPTY,
                  chg: quote ? <Change value={quote.changePct.value} /> : EMPTY,
                  asof: quote ? formatAsOf(quote.level.asOf) : EMPTY,
                  status: <StatusBadge status={quote ? quote.level.status : "unavailable"} />,
                },
              };
            })}
          />
          {indices.state === "unavailable" && <div className="panel-foot"><Unavailable result={indices} compact /></div>}
        </Panel>

        <Panel title="Market breadth" span={5}>
          <div className="metric-row is-three">
            {(["advancing", "declining", "unchanged"] as const).map((key) => (
              <div className="metric" key={key}>
                <span className="metric-label">{key[0].toUpperCase() + key.slice(1)}</span>
                <strong className={`metric-value num ${key === "advancing" ? "is-up" : key === "declining" ? "is-down" : ""}`}>{breadth.state === "ok" ? breadth.data[key] : EMPTY}</strong>
                <span className="metric-foot">{breadth.state === "ok" ? formatAsOf(breadth.asOf) : <StatusBadge status="unavailable" />}</span>
              </div>
            ))}
          </div>
          {breadth.state === "unavailable" && <Unavailable result={breadth} compact />}
        </Panel>

        <Panel title="NGX All-Share Index" span={12} actions={<RangeSelector disabled={series.state !== "ok"} />}>
          <ChartFrame label="NGX All-Share Index history" missing={series.state === "unavailable" ? series : undefined} height={260} />
        </Panel>

        <Panel title="Market activity" span={12}>
          <div className="metric-row">
            <MetricTile label="Market cap ₦" observation={act?.marketCap} missing={activityMissing} dp={0} />
            <MetricTile label="Volume (shares)" observation={act?.volume} missing={activityMissing} dp={0} />
            <MetricTile label="Value traded ₦" observation={act?.value} missing={activityMissing} dp={0} />
            <MetricTile label="Deals" observation={act?.deals} missing={activityMissing} dp={0} />
          </div>
        </Panel>
      </PanelGrid>
    </>
  );
}
