import type { Sheet, CellValue } from "./xlsx";
import {
  formulaText,
  reasonText,
  type MetricDefinition,
  type UnavailableReason,
} from "@/lib/metrics/definitions";
import { coverageSentence, type CoverageScore } from "@/lib/metrics/coverage";
import type { FigureSource } from "@/lib/metrics/series";

/**
 * The five-year comparison, as sheets.
 *
 * A file leaves the building and is read without the page around it, so each
 * sheet carries its own provenance: who it is about, when it was generated, and
 * the instruction that every figure traces to a filing named on the Sources
 * sheet. A spreadsheet of unattributed numbers is exactly what this platform
 * exists not to produce.
 *
 * Nothing is computed here. The figures are the ones a person checked against a
 * page; the ratios are the ones the database divided under an approved formula;
 * and a year with no answer carries its reason in words, never a zero — a zero
 * in a spreadsheet is a number somebody will chart.
 */

export interface FiveYearCompany {
  name: string;
  symbol: string | null;
  sector: string | null;
}

export interface FiveYearMetric {
  code: string;
  financialYear: number;
  status: "available" | "disclosed" | "not_available";
  reason: UnavailableReason | null;
  value: string | null;
  definitionVersion: number;
  currency: string;
  consolidated: boolean;
  allAudited: boolean | null;
  disclosedPage: number | null;
}

export interface FiveYearInput {
  company: FiveYearCompany;
  /** ISO instant. Shown on every sheet, so a stale copy is identifiable. */
  generatedAt: string;
  years: readonly number[];
  figures: readonly FigureSource[];
  figureLabels: ReadonlyMap<string, string>;
  metrics: readonly FiveYearMetric[];
  definitions: readonly MetricDefinition[];
  coverage: CoverageScore;
}

const SOURCE_LINE =
  "Every figure here is taken from a filing named on the Sources sheet, with its page. " +
  "Nothing is estimated, interpolated or carried forward.";

const HEADING_ROWS = 7;

function heading(input: FiveYearInput, sheet: string): CellValue[][] {
  const name = input.company.symbol
    ? input.company.name + " (" + input.company.symbol + ")"
    : input.company.name;
  return [
    ["Samuel Financial Intelligence — " + sheet],
    [name, input.company.sector ?? ""],
    ["Generated", input.generatedAt.slice(0, 19).replace("T", " ") + " UTC"],
    ["Coverage", coverageSentence(input.coverage)],
    ["Source", SOURCE_LINE],
    ["Note", "No figure is converted between currencies. Each is shown as the filing reported it."],
    [],
  ];
}

/** The figures, one row per line item, one column per year. */
function figuresSheet(input: FiveYearInput): Sheet {
  const lineItems = [...new Set(input.figures.map((figure) => figure.lineItem))];
  const rows: CellValue[][] = [
    ...heading(input, "Five-year figures"),
    ["Figure", ...input.years.map((year) => "FY" + year), "Currency", "Basis"],
  ];

  for (const lineItem of lineItems) {
    const forLine = input.figures.filter((figure) => figure.lineItem === lineItem);
    const first = forLine[0];
    rows.push([
      input.figureLabels.get(lineItem) ?? lineItem,
      ...input.years.map((year) => {
        const figure = forLine.find((entry) => entry.financialYear === year);
        return figure ? figure.valueStandardised : "Pending verification";
      }),
      first.currency,
      first.consolidated ? "Consolidated" : "Company only",
    ]);
  }

  if (lineItems.length === 0) {
    rows.push(["No figure has been entered and checked for this company yet."]);
  }
  return { name: "Figures", rows };
}

/** The ratios, with the formula version each year was computed under. */
function ratiosSheet(input: FiveYearInput): Sheet {
  const rows: CellValue[][] = [
    ...heading(input, "Five-year ratios"),
    ["Ratio", ...input.years.map((year) => "FY" + year), "Unit", "Formula version", "Basis"],
  ];
  const before = rows.length;

  for (const definition of input.definitions) {
    const forMetric = input.metrics.filter((metric) => metric.code === definition.code);
    if (forMetric.length === 0) continue;
    rows.push([
      definition.label,
      ...input.years.map((year) => {
        const metric = forMetric.find((entry) => entry.financialYear === year);
        if (!metric) return "Not calculated";
        if (metric.status === "not_available") {
          return reasonText(metric.reason ?? "input_missing", {
            kind: definition.kind,
            windowYears: definition.windowYears,
          });
        }
        const prefix = metric.status === "disclosed" ? "Reported by the issuer: " : "";
        return prefix + metric.value;
      }),
      definition.resultUnit === "percent"
        ? "per cent"
        : definition.resultUnit === "times"
          ? "times"
          : "currency",
      "v" + (forMetric[0]?.definitionVersion ?? definition.version),
      forMetric[0]?.consolidated ? "Consolidated" : "Company only",
    ]);
  }

  if (rows.length === before) {
    rows.push([
      "No ratio is published for this company. A ratio needs figures a person has checked and a formula a person has approved.",
    ]);
  }
  return { name: "Ratios", rows };
}

/** Where every figure came from: the filing, the page, the basis, the audit status. */
function sourcesSheet(input: FiveYearInput): Sheet {
  const rows: CellValue[][] = [
    ...heading(input, "Sources"),
    ["Figure", "Year", "As reported", "Page", "Filing", "Link", "Audited", "Basis", "Currency"],
  ];

  for (const figure of [...input.figures].sort(
    (a, b) => a.financialYear - b.financialYear || a.lineItem.localeCompare(b.lineItem),
  )) {
    rows.push([
      input.figureLabels.get(figure.lineItem) ?? figure.lineItem,
      "FY" + figure.financialYear,
      figure.reported,
      figure.sourcePage,
      figure.documentTitle ?? "",
      figure.sourceUri ?? "",
      figure.audited ? "Audited" : "Unaudited",
      figure.consolidated ? "Consolidated" : "Company only",
      figure.currency,
    ]);
  }

  // A disclosed ratio is a figure off a page too, and carries its own.
  for (const metric of input.metrics.filter((entry) => entry.status === "disclosed")) {
    const definition = input.definitions.find((entry) => entry.code === metric.code);
    rows.push([
      (definition?.label ?? metric.code) + " (as the issuer disclosed it)",
      "FY" + metric.financialYear,
      metric.value ?? "",
      metric.disclosedPage ?? "",
      "",
      "",
      metric.allAudited === null ? "" : metric.allAudited ? "Audited" : "Unaudited",
      metric.consolidated ? "Consolidated" : "Company only",
      metric.currency,
    ]);
  }

  return { name: "Sources", rows };
}

/** How each ratio was calculated, and who answers for the formula. */
function methodologySheet(input: FiveYearInput): Sheet {
  const rows: CellValue[][] = [
    ...heading(input, "How calculated"),
    [
      "Interim methodology",
      "No economist has reviewed these formulas. A reviewed definition is recorded as a new version, never an edit.",
    ],
    [],
    ["Ratio", "Formula", "In words", "Version", "In force from", "Owner", "Approved by"],
  ];

  for (const definition of input.definitions) {
    if (!input.metrics.some((metric) => metric.code === definition.code)) continue;
    rows.push([
      definition.label,
      formulaText(definition),
      definition.definition,
      "v" + definition.version,
      definition.effectiveFrom,
      definition.ownerName,
      (definition.approvedByName ?? "a platform administrator") +
        (definition.selfApproved ? ", who also recorded it" : ""),
    ]);
  }

  return { name: "How calculated", rows };
}

export function fiveYearSheets(input: FiveYearInput): Sheet[] {
  return [figuresSheet(input), ratiosSheet(input), sourcesSheet(input), methodologySheet(input)];
}

/** How many rows of provenance every sheet opens with. */
export const FIVE_YEAR_HEADING_ROWS = HEADING_ROWS;

/** The filename a reader gets: the slug and the year window, nothing a shell would mind. */
export function fiveYearFilename(slug: string, years: readonly number[]): string {
  const span = years.length > 0 ? years[0] + "-" + years[years.length - 1] : "five-year";
  return "sfi-" + slug.replace(/[^a-z0-9-]/gi, "-") + "-" + span + ".xlsx";
}
