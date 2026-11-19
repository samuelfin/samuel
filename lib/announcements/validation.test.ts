import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_LABELS,
  MAX_HEADLINE,
  validateAnnouncement,
} from "./validation";

const NOW = new Date("2026-11-19T12:00:00.000Z");

const VALID = {
  documentId: "11111111-1111-4111-8111-111111111111",
  category: "results",
  headline: "Full-year results for the period ended 31 December 2025",
  announcedAt: "2026-11-19T09:30",
};

describe("categories", () => {
  it("has a label for every category the database accepts", () => {
    for (const category of ANNOUNCEMENT_CATEGORIES) {
      expect(ANNOUNCEMENT_CATEGORY_LABELS[category]).toBeTruthy();
    }
  });
});

describe("validateAnnouncement", () => {
  it("accepts a well-formed announcement and returns an ISO timestamp", () => {
    const result = validateAnnouncement(VALID, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.announcedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reads the typed time as market time, whatever zone the server runs in", () => {
    // The analyst types 09:30 meaning 09:30 in Lagos. Nigeria is UTC+1 all year,
    // so that is 08:30Z. Left to `new Date()` this would depend on the server's
    // own zone and silently shift every announcement by an hour in production.
    const result = validateAnnouncement({ ...VALID, announcedAt: "2026-11-19T09:30" }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.announcedAtIso).toBe("2026-11-19T08:30:00.000Z");
  });

  it("handles a value that already carries a zone", () => {
    const result = validateAnnouncement({ ...VALID, announcedAt: "2026-11-19T09:30:00Z" }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.announcedAtIso).toBe("2026-11-19T09:30:00.000Z");
  });

  it("handles a value that includes seconds", () => {
    const result = validateAnnouncement({ ...VALID, announcedAt: "2026-11-19T09:30:45" }, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.announcedAtIso).toBe("2026-11-19T08:30:45.000Z");
  });

  it("requires a source document", () => {
    expect(validateAnnouncement({ ...VALID, documentId: "" }, NOW).ok).toBe(false);
  });

  it("rejects a category the database would refuse", () => {
    expect(validateAnnouncement({ ...VALID, category: "rumour" }, NOW).ok).toBe(false);
    expect(validateAnnouncement({ ...VALID, category: "" }, NOW).ok).toBe(false);
  });

  it("requires a headline within the column's limit", () => {
    expect(validateAnnouncement({ ...VALID, headline: "   " }, NOW).ok).toBe(false);
    expect(validateAnnouncement({ ...VALID, headline: "x".repeat(MAX_HEADLINE) }, NOW).ok).toBe(true);
    expect(validateAnnouncement({ ...VALID, headline: "x".repeat(MAX_HEADLINE + 1) }, NOW).ok).toBe(false);
  });

  it("requires an announcement date it can read", () => {
    expect(validateAnnouncement({ ...VALID, announcedAt: "" }, NOW).ok).toBe(false);
    expect(validateAnnouncement({ ...VALID, announcedAt: "not a date" }, NOW).ok).toBe(false);
  });

  it("rejects a date in the future, which is a typing slip rather than a schedule", () => {
    // This records what an issuer has already said.
    expect(validateAnnouncement({ ...VALID, announcedAt: "2027-01-01T09:00" }, NOW).ok).toBe(false);
    // A few hours ahead is tolerated: clocks and time zones disagree.
    expect(validateAnnouncement({ ...VALID, announcedAt: "2026-11-19T20:00" }, NOW).ok).toBe(true);
  });

  it("accepts a past date", () => {
    expect(validateAnnouncement({ ...VALID, announcedAt: "2024-03-01T08:00" }, NOW).ok).toBe(true);
  });

  it("requires a reason when correcting", () => {
    expect(validateAnnouncement({ ...VALID, isCorrection: true }, NOW).ok).toBe(false);
    expect(validateAnnouncement({ ...VALID, isCorrection: true, correctionReason: "  " }, NOW).ok).toBe(false);
    expect(
      validateAnnouncement({ ...VALID, isCorrection: true, correctionReason: "Transposed figure" }, NOW).ok,
    ).toBe(true);
  });

  it("does not demand a reason when not correcting", () => {
    expect(validateAnnouncement({ ...VALID, isCorrection: false }, NOW).ok).toBe(true);
  });
});
