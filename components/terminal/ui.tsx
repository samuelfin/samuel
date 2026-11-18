import type { ReactNode } from "react";
import { EMPTY, direction, formatAsOf, formatDecimal, formatSignedPercent } from "@/lib/format";
import { STATUS_META, UNAVAILABLE_LABEL } from "@/lib/market-data/status";
import type { DataStatus, Observation, Unavailable as UnavailableResult } from "@/lib/market-data/types";

/**
 * Server-compatible terminal primitives. Every value-bearing component shows status,
 * as-of time and source, or an explicit unavailable state — never a bare number.
 */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function PageHeader({ code, title, description, children }: { code: string; title: string; description: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        <span className="page-code">{code}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="page-head-aside">{children}</div>}
    </header>
  );
}

export type PanelSpan = 3 | 4 | 5 | 6 | 7 | 8 | 12;

export function Panel({
  title,
  code,
  span = 12,
  meta,
  actions,
  id,
  flush,
  children,
}: {
  title: string;
  code?: string;
  span?: PanelSpan;
  meta?: ReactNode;
  actions?: ReactNode;
  id?: string;
  /** Remove body padding (for edge-to-edge tables). */
  flush?: boolean;
  children: ReactNode;
}) {
  const headingId = `${id ?? slug(title)}-title`;
  return (
    <section id={id} className={cx("panel", `span-${span}`)} aria-labelledby={headingId}>
      <header className="panel-head">
        <h2 id={headingId}>
          {code && <span className="panel-code">{code}</span>}
          {title}
        </h2>
        {meta && <span className="panel-meta">{meta}</span>}
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className={cx("panel-body", flush && "is-flush")}>{children}</div>
    </section>
  );
}

export function PanelGrid({ children }: { children: ReactNode }) {
  return <div className="panel-grid">{children}</div>;
}

export function StatusBadge({ status }: { status: DataStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={`status-badge tone-${meta.tone}`} title={`${meta.label}: ${meta.description}`}>
      {meta.short}
    </span>
  );
}

/** Explicit "no data" block: reason, gate message and the dataset it refers to. */
export function Unavailable({ result, compact }: { result: UnavailableResult; compact?: boolean }) {
  return (
    <div className={cx("unavailable", compact && "is-compact")} role="note">
      <span className="unavailable-mark" aria-hidden="true">◌</span>
      <div className="unavailable-text">
        <strong>{UNAVAILABLE_LABEL[result.reason]}</strong>
        <p>{result.message}</p>
      </div>
      <code className="unavailable-dataset">{result.dataset}</code>
    </div>
  );
}

export function SourceLine({ observation }: { observation: Observation }) {
  return (
    <span className="source-line">
      <StatusBadge status={observation.status} />
      <span>{formatAsOf(observation.asOf)}</span>
      <span className="source-name">{observation.provenance.providerName}</span>
    </span>
  );
}

/** A single headline figure with its provenance, or an em dash and the reason it is missing. */
export function MetricTile({
  label,
  observation,
  missing,
  dp = 2,
  suffix,
}: {
  label: string;
  observation?: Observation;
  missing?: UnavailableResult;
  dp?: number;
  suffix?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong className="metric-value num">
        {observation ? formatDecimal(observation.value, dp) : EMPTY}
        {observation && suffix && <small>{suffix}</small>}
      </strong>
      <span className="metric-foot">
        {observation ? (
          <SourceLine observation={observation} />
        ) : (
          <>
            <StatusBadge status="unavailable" /> {missing ? UNAVAILABLE_LABEL[missing.reason] : "No data"}
          </>
        )}
      </span>
    </div>
  );
}

/** Signed percentage with muted green/red colouring and an arrow as a non-colour cue. */
export function Change({ value, dp = 2 }: { value?: string; dp?: number }) {
  const dir = direction(value);
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "";
  return (
    <span className={`chg is-${dir}`}>
      {arrow && <span aria-hidden="true">{arrow} </span>}
      {formatSignedPercent(value, dp)}
    </span>
  );
}

export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
  title?: string;
}

export interface Row {
  key: string;
  cells: Record<string, ReactNode>;
}

export function DataTable({ caption, columns, rows, empty }: { caption: string; columns: Column[]; rows: Row[]; empty?: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="dtable">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? "num" : undefined} title={c.title}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((c, i) =>
                i === 0 ? (
                  <th key={c.key} scope="row">{row.cells[c.key] ?? EMPTY}</th>
                ) : (
                  <td key={c.key} className={c.numeric ? "num" : undefined}>{row.cells[c.key] ?? EMPTY}</td>
                ),
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="dtable-empty">{empty ?? "No rows."}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Chart area with an explicit empty state. A charting library is added with the first real series. */
export function ChartFrame({ label, missing, height = 220 }: { label: string; missing?: UnavailableResult; height?: number }) {
  return (
    <div className="chart-frame" style={{ minHeight: height }} role="img" aria-label={`${label}: ${missing ? "no series connected" : "chart"}`}>
      <div className="chart-grid" aria-hidden="true" />
      {missing && <div className="chart-empty"><Unavailable result={missing} compact /></div>}
    </div>
  );
}

export function DefinitionList({ items }: { items: Array<{ term: string; detail: ReactNode; tag?: string; id?: string }> }) {
  return (
    <dl className="deflist">
      {items.map((item) => (
        <div key={item.term} id={item.id} className="deflist-row">
          <dt>
            {item.term}
            {item.tag && <span className="tag">{item.tag}</span>}
          </dt>
          <dd>{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "caution"; children: ReactNode }) {
  return <p className={`notice tone-${tone}`}>{children}</p>;
}
