/**
 * How much of a company's five-year history SFI actually holds.
 *
 * The score is deliberately unflattering. It counts only what a person has
 * checked: a year somebody has entered but nobody has reviewed is not covered,
 * because the whole claim of this platform is that a published figure was
 * checked against a page. That is also why the score is published rather than
 * kept for the desk — "we have four of five years for this company" is a fact a
 * reader is owed, and it directs the next day of entry work.
 *
 * Nothing here divides a figure. It counts years and required line items.
 */

export interface CoverageStatement {
  financialYear: number;
  statementType: string;
  lineItems: readonly string[];
}

export interface RequiredLine {
  statementType: string;
  lineItem: string;
  label: string;
}

export interface CoverageYear {
  financialYear: number;
  held: boolean;
  /** Required figures not entered for this year, by label, in reading order. */
  missing: string[];
}

export interface CoverageScore {
  yearsExpected: number;
  yearsHeld: number;
  /** Required figures across the years held — not across years nobody has. */
  requiredExpected: number;
  requiredPresent: number;
  years: CoverageYear[];
}

/**
 * The score for one company over a window of financial years.
 *
 * `statements` must already be filtered to what a reader may see: approved
 * annual statements. A caller that passes pending rows would publish a score
 * for figures nobody has checked.
 */
export function coverageScore(input: {
  years: readonly number[];
  statements: readonly CoverageStatement[];
  required: readonly RequiredLine[];
}): CoverageScore {
  const entered = new Map<number, Set<string>>();
  for (const statement of input.statements) {
    const lines = entered.get(statement.financialYear) ?? new Set<string>();
    for (const lineItem of statement.lineItems) lines.add(lineItem);
    entered.set(statement.financialYear, lines);
  }

  const years: CoverageYear[] = input.years.map((financialYear) => {
    const lines = entered.get(financialYear);
    return {
      financialYear,
      held: lines !== undefined && lines.size > 0,
      missing: lines
        ? input.required.filter((line) => !lines.has(line.lineItem)).map((line) => line.label)
        : [],
    };
  });

  const held = years.filter((year) => year.held);
  const requiredExpected = held.length * input.required.length;
  const requiredPresent = held.reduce(
    (total, year) => total + (input.required.length - year.missing.length),
    0,
  );

  return {
    yearsExpected: input.years.length,
    yearsHeld: held.length,
    requiredExpected,
    requiredPresent,
    years,
  };
}

/** The headline, in the words the page uses. */
export function coverageSentence(score: CoverageScore): string {
  if (score.yearsHeld === 0) {
    return "No year of this company's history has been entered and checked yet.";
  }
  const years = score.yearsHeld + " of " + score.yearsExpected + " years verified";
  const lines = score.requiredPresent + " of " + score.requiredExpected + " required figures";
  return years + " · " + lines;
}
