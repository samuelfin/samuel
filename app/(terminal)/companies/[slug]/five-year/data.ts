import "server-only";
import {
  assignmentFor,
  listFinancialsForCompany,
  listTemplateAssignments,
  listTemplateLines,
} from "@/lib/data/financials";
import { listCompanyMetrics, listMetricDefinitions } from "@/lib/data/metrics";
import { coverageScore } from "@/lib/metrics/coverage";
import { seriesYears, type FigureSource } from "@/lib/metrics/series";
import { fiveYearSheets, type FiveYearInput } from "@/lib/export/five-year";
import type { Sheet } from "@/lib/export/xlsx";
import type { CompanyProfile } from "@/lib/data/companies";

/**
 * The five-year comparison, assembled once for both the workbook and the
 * printable page.
 *
 * Everything is read through the reader's own loaders, so the file and the page
 * see exactly what the company page sees: approved figures of an approved
 * company whose dataset is licensed for display. There is deliberately no
 * service-role client here — a download that read with elevated rights would
 * hand a reader figures the page refuses them, and the licence gate would stop
 * at the screen.
 */

/** The pilot window, as the roadmap and the figures desk use it. */
export const FIVE_YEAR_WINDOW = [2021, 2022, 2023, 2024, 2025] as const;

export async function fiveYearWorkbook(company: CompanyProfile): Promise<{
  sheets: Sheet[];
  years: number[];
}> {
  const [statements, metrics, definitions, templateLines, assignments] = await Promise.all([
    listFinancialsForCompany(company.id),
    listCompanyMetrics(company.id),
    listMetricDefinitions(),
    listTemplateLines(),
    listTemplateAssignments(),
  ]);

  const annual = statements.filter((statement) => statement.periodType === "FY");
  const figures: FigureSource[] = annual.flatMap((statement) =>
    statement.figures.map((figure) => ({
      financialYear: Number(statement.periodEnd.slice(0, 4)),
      lineItem: figure.lineItem,
      valueStandardised: figure.valueStandardised,
      reported: figure.valueReported + " " + figure.reportedMagnitude,
      sourcePage: figure.sourcePage,
      documentTitle: statement.sourceTitle,
      sourceUri: statement.sourceUri,
      audited: statement.audited,
      consolidated: statement.consolidated,
      currency: statement.currency,
    })),
  );

  // The window is the pilot's five years, widened only by years actually held,
  // so a company with history outside it is not silently truncated.
  const held = seriesYears(
    [...FIVE_YEAR_WINDOW, ...figures.map((figure) => figure.financialYear)],
    Math.max(5, new Set(figures.map((figure) => figure.financialYear)).size),
  );
  const years = held.length > 0 ? held : [...FIVE_YEAR_WINDOW];

  const sectorTemplate = assignmentFor(assignments, company.id, "9999-12-31")?.templateId ?? null;
  const required = templateLines
    .filter(
      (line) =>
        line.isRequired && (line.templateId === "core" || line.templateId === sectorTemplate),
    )
    .map((line) => ({
      statementType: line.statementType,
      lineItem: line.lineItem,
      label: line.label,
    }));

  const input: FiveYearInput = {
    company: { name: company.name, symbol: company.symbol, sector: company.sector },
    generatedAt: new Date().toISOString(),
    years,
    figures,
    figureLabels: new Map(templateLines.map((line) => [line.lineItem, line.label])),
    metrics: metrics.map((metric) => ({
      code: metric.code,
      financialYear: metric.financialYear,
      status: metric.status,
      reason: metric.reason,
      value: metric.value,
      definitionVersion: metric.definitionVersion,
      currency: metric.currency,
      consolidated: metric.consolidated,
      allAudited: metric.allAudited,
      disclosedPage: metric.disclosedPage,
    })),
    definitions,
    coverage: coverageScore({
      years,
      required,
      statements: annual.map((statement) => ({
        financialYear: Number(statement.periodEnd.slice(0, 4)),
        statementType: statement.statementType,
        lineItems: statement.figures.map((figure) => figure.lineItem),
      })),
    }),
  };

  return { sheets: fiveYearSheets(input), years };
}
