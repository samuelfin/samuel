import type { Metadata } from "next";
import Link from "next/link";
import { Change, DataTable, MetricTile, PageHeader, Panel, PanelGrid, StatusBadge, Unavailable } from "@/components/terminal/ui";
import { getIndexQuotes, getMarketActivity, getMarketBreadth, getMovers, getSectorPerformance, type EquityQuote } from "@/lib/data/markets";
import { getIndicatorRows } from "@/lib/data/economy";
import { getAiAssistantStatus, getWorkspaceItems } from "@/lib/data/content";
import { listPublishedAnnouncements } from "@/lib/data/announcements";
import { HEADLINE_INDICATOR_IDS, unitLabel } from "@/lib/catalog/indicators";
import { NGX_SECTORS } from "@/lib/catalog/markets";
import { ACCESS_LABEL, DATASETS, PROVIDERS, RIGHTS_LABEL, isConnected, type DatasetId } from "@/lib/providers/registry";
import { EMPTY, formatAsOf, formatDecimal } from "@/lib/format";
import type { DataResult } from "@/lib/market-data/types";
import { unstable_rethrow } from "next/navigation";

export const metadata: Metadata = { title: "Overview" };

const MOVER_COLUMNS = [
  { key: "symbol", label: "Symbol" },
  { key: "last", label: "Last ₦", numeric: true },
  { key: "chg", label: "Chg %", numeric: true },
  { key: "volume", label: "Volume", numeric: true },
];

function moverRows(result: DataResult<EquityQuote[]>) {
  if (result.state !== "ok") return [];
  return result.data.slice(0, 8).map((q) => ({
    key: q.symbol,
    cells: {
      symbol: <Link className="sym" href={`/companies/${q.symbol}`}>{q.symbol}</Link>,
      last: formatDecimal(q.last.value),
      chg: <Change value={q.changePct.value} />,
      volume: formatDecimal(q.volume.value, 0),
    },
  }));
}

export default async function OverviewPage() {
  const [indices, activity, breadth, gainers, losers, active, sectors, indicators, news, watchlists, ai] = await Promise.all([
    getIndexQuotes(),
    getMarketActivity(),
    getMarketBreadth(),
    getMovers("gainers"),
    getMovers("losers"),
    getMovers("active"),
    getSectorPerformance(),
    getIndicatorRows(HEADLINE_INDICATOR_IDS),
    // One panel must not take the whole dashboard down. The loader throws so a
    // broken query is never mistaken for an empty feed; here that is caught and
    // shown as a failure in this panel, which is neither silent nor fatal.
    // A failing feed is reported in its own panel rather than taking the
    // Overview down — but Next signals redirect(), notFound() and prerender
    // bailouts by throwing, and swallowing one of those would strand a reader on
    // a half-rendered page instead of sending them to the login screen.
    listPublishedAnnouncements(5).catch((error: unknown) => {
      unstable_rethrow(error);
      return null;
    }),
    getWorkspaceItems("watchlists"),
    getAiAssistantStatus(),
  ]);

  const asi = indices.state === "ok" ? indices.data.find((q) => q.indexId === "ngx-asi") : undefined;
  const indicesMissing = indices.state === "unavailable" ? indices : undefined;
  const activityMissing = activity.state === "unavailable" ? activity : undefined;
  const act = activity.state === "ok" ? activity.data : undefined;

  const providerRows = Object.values(PROVIDERS).map((p) => {
    const datasets = (Object.keys(DATASETS) as DatasetId[]).filter((d) => DATASETS[d] === p.id);
    const connected = datasets.filter(isConnected).length;
    return {
      key: p.id,
      cells: {
        provider: p.shortName,
        coverage: p.coverage,
        access: ACCESS_LABEL[p.access],
        rights: RIGHTS_LABEL[p.rights],
        datasets: datasets.length ? `${connected} / ${datasets.length}` : EMPTY,
      },
    };
  });

  return (
    <>
      <PageHeader code="OVR" title="Overview" description="Nigerian market summary, movers, indicators and sources at a glance." />
      <PanelGrid>
        <Panel title="Market summary" code="MKT" span={8} meta={<Link href="/markets">Markets →</Link>}>
          <div className="metric-row">
            <MetricTile label="NGX All-Share Index" observation={asi?.level} missing={indicesMissing} />
            <MetricTile label="ASI change" observation={asi?.changePct} missing={indicesMissing} suffix="%" />
            <MetricTile label="Market cap ₦" observation={act?.marketCap} missing={activityMissing} dp={0} />
            <MetricTile label="Volume (shares)" observation={act?.volume} missing={activityMissing} dp={0} />
            <MetricTile label="Value traded ₦" observation={act?.value} missing={activityMissing} dp={0} />
          </div>
          <div className="breadth">
            <span className="breadth-item is-up">Advancing <b className="num">{breadth.state === "ok" ? breadth.data.advancing : EMPTY}</b></span>
            <span className="breadth-item is-down">Declining <b className="num">{breadth.state === "ok" ? breadth.data.declining : EMPTY}</b></span>
            <span className="breadth-item">Unchanged <b className="num">{breadth.state === "ok" ? breadth.data.unchanged : EMPTY}</b></span>
            {breadth.state === "ok" ? <span className="breadth-asof">As of {formatAsOf(breadth.asOf)}</span> : <span className="breadth-asof">Breadth unavailable — {breadth.message}</span>}
          </div>
        </Panel>

        <Panel title="AI market briefing" code="AI" span={4}>
          {ai.state === "unavailable" && <Unavailable result={ai} compact />}
          <p className="panel-note">When enabled, the briefing summarises the session from connected data only, with a citation and as-of time on every figure.</p>
        </Panel>

        <Panel title="Top gainers" span={4} flush>
          <DataTable caption="Top gainers" columns={MOVER_COLUMNS} rows={moverRows(gainers)} empty={gainers.state === "unavailable" && <Unavailable result={gainers} compact />} />
        </Panel>
        <Panel title="Top losers" span={4} flush>
          <DataTable caption="Top losers" columns={MOVER_COLUMNS} rows={moverRows(losers)} empty={losers.state === "unavailable" && <Unavailable result={losers} compact />} />
        </Panel>
        <Panel title="Most active" span={4} flush>
          <DataTable caption="Most active by volume" columns={MOVER_COLUMNS} rows={moverRows(active)} empty={active.state === "unavailable" && <Unavailable result={active} compact />} />
        </Panel>

        <Panel title="Economic indicators" code="ECO" span={7} flush meta={<Link href="/economy">Economy →</Link>}>
          <DataTable
            caption="Headline Nigerian economic indicators"
            columns={[
              { key: "name", label: "Indicator" },
              { key: "latest", label: "Latest", numeric: true },
              { key: "unit", label: "Unit" },
              { key: "period", label: "Period" },
              { key: "source", label: "Source" },
              { key: "status", label: "Status" },
            ]}
            rows={indicators.map(({ definition, latest }) => ({
              key: definition.id,
              cells: {
                name: <Link href={`/economy#${definition.id}`}>{definition.name}</Link>,
                latest: latest.state === "ok" ? formatDecimal(latest.data.value) : EMPTY,
                unit: unitLabel(definition.unit, definition.magnitude),
                period: latest.state === "ok" && latest.data.period ? `${latest.data.period.start} – ${latest.data.period.end}` : EMPTY,
                source: PROVIDERS[definition.source].shortName,
                status: <StatusBadge status={latest.state === "ok" ? latest.data.status : "unavailable"} />,
              },
            }))}
          />
        </Panel>

        <Panel title="Sector overview" span={5} flush>
          <DataTable
            caption="NGX sector performance"
            columns={[
              { key: "sector", label: "Sector" },
              { key: "chg", label: "Chg %", numeric: true },
            ]}
            rows={NGX_SECTORS.map((sector) => {
              const row = sectors.state === "ok" ? sectors.data.find((s) => s.sector === sector) : undefined;
              return { key: sector, cells: { sector, chg: row ? <Change value={row.changePct.value} /> : EMPTY } };
            })}
          />
          {sectors.state === "unavailable" && <div className="panel-foot"><Unavailable result={sectors} compact /></div>}
        </Panel>

        <Panel title="Watchlist" code="WL" span={6}>
          {watchlists.state === "unavailable" && <Unavailable result={watchlists} compact />}
        </Panel>
        <Panel title="Recent news" code="NEWS" span={6}>
          {news === null ? (
            <p className="panel-note">Recent news could not be loaded.</p>
          ) : news.length === 0 ? (
            <p className="panel-note">No announcements have been published yet.</p>
          ) : (
            <ul className="story-list">
              {news.map((item) => (
                <li key={item.id}>
                  <a href={item.sourceUri} rel="noopener noreferrer" target="_blank">{item.headline}</a>
                  <span>
                    {item.status === "withdrawn" ? "Withdrawn · " : item.version > 1 ? "Corrected · " : ""}
                    {formatAsOf(item.announcedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Data sources" span={12} flush meta="Rights status per docs/DATA_PROVIDER_ASSESSMENT.md">
          <DataTable
            caption="Data providers, access model and rights status"
            columns={[
              { key: "provider", label: "Provider" },
              { key: "coverage", label: "Coverage" },
              { key: "access", label: "Access" },
              { key: "rights", label: "Rights" },
              { key: "datasets", label: "Connected datasets", numeric: true },
            ]}
            rows={providerRows}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
