import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DataTable, DefinitionList, MetricTile, PageHeader, Panel, PanelGrid, StatusBadge, Unavailable } from "@/components/terminal/ui";
import { getCompany, getCompanyDocuments, getFinancialStatements, normalizeSymbol, type StatementValue } from "@/lib/data/companies";
import { RATIOS, STATEMENT_LINE_ITEMS } from "@/lib/catalog/financials";
import { EMPTY, formatAsOf, formatDecimal } from "@/lib/format";
import type { DataResult } from "@/lib/market-data/types";

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  return { title: normalizeSymbol(symbol) ?? "Company" };
}

function StatementTable({ caption, result }: { caption: string; result: DataResult<StatementValue[]> }) {
  const values = result.state === "ok" ? result.data : [];
  const periods = Array.from(new Map(values.map((v) => [`${v.period.type}:${v.period.end}`, v.period])).values()).sort((a, b) => b.end.localeCompare(a.end));
  const columns = [
    { key: "item", label: "Line item" },
    ...(periods.length ? periods.map((p) => ({ key: `${p.type}:${p.end}`, label: `${p.type} to ${p.end}${p.audited === false ? " (unaudited)" : ""}`, numeric: true })) : [{ key: "none", label: "Period", numeric: true }]),
  ];
  return (
    <>
      <DataTable
        caption={caption}
        columns={columns}
        rows={STATEMENT_LINE_ITEMS.map((item) => ({
          key: item.id,
          cells: Object.fromEntries([
            ["item", item.label],
            ...periods.map((p) => {
              const v = values.find((x) => x.lineItem === item.id && x.period.end === p.end && x.period.type === p.type);
              return [`${p.type}:${p.end}`, v ? formatDecimal(v.value.value, 0) : EMPTY];
            }),
          ]),
        }))}
      />
      {result.state === "unavailable" && <div className="panel-foot"><Unavailable result={result} compact /></div>}
    </>
  );
}

export default async function CompanyPage({ params }: Props) {
  const { symbol: raw } = await params;
  const symbol = normalizeSymbol(raw);
  if (!symbol) notFound();

  const [company, annual, interim, documents] = await Promise.all([
    getCompany(symbol),
    getFinancialStatements(symbol, "annual"),
    getFinancialStatements(symbol, "interim"),
    getCompanyDocuments(symbol),
  ]);
  const profile = company.state === "ok" ? company.data : undefined;
  const missing = company.state === "unavailable" ? company : undefined;

  return (
    <>
      <PageHeader
        code={symbol}
        title={profile?.name ?? symbol}
        description={profile ? `${profile.sector} · ${profile.industry} · ${profile.listingBoard}` : "This symbol has no verified coverage yet. Sections below show what will appear once sources are connected."}
      >
        <StatusBadge status={company.state === "ok" ? company.status : "unavailable"} />
      </PageHeader>
      <PanelGrid>
        <Panel title="Company overview" span={5}>
          {profile ? (
            <DefinitionList
              items={[
                { term: "Business", detail: profile.description },
                { term: "Sector / industry", detail: `${profile.sector} / ${profile.industry}` },
                { term: "Listing", detail: profile.listingBoard },
                { term: "Website", detail: profile.website ? <a href={profile.website} rel="noopener noreferrer" target="_blank">{profile.website}</a> : EMPTY },
              ]}
            />
          ) : (
            missing && <Unavailable result={missing} compact />
          )}
        </Panel>
        <Panel title="Market information" span={7}>
          <div className="metric-row">
            <MetricTile label="Last price ₦" missing={missing} />
            <MetricTile label="Previous close ₦" missing={missing} />
            <MetricTile label="Change %" missing={missing} />
            <MetricTile label="Volume" missing={missing} />
            <MetricTile label="Market cap ₦" missing={missing} />
          </div>
        </Panel>

        <Panel title="Financial statements — annual" span={6} flush meta="₦, as reported">
          <StatementTable caption={`${symbol} annual financial statements`} result={annual} />
        </Panel>
        <Panel title="Financial statements — interim" span={6} flush meta="₦, as reported">
          <StatementTable caption={`${symbol} interim financial statements`} result={interim} />
        </Panel>

        <Panel title="Financial ratios" span={8} flush meta="Computed server-side from period-matched inputs">
          <DataTable
            caption="Financial ratio definitions"
            columns={[
              { key: "name", label: "Ratio" },
              { key: "value", label: "Value", numeric: true },
              { key: "formula", label: "Formula" },
              { key: "rule", label: "Period rule" },
            ]}
            rows={RATIOS.map((r) => ({ key: r.id, cells: { name: r.name, value: EMPTY, formula: r.formula, rule: r.periodRule } }))}
          />
        </Panel>
        <Panel title="Documents" span={4}>
          {documents.state === "ok" ? (
            <ul className="doc-list">
              {documents.data.map((d) => (
                <li key={d.id}><a href={d.sourceRef} rel="noopener noreferrer" target="_blank">{d.title}</a> <span>{formatAsOf(d.publishedAt, false)}</span></li>
              ))}
            </ul>
          ) : (
            <Unavailable result={documents} compact />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
