import type { Metadata } from "next";
import Link from "next/link";
import { Change, DataTable, PageHeader, Panel, PanelGrid, StatusBadge, Unavailable } from "@/components/terminal/ui";
import { getEquityQuotes } from "@/lib/data/markets";
import { NGX_SECTORS } from "@/lib/catalog/markets";
import { formatAsOf, formatDecimal } from "@/lib/format";

export const metadata: Metadata = { title: "Equities" };

export default async function EquitiesPage() {
  const quotes = await getEquityQuotes();
  const disabled = quotes.state !== "ok";

  return (
    <>
      <PageHeader code="EQS" title="Equities" description="Listed NGX equities with prices, changes, volume and value. Prices are never shown without their status and as-of time." />
      <PanelGrid>
        <Panel title="Screener" span={12}>
          <form className="filters" aria-describedby="screener-note">
            <fieldset disabled={disabled}>
              <legend className="sr-only">Screen equities</legend>
              <label>
                Sector
                <select name="sector" defaultValue="">
                  <option value="">All sectors</option>
                  {NGX_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>
                Change %
                <select name="change" defaultValue="">
                  <option value="">Any</option>
                  <option value="up">Advancing</option>
                  <option value="down">Declining</option>
                  <option value="flat">Unchanged</option>
                </select>
              </label>
              <label>
                Min. value traded ₦
                <input name="minValue" inputMode="decimal" placeholder="e.g. 10000000" />
              </label>
              <button type="submit" className="btn">Apply</button>
            </fieldset>
          </form>
          {disabled && <p id="screener-note" className="panel-note">Filters activate once NGX price data is connected.</p>}
        </Panel>

        <Panel title="Listed equities" span={12} flush meta={quotes.state === "ok" ? `As of ${formatAsOf(quotes.asOf)}` : undefined}>
          <DataTable
            caption="Listed equities"
            columns={[
              { key: "symbol", label: "Symbol" },
              { key: "name", label: "Company" },
              { key: "sector", label: "Sector" },
              { key: "last", label: "Last ₦", numeric: true },
              { key: "prev", label: "Prev close ₦", numeric: true },
              { key: "chg", label: "Chg %", numeric: true },
              { key: "volume", label: "Volume", numeric: true },
              { key: "value", label: "Value ₦", numeric: true },
              { key: "status", label: "Status" },
            ]}
            rows={
              quotes.state === "ok"
                ? quotes.data.map((q) => ({
                    key: q.symbol,
                    cells: {
                      symbol: <Link className="sym" href={`/companies/${q.symbol}`}>{q.symbol}</Link>,
                      name: q.name,
                      sector: q.sector,
                      last: formatDecimal(q.last.value),
                      prev: formatDecimal(q.previousClose.value),
                      chg: <Change value={q.changePct.value} />,
                      volume: formatDecimal(q.volume.value, 0),
                      value: formatDecimal(q.value.value, 0),
                      status: <StatusBadge status={q.last.status} />,
                    },
                  }))
                : []
            }
            empty={quotes.state === "unavailable" && <Unavailable result={quotes} />}
          />
        </Panel>
      </PanelGrid>
    </>
  );
}
