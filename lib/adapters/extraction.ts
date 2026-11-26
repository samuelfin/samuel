/**
 * The figure-extraction adapter.
 *
 * Every outside service reaches this platform through one adapter holding its
 * own credentials, licence metadata and kill switch, and an extraction model is
 * no exception. This is that boundary, built before any model is wired up, so
 * the review discipline around suggestions can be proven at no provider cost.
 *
 * The only implementation reads text a person pasted. That is not a placeholder
 * standing in for the real thing — it is the honest description of what happens
 * today, and it is recorded as the provider so the register never implies a
 * model was involved when none was. A real extractor becomes a second
 * implementation of this interface: nothing above it changes, because nothing
 * above it knows which one it is talking to.
 *
 * What an extractor cannot do, by construction: write anything. It returns
 * proposals. They are queued by `record_figure_suggestions`, confirmed one at a
 * time by a person, and only then entered through `record_statement`.
 */

import { type Magnitude, type Presentation, parseFigure } from "@/lib/financials/validation";

export interface ExtractionInput {
  /** The document the figures are being read from. Recorded on the batch. */
  documentId: string;
  /** Raw text. For the paste adapter this is what a person copied out of a PDF. */
  text: string;
  /** The catalogue lines the statement may contain, which bounds what can be proposed. */
  allowedLineItems: readonly { lineItem: string; label: string }[];
}

export interface ExtractedFigure {
  lineItem: string;
  valueReported: number;
  presentation: Presentation;
  magnitude: Magnitude | null;
  sourcePage: number;
  /** What the extractor read as the label, verbatim, so a reviewer can compare. */
  rawLabel: string;
  /** The figure exactly as it appeared, brackets and separators included. */
  rawValue: string;
  /** 0–1 where the extractor can express one; null where the notion is meaningless. */
  confidence: number | null;
}

export interface ExtractionResult {
  figures: ExtractedFigure[];
  /** Lines the extractor could not place, so the queue does not pretend it read everything. */
  unmatched: string[];
}

export interface FigureExtractor {
  /** Recorded as the batch's provider. Lowercase, since the column constrains it. */
  readonly id: string;
  /** Shown on the desk, so an analyst knows what produced a suggestion. */
  readonly label: string;
  /** Null until a model is wired up, and recorded on the batch when one is. */
  readonly model: string | null;
  readonly promptVersion: string | null;
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/** Label text reduced to what two spellings of the same line must share. */
function normaliseLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The longest line that could be one row of a statement. A label, a figure and
 * a page reference do not need more; anything longer is a paste that lost its
 * newlines, and reading it as a single figure is not a service to anyone.
 */
const MAX_LINE = 400;

const PAGE_PATTERNS = [
  /\bp(?:age|g)?\.?\s*(\d{1,5})\b/i,
  /\[(\d{1,5})\]\s*$/,
  /\(p\.?\s*(\d{1,5})\)/i,
];

function readPage(line: string): { page: number | null; rest: string } {
  for (const pattern of PAGE_PATTERNS) {
    const match = pattern.exec(line);
    if (match) {
      return { page: Number(match[1]), rest: line.replace(match[0], " ") };
    }
  }
  return { page: null, rest: line };
}

const SCALE_WORDS: Array<[RegExp, Magnitude]> = [
  [/\bbillions?\b|\bbn\b/i, "billions"],
  [/\bmillions?\b|\bmn?\b/i, "millions"],
  [/\bthousands?\b|\b000\b/i, "thousands"],
];

function readScale(line: string): Magnitude | null {
  for (const [pattern, magnitude] of SCALE_WORDS) {
    if (pattern.test(line)) return magnitude;
  }
  return null;
}

/**
 * Reads lines of the form "Revenue 1,234,567 p.40", which is what a person
 * copying a table out of a PDF ends up with.
 *
 * It matches a label against the catalogue and refuses to guess: an ambiguous or
 * unrecognised label goes to `unmatched` rather than to the nearest thing. A
 * suggestion queue whose job is to be checked may be incomplete; it may not be
 * confidently wrong, because a reviewer reading a plausible label beside a
 * plausible figure is exactly who would miss it.
 *
 * No confidence is reported. The notion is meaningless here — a label either
 * matched the catalogue or it did not — and inventing a number would dress a
 * string comparison up as a judgement.
 */
export const manualPasteExtractor: FigureExtractor = {
  id: "manual_paste",
  label: "Pasted text (no model)",
  model: null,
  promptVersion: null,

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const byLabel = new Map<string, string[]>();
    for (const line of input.allowedLineItems) {
      const key = normaliseLabel(line.label);
      byLabel.set(key, [...(byLabel.get(key) ?? []), line.lineItem]);
      // The code itself is a usable label: a paste of "profit_after_tax 200" is
      // as clear as one of "Profit after tax 200".
      const codeKey = normaliseLabel(line.lineItem);
      byLabel.set(codeKey, [...(byLabel.get(codeKey) ?? []), line.lineItem]);
    }

    const figures: ExtractedFigure[] = [];
    const unmatched: string[] = [];
    const used = new Set<string>();

    for (const rawLine of input.text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;

      // A table row is a label, a figure and a page. Nothing this long is one,
      // and the matching below walks the line more than once, so an
      // unreasonable line is set aside rather than chewed over. A newline-free
      // OCR paste is the realistic way to produce one by accident.
      if (line.length > MAX_LINE) {
        unmatched.push(`${line.slice(0, 80)}… (too long to read as one figure)`);
        continue;
      }

      const { page, rest } = readPage(line);
      const scale = readScale(rest);

      // The figure is the last number-like token on the line; the label is what
      // precedes it. A table row reads that way round in every filing.
      //
      // Every quantifier here is bounded. The first version put `[\d,\s_]*`
      // next to `\s*` before a `$`, which is ambiguous — the two can divide the
      // same run of spaces between them many ways — so a long line with no
      // match took quadratic time to fail: one 100,000-character line measured
      // 110 seconds of blocked event loop. Bounded repeats leave the engine a
      // fixed number of divisions to try, whatever arrives.
      const figureMatch = /([(]?[ ]?[₦$€£]?[ ]?-?\d[\d,_ ]{0,39}(?:\.\d{1,6})?[ ]?[)]?)[ ]*$/.exec(
        rest.replace(/\b(thousands?|millions?|billions?|bn|mn)\b/gi, " ").trim(),
      );
      if (!figureMatch) {
        unmatched.push(line);
        continue;
      }

      const rawValue = figureMatch[1].trim();
      const parsed = parseFigure(rawValue);
      if (!parsed) {
        unmatched.push(line);
        continue;
      }

      const rawLabel = rest
        .replace(/\b(thousands?|millions?|billions?|bn|mn)\b/gi, " ")
        .slice(0, figureMatch.index)
        .replace(/[:\-–—\t]+$/, "")
        .trim();

      const candidates = byLabel.get(normaliseLabel(rawLabel)) ?? [];
      const distinct = [...new Set(candidates)];
      if (distinct.length !== 1) {
        // Nothing matched, or two lines share a label. Either way a person
        // decides, not this.
        unmatched.push(line);
        continue;
      }

      const lineItem = distinct[0];
      if (used.has(lineItem)) {
        unmatched.push(line);
        continue;
      }
      used.add(lineItem);

      if (page === null) {
        // A figure with no page cannot be entered, so it is not worth proposing.
        unmatched.push(line);
        continue;
      }

      figures.push({
        lineItem,
        valueReported: parsed.value,
        presentation: parsed.presentation,
        magnitude: scale,
        sourcePage: page,
        rawLabel: rawLabel.slice(0, 300),
        rawValue: rawValue.slice(0, 60),
        confidence: null,
      });
    }

    return { figures, unmatched };
  },
};

const EXTRACTORS: Record<string, FigureExtractor> = {
  [manualPasteExtractor.id]: manualPasteExtractor,
};

/**
 * The kill switch every adapter has. `SFI_EXTRACTION_DISABLED=1` turns the
 * feature off without a deployment, which is the point of having one: a provider
 * behaving badly should be stoppable by the person holding the environment, not
 * by whoever can merge.
 */
export function extractionEnabled(): boolean {
  return process.env.SFI_EXTRACTION_DISABLED !== "1";
}

export function availableExtractors(): FigureExtractor[] {
  return extractionEnabled() ? Object.values(EXTRACTORS) : [];
}

export function getExtractor(id: string): FigureExtractor | null {
  if (!extractionEnabled()) return null;
  // `hasOwn`, not a bare index: `getExtractor("__proto__")` on a plain object
  // returns something truthy that is not an extractor, and the caller then
  // throws instead of saying the extractor is unknown.
  return Object.hasOwn(EXTRACTORS, id) ? EXTRACTORS[id] : null;
}
