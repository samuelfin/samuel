import { describe, expect, it } from "vitest";
import {
  extent,
  figureSeries,
  metricSeries,
  seriesYears,
  valueRuns,
  type FigureSource,
  type MetricSource,
} from "./series";

/**
 * A chart and the table beside it are one array rendered twice, and a year with
 * no figure survives into both. These tests hold the second property, which is
 * the one a chart gets wrong: dropping an empty year closes the gap, and a line
 * drawn between two non-adjacent years is an interpolation nobody authorised.
 */

const figure = (financialYear: number, lineItem: string, value: number): FigureSource => ({
  financialYear,
  lineItem,
  valueStandardised: value,
  reported: String(value / 1000) + " thousands",
  sourcePage: 39,
  documentTitle: "Annual report",
  sourceUri: "https://issuer.test/ar.pdf",
  audited: true,
  consolidated: true,
  currency: "NGN",
});

const metric = (
  financialYear: number,
  value: string | null,
  status: MetricSource["status"] = "available",
  reason: MetricSource["reason"] = null,
): MetricSource => ({
  code: "net_margin",
  financialYear,
  status,
  reason,
  value,
  resultUnit: "percent",
  currency: "NGN",
  consolidated: true,
  allAudited: true,
  disclosedPage: null,
});

describe("the window a history is drawn over", () => {
  it("takes the latest five years, in reading order", () => {
    expect(seriesYears([2019, 2020, 2021, 2022, 2023, 2024])).toEqual([2020, 2021, 2022, 2023, 2024]);
  });

  it("does not repeat a year that appears in two statements", () => {
    expect(seriesYears([2023, 2023, 2022])).toEqual([2022, 2023]);
  });
});

describe("a reported line across the window", () => {
  it("keeps a year with no figure as a gap rather than dropping it", () => {
    const series = figureSeries([figure(2022, "revenue", 1000), figure(2024, "revenue", 1400)], {
      lineItem: "revenue",
      label: "Revenue",
      years: [2022, 2023, 2024],
    });

    expect(series.points.map((point) => point.financialYear)).toEqual([2022, 2023, 2024]);
    expect(series.points.map((point) => point.value)).toEqual([1000, null, 1400]);
    expect(series.points[1].reported).toBeNull();
  });

  it("carries the page and the filing each figure came from", () => {
    const series = figureSeries([figure(2024, "revenue", 1400)], {
      lineItem: "revenue",
      label: "Revenue",
      years: [2024],
    });
    expect(series.points[0].sourcePage).toBe(39);
    expect(series.points[0].documentTitle).toBe("Annual report");
    expect(series.points[0].currency).toBe("NGN");
  });

  it("ignores lines belonging to another figure", () => {
    const series = figureSeries([figure(2024, "profit_after_tax", 200)], {
      lineItem: "revenue",
      label: "Revenue",
      years: [2024],
    });
    expect(series.points[0].value).toBeNull();
  });
});

describe("a ratio across the window", () => {
  it("keeps the reason where there is no answer", () => {
    const series = metricSeries(
      [metric(2023, "20"), metric(2024, null, "not_available", "no_prior_period")],
      { code: "net_margin", label: "Net profit margin", years: [2023, 2024], decimals: 1 },
    );
    expect(series.points.map((point) => point.value)).toEqual([20, null]);
    expect(series.points[1].reason).toBe("no_prior_period");
  });

  it("marks a figure the issuer disclosed, so the chart can label it reported", () => {
    const series = metricSeries(
      [{ ...metric(2024, "28.4", "disclosed"), disclosedPage: 9 }],
      { code: "net_margin", label: "Net profit margin", years: [2024], decimals: 1 },
    );
    expect(series.points[0].disclosed).toBe(true);
    expect(series.points[0].sourcePage).toBe(9);
  });

  it("leaves a year nobody has calculated as a gap with no reason at all", () => {
    const series = metricSeries([metric(2024, "20")], {
      code: "net_margin",
      label: "Net profit margin",
      years: [2023, 2024],
      decimals: 1,
    });
    expect(series.points[0]).toMatchObject({ financialYear: 2023, value: null, reason: null });
  });
});

describe("drawing across a gap", () => {
  it("breaks a line into runs rather than joining two non-adjacent years", () => {
    const series = metricSeries(
      [metric(2021, "10"), metric(2023, "14"), metric(2024, "16")],
      { code: "net_margin", label: "Net profit margin", years: [2021, 2022, 2023, 2024], decimals: 1 },
    );
    const runs = valueRuns(series.points);
    expect(runs).toHaveLength(2);
    expect(runs[0].map((point) => point.financialYear)).toEqual([2021]);
    expect(runs[1].map((point) => point.financialYear)).toEqual([2023, 2024]);
  });

  it("returns nothing to draw where no year holds a value", () => {
    const series = metricSeries([], {
      code: "net_margin",
      label: "Net profit margin",
      years: [2023, 2024],
      decimals: 1,
    });
    expect(valueRuns(series.points)).toEqual([]);
  });
});

describe("the extent a chart is drawn over", () => {
  it("includes zero for bars, so a difference is not exaggerated", () => {
    const series = figureSeries([figure(2023, "revenue", 900), figure(2024, "revenue", 1000)], {
      lineItem: "revenue",
      label: "Revenue",
      years: [2023, 2024],
    });
    expect(extent([series], true)).toEqual({ min: 0, max: 1000 });
  });

  it("keeps a loss below the baseline", () => {
    const series = metricSeries([metric(2023, "-20"), metric(2024, "10")], {
      code: "net_margin",
      label: "Net profit margin",
      years: [2023, 2024],
      decimals: 1,
    });
    expect(extent([series], true)).toEqual({ min: -20, max: 10 });
  });

  it("does not collapse to a zero-height chart on one value", () => {
    const series = metricSeries([metric(2024, "15")], {
      code: "net_margin",
      label: "Net profit margin",
      years: [2024],
      decimals: 1,
    });
    expect(extent([series], true)).toEqual({ min: 0, max: 15 });
  });

  it("has something to draw even with nothing held", () => {
    expect(extent([], true)).toEqual({ min: 0, max: 1 });
  });
});
