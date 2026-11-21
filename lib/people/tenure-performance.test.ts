import { describe, expect, it } from "vitest";
import {
  OVERLAP_LABELS,
  overlapFor,
  TENURE_ROW_KEYS,
  tenureRows,
  type PeriodFigure,
  type Tenure,
} from "./tenure-performance";

/**
 * These tests exist to hold a product rule, not to check arithmetic.
 *
 * The panel shows sourced company figures beside the dates of a tenure, with no
 * scores, no rankings and no causal claims. The rule survives a refactor only if
 * something fails when it is broken, so the invariant is asserted directly:
 * every row is a function of its own period and the tenure, and of nothing else.
 *
 * A growth rate, a delta, a ranking and a score all need to see another row.
 * None of them can survive that invariant, which is why it is the one worth
 * testing rather than enumerating the things the panel must not say.
 */

const TENURE: Tenure = { validFrom: "2018-01-01", validTo: "2022-12-31" };

function figure(overrides: Partial<PeriodFigure> = {}): PeriodFigure {
  return {
    id: "r1",
    periodLabel: "FY 2020",
    periodStart: "2020-01-01",
    periodEnd: "2020-12-31",
    metricLabel: "Revenue",
    valueAsReported: "1,000",
    unit: "₦'000",
    sourceTitle: "Annual report 2020",
    sourceUri: "https://issuer.test/ar2020.pdf",
    sourcePage: 42,
    ...overrides,
  };
}

describe("a row never depends on another row", () => {
  /**
   * The invariant that enforces the whole rule. If a growth rate, a delta or a
   * rank were ever added, the row for one period would change according to which
   * other periods were present — and this fails.
   */
  it("produces the identical row whether it sees one figure or twenty", () => {
    const subject = figure({ id: "subject", periodLabel: "FY 2020" });

    const alone = tenureRows([subject], TENURE);
    const crowd = tenureRows(
      [
        subject,
        ...Array.from({ length: 19 }, (_, i) =>
          figure({
            id: `other-${i}`,
            periodLabel: `FY ${2000 + i}`,
            periodStart: `${2000 + i}-01-01`,
            periodEnd: `${2000 + i}-12-31`,
            valueAsReported: String((i + 1) * 999_999),
          }),
        ),
      ],
      TENURE,
    );

    const fromCrowd = crowd.find((row) => row.id === "subject");
    expect(fromCrowd).toEqual(alone[0]);
  });

  it("produces the identical row whatever the other figures are worth", () => {
    const subject = figure({ id: "subject" });
    const neighbour = figure({
      id: "neighbour",
      periodLabel: "FY 2019",
      periodStart: "2019-01-01",
      periodEnd: "2019-12-31",
    });

    const small = tenureRows([subject, { ...neighbour, valueAsReported: "1" }], TENURE);
    const huge = tenureRows([subject, { ...neighbour, valueAsReported: "999,999,999" }], TENURE);

    expect(small.find((r) => r.id === "subject")).toEqual(huge.find((r) => r.id === "subject"));
  });

  it("carries no field that could hold a derived number", () => {
    // Asserted as an exact set, so adding a field is a deliberate act that fails
    // this test first rather than quietly shipping a computed metric.
    const [row] = tenureRows([figure()], TENURE);
    expect(Object.keys(row).sort()).toEqual([...TENURE_ROW_KEYS].sort());

    for (const forbidden of [
      "change",
      "delta",
      "growth",
      "growthPct",
      "rank",
      "score",
      "percentile",
      "cagr",
      "versusPrevious",
      "trend",
    ]) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });

  it("keeps the figure exactly as reported, as a string it cannot calculate with", () => {
    const [row] = tenureRows([figure({ valueAsReported: "1,234,567" })], TENURE);
    expect(row.valueAsReported).toBe("1,234,567");
    expect(typeof row.valueAsReported).toBe("string");
  });
});

describe("ordering is chronological, never by value", () => {
  it("orders by the period's own end date", () => {
    const rows = tenureRows(
      [
        figure({ id: "c", periodLabel: "FY 2021", periodStart: "2021-01-01", periodEnd: "2021-12-31" }),
        figure({ id: "a", periodLabel: "FY 2019", periodStart: "2019-01-01", periodEnd: "2019-12-31" }),
        figure({ id: "b", periodLabel: "FY 2020", periodStart: "2020-01-01", periodEnd: "2020-12-31" }),
      ],
      TENURE,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("does not reorder when the values change, which a ranking would", () => {
    const base = [
      figure({ id: "a", periodEnd: "2019-12-31", periodStart: "2019-01-01", valueAsReported: "10" }),
      figure({ id: "b", periodEnd: "2020-12-31", periodStart: "2020-01-01", valueAsReported: "20" }),
      figure({ id: "c", periodEnd: "2021-12-31", periodStart: "2021-01-01", valueAsReported: "30" }),
    ];
    const reversedValues = [
      { ...base[0], valueAsReported: "30" },
      { ...base[1], valueAsReported: "20" },
      { ...base[2], valueAsReported: "10" },
    ];

    expect(tenureRows(base, TENURE).map((r) => r.id)).toEqual(
      tenureRows(reversedValues, TENURE).map((r) => r.id),
    );
  });

  it("is stable however the input is shuffled", () => {
    const figures = ["2019", "2020", "2021", "2022"].map((year) =>
      figure({ id: year, periodLabel: `FY ${year}`, periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` }),
    );
    const forward = tenureRows(figures, TENURE).map((r) => r.id);
    const backward = tenureRows([...figures].reverse(), TENURE).map((r) => r.id);
    expect(backward).toEqual(forward);
  });

  it("separates two metrics in the same period deterministically", () => {
    const rows = tenureRows(
      [
        figure({ id: "profit", metricLabel: "Profit before tax" }),
        figure({ id: "revenue", metricLabel: "Revenue" }),
      ],
      TENURE,
    );
    expect(rows.map((r) => r.id)).toEqual(["profit", "revenue"]);
  });
});

describe("where a period sits against the tenure", () => {
  it("marks a period wholly inside it", () => {
    expect(overlapFor(figure({ periodStart: "2019-01-01", periodEnd: "2019-12-31" }), TENURE)).toBe(
      "during",
    );
  });

  it("marks a period wholly before or after it", () => {
    expect(overlapFor(figure({ periodStart: "2016-01-01", periodEnd: "2016-12-31" }), TENURE)).toBe(
      "before",
    );
    expect(overlapFor(figure({ periodStart: "2024-01-01", periodEnd: "2024-12-31" }), TENURE)).toBe(
      "after",
    );
  });

  it("marks a period that straddles either end as partial", () => {
    // Started before the tenure, ended inside it.
    expect(overlapFor(figure({ periodStart: "2017-01-01", periodEnd: "2018-06-30" }), TENURE)).toBe(
      "ends-during",
    );
    // Started inside the tenure, ended after it.
    expect(overlapFor(figure({ periodStart: "2022-07-01", periodEnd: "2023-06-30" }), TENURE)).toBe(
      "starts-during",
    );
    // Encloses the whole tenure, which is partial in the same way.
    expect(overlapFor(figure({ periodStart: "2010-01-01", periodEnd: "2030-12-31" }), TENURE)).toBe(
      "starts-during",
    );
  });

  it("treats a tenure still being held as open-ended", () => {
    const current: Tenure = { validFrom: "2018-01-01", validTo: null };
    expect(overlapFor(figure({ periodStart: "2025-01-01", periodEnd: "2025-12-31" }), current)).toBe(
      "during",
    );
    expect(overlapFor(figure({ periodStart: "2017-01-01", periodEnd: "2017-12-31" }), current)).toBe(
      "before",
    );
  });

  it("counts only a wholly-inside period as within the tenure", () => {
    const rows = tenureRows(
      [
        figure({ id: "inside", periodStart: "2019-01-01", periodEnd: "2019-12-31" }),
        figure({ id: "straddles", periodStart: "2017-01-01", periodEnd: "2018-06-30" }),
        figure({ id: "outside", periodStart: "2016-01-01", periodEnd: "2016-12-31" }),
      ],
      TENURE,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("inside")?.withinTenure).toBe(true);
    expect(byId.get("straddles")?.withinTenure).toBe(false);
    expect(byId.get("outside")?.withinTenure).toBe(false);
  });

  it("tolerates a timestamp where a date is expected", () => {
    // Postgres hands back a date; a caller passing an ISO timestamp should not
    // shift the comparison.
    expect(
      overlapFor(figure({ periodStart: "2019-01-01T00:00:00.000Z", periodEnd: "2019-12-31T00:00:00.000Z" }), TENURE),
    ).toBe("during");
  });
});

describe("the words the panel uses", () => {
  it("describes a relationship to the tenure and never a consequence of it", () => {
    const labels = Object.values(OVERLAP_LABELS).join(" ").toLowerCase();
    // No causation, no judgement, no superlative. If someone later writes
    // "improved under" or "best", this fails.
    for (const forbidden of [
      "under",
      "because",
      "due to",
      "led to",
      "caused",
      "improved",
      "worsened",
      "better",
      "worse",
      "best",
      "strong",
      "weak",
      "success",
      "failure",
      "outperform",
    ]) {
      expect(labels, forbidden).not.toContain(forbidden);
    }
  });

  it("has a label for every overlap the code can produce", () => {
    for (const overlap of ["before", "starts-during", "during", "ends-during", "after"] as const) {
      expect(OVERLAP_LABELS[overlap]).toBeTruthy();
    }
  });
});

describe("nothing yet to show", () => {
  it("returns no rows for no figures, which the panel reports as no data", () => {
    expect(tenureRows([], TENURE)).toEqual([]);
  });
});
