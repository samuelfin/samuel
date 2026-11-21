import { describe, expect, it } from "vitest";
import {
  formatTenure,
  formatTenureDate,
  isConfirmationStale,
  normalizePersonSlug,
  parseTenureDate,
  slugifyName,
  validateCompanyRole,
  validatePerson,
  type RoleInput,
} from "./validation";

function personInput(overrides: Partial<Parameters<typeof validatePerson>[0]> = {}) {
  return { fullName: "Ada Okonkwo", ...overrides };
}

function roleInput(overrides: Partial<RoleInput> = {}): RoleInput {
  return {
    personId: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    roleCode: "ceo",
    validFrom: "2015-06-12",
    sourceKind: "document",
    documentId: "33333333-3333-4333-8333-333333333333",
    sourcePage: "42",
    ...overrides,
  };
}

describe("a tenure boundary carries its own precision", () => {
  it("reads a year as a year", () => {
    expect(parseTenureDate("2015")).toEqual({ date: "2015-01-01", precision: "year" });
  });

  it("reads a month as a month", () => {
    expect(parseTenureDate("2015-06")).toEqual({ date: "2015-06-01", precision: "month" });
  });

  it("reads a full date as a day", () => {
    expect(parseTenureDate("2015-06-12")).toEqual({ date: "2015-06-12", precision: "day" });
  });

  it("tolerates surrounding space", () => {
    expect(parseTenureDate("  2015-06  ")).toEqual({ date: "2015-06-01", precision: "month" });
  });

  /**
   * The point of the whole mechanism: "appointed 2015" must not become
   * 12 March 2015, and it must not become a day-precision 1 January either.
   */
  it("never invents a precision the source did not have", () => {
    const year = parseTenureDate("2015");
    expect(year?.precision).toBe("year");
    expect(year?.precision).not.toBe("day");
  });

  it("refuses a date the calendar does not have", () => {
    // These roll silently into the next month in most date handling, which would
    // store a different day from the one the filing gives.
    for (const attempt of ["2020-02-31", "2021-02-30", "2020-13-01", "2020-00-05", "2020-06-00", "2020-06-31"]) {
      expect(parseTenureDate(attempt), attempt).toBeNull();
    }
  });

  it("refuses anything that is not one of the three shapes", () => {
    for (const attempt of [
      "",
      "   ",
      "15",
      "2015-6",
      "2015/06/12",
      "12-06-2015",
      "June 2015",
      "2015-06-12T00:00:00Z",
      "2015-06-12 ; drop table people",
      "20155",
      "1799",
      "2101",
      "0000",
      "-2015",
      "2015-06-12-01",
      "two thousand",
    ]) {
      expect(parseTenureDate(attempt), JSON.stringify(attempt)).toBeNull();
    }
  });

  it("renders only what the source said", () => {
    expect(formatTenureDate("2015-01-01", "year")).toBe("2015");
    expect(formatTenureDate("2015-06-01", "month")).toBe("June 2015");
    expect(formatTenureDate("2015-06-12", "day")).toBe("12 June 2015");
    expect(formatTenureDate(null, "day")).toBe("");
  });

  it("renders a current role as running to the present", () => {
    expect(formatTenure("2015-01-01", "year", null, null)).toBe("2015 – present");
    expect(formatTenure("2015-06-01", "month", "2022-01-01", "year")).toBe("June 2015 – 2022");
  });
});

describe("a person record", () => {
  it("accepts a well-formed one and derives the address", () => {
    const result = validatePerson(personInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slug).toBe("ada-okonkwo");
      expect(result.honorific).toBeNull();
    }
  });

  it("keeps a given address, normalised", () => {
    const result = validatePerson(personInput({ slug: "  Ada   Okonkwo-Bello " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slug).toBe("ada-okonkwo-bello");
  });

  it("keeps the honorific the filing carries", () => {
    const result = validatePerson(personInput({ honorific: " Chief " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.honorific).toBe("Chief");
  });

  it("refuses a name that is not one", () => {
    for (const fullName of ["", "   ", "A", "x".repeat(201)]) {
      expect(validatePerson(personInput({ fullName })).ok, JSON.stringify(fullName)).toBe(false);
    }
  });

  it("refuses control characters in the name and the title", () => {
    for (const bad of ["Ada\nOkonkwo", "Ada\tOkonkwo", "Ada\u0000Okonkwo", "Ada\u007fOkonkwo"]) {
      expect(validatePerson(personInput({ fullName: bad })).ok, JSON.stringify(bad)).toBe(false);
      expect(
        validatePerson(personInput({ honorific: bad })).ok,
        `honorific ${JSON.stringify(bad)}`,
      ).toBe(false);
    }
  });

  it("refuses a name that reduces to no address", () => {
    for (const fullName of ["!!! ???", "。。。", "---"]) {
      expect(validatePerson(personInput({ fullName })).ok, fullName).toBe(false);
    }
  });

  it("requires a reason when editing and not when creating", () => {
    expect(validatePerson(personInput({ isEdit: true })).ok).toBe(false);
    expect(validatePerson(personInput({ isEdit: false })).ok).toBe(true);
    expect(validatePerson(personInput({ isEdit: true, changeReason: "Married name" })).ok).toBe(true);
  });

  it("refuses a reason beyond 500 characters", () => {
    expect(validatePerson(personInput({ isEdit: true, changeReason: "x".repeat(501) })).ok).toBe(false);
  });
});

describe("an address from the route cannot become a redirect target", () => {
  const hostile = [
    "//evil.test",
    "///evil.test",
    "\\\\evil.test",
    "https://evil.test",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "../../admin",
    "..%2f..%2fadmin",
    "%2e%2e%2fadmin",
    "%252e%252e%252fadmin",
    "a/b",
    "a?b=1",
    "a#b",
    "a%00b",
    "a%0d%0aLocation:%20https://evil.test",
    "a\r\nLocation: https://evil.test",
    "a b",
    "-leading",
    "trailing-",
    "double--hyphen",
    "x".repeat(121),
    "a",
    "",
    "   ",
    "%",
    "%zz",
  ];

  for (const attempt of hostile) {
    // Asserting null, not "inert if it was accepted": the weaker form passes
    // even with the length bounds deleted, which is no test at all.
    it(`refuses ${JSON.stringify(attempt)}`, () => {
      expect(normalizePersonSlug(attempt)).toBeNull();
    });
  }

  it("accepts the addresses a person legitimately has", () => {
    expect(normalizePersonSlug("ada-okonkwo")).toBe("ada-okonkwo");
    expect(normalizePersonSlug("ADA-OKONKWO")).toBe("ada-okonkwo");
    expect(normalizePersonSlug("  ada-okonkwo  ")).toBe("ada-okonkwo");
    expect(normalizePersonSlug("ngozi-bello-gtco")).toBe("ngozi-bello-gtco");
  });

  it("never throws, whatever arrives in the path", () => {
    for (const attempt of [...hostile, "\uD800", "%E0%A4%A", "\u0000"]) {
      expect(() => normalizePersonSlug(attempt)).not.toThrow();
    }
  });

  it("leaves nothing dangerous in a derived address", () => {
    for (const raw of ["../../etc/passwd", "https://evil.test/x", "a/b?c=1#d", "<script>alert(1)</script>"]) {
      const slug = slugifyName(raw);
      expect(slug).not.toMatch(/[/:?#<>%.]/);
      if (slug) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe("a role must cite evidence", () => {
  it("accepts a document and a page", () => {
    const result = validateCompanyRole(roleInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourcePage).toBe(42);
      expect(result.announcementId).toBeNull();
      expect(result.validFromPrecision).toBe("day");
    }
  });

  it("accepts an announcement, and sends no page with it", () => {
    const result = validateCompanyRole(
      roleInput({
        sourceKind: "announcement",
        announcementId: "44444444-4444-4444-8444-444444444444",
        documentId: undefined,
        sourcePage: undefined,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documentId).toBeNull();
      expect(result.sourcePage).toBeNull();
    }
  });

  it("refuses a document with no page", () => {
    for (const sourcePage of ["", "   ", "0", "-1", "abc", "1.5", "1e3", "٣"]) {
      expect(validateCompanyRole(roleInput({ sourcePage })).ok, JSON.stringify(sourcePage)).toBe(false);
    }
  });

  it("refuses a source kind that is neither", () => {
    for (const sourceKind of ["", "both", "none", "DOCUMENT", "unverified"]) {
      expect(validateCompanyRole(roleInput({ sourceKind })).ok, sourceKind).toBe(false);
    }
  });

  it("refuses an id that is not one", () => {
    expect(validateCompanyRole(roleInput({ documentId: "not-a-uuid" })).ok).toBe(false);
    expect(validateCompanyRole(roleInput({ personId: "1; drop table people" })).ok).toBe(false);
    expect(validateCompanyRole(roleInput({ companyId: "" })).ok).toBe(false);
  });

  it("refuses an office that is not a catalogue code", () => {
    for (const roleCode of ["", "CEO", "chief executive", "ceo'; --", "c", "x".repeat(49)]) {
      expect(validateCompanyRole(roleInput({ roleCode })).ok, JSON.stringify(roleCode)).toBe(false);
    }
  });

  it("refuses control characters in the reported title", () => {
    expect(validateCompanyRole(roleInput({ roleTitle: "Chief\nOfficer" })).ok).toBe(false);
  });

  it("keeps the reported title beside the code", () => {
    const result = validateCompanyRole(
      roleInput({ roleCode: "gmd_ceo", roleTitle: "Group Managing Director/CEO" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.roleTitle).toBe("Group Managing Director/CEO");
  });

  it("records an acting appointment as one", () => {
    const result = validateCompanyRole(roleInput({ isActing: true }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.isActing).toBe(true);
  });
});

describe("the tenure", () => {
  it("accepts a year-only start and keeps it a year", () => {
    const result = validateCompanyRole(roleInput({ validFrom: "2015" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validFrom).toBe("2015-01-01");
      expect(result.validFromPrecision).toBe("year");
    }
  });

  it("leaves a current role with no end and no end precision", () => {
    const result = validateCompanyRole(roleInput({ validTo: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validTo).toBeNull();
      expect(result.validToPrecision).toBeNull();
    }
  });

  it("gives an end its own precision", () => {
    const result = validateCompanyRole(roleInput({ validTo: "2022" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.validTo).toBe("2022-01-01");
      expect(result.validToPrecision).toBe("year");
    }
  });

  it("refuses an end before the start", () => {
    expect(validateCompanyRole(roleInput({ validFrom: "2020", validTo: "2019" })).ok).toBe(false);
  });

  it("refuses a start it cannot read", () => {
    for (const validFrom of ["", "yesterday", "2015-13", "2015-02-30"]) {
      expect(validateCompanyRole(roleInput({ validFrom })).ok, validFrom).toBe(false);
    }
  });
});

describe("the confirmation", () => {
  it("is optional", () => {
    const result = validateCompanyRole(roleInput({ lastConfirmedOn: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lastConfirmedOn).toBeNull();
  });

  it("records the date and its source together", () => {
    const result = validateCompanyRole(
      roleInput({
        lastConfirmedOn: "2026-03-31",
        confirmSourceKind: "document",
        confirmDocumentId: "55555555-5555-4555-8555-555555555555",
        confirmSourcePage: "7",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lastConfirmedOn).toBe("2026-03-31");
      expect(result.confirmSourcePage).toBe(7);
    }
  });

  /**
   * Stricter than a tenure boundary deliberately: last_confirmed_on has no
   * precision column, so a year or a month would be stored as a day it does not
   * mean.
   */
  it("refuses anything but a full date", () => {
    for (const lastConfirmedOn of ["2026", "2026-03"]) {
      const result = validateCompanyRole(
        roleInput({
          lastConfirmedOn,
          confirmSourceKind: "document",
          confirmDocumentId: "55555555-5555-4555-8555-555555555555",
          confirmSourcePage: "7",
        }),
      );
      expect(result.ok, lastConfirmedOn).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/in full/i);
    }
  });

  it("refuses a date with no source", () => {
    const result = validateCompanyRole(roleInput({ lastConfirmedOn: "2026-03-31" }));
    expect(result.ok).toBe(false);
  });

  it("refuses a source with no date", () => {
    const result = validateCompanyRole(
      roleInput({
        confirmSourceKind: "document",
        confirmDocumentId: "55555555-5555-4555-8555-555555555555",
        confirmSourcePage: "7",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/date the role was confirmed/i);
  });

  it("refuses a confirmation before the role began or in the future", () => {
    const source = {
      confirmSourceKind: "document",
      confirmDocumentId: "55555555-5555-4555-8555-555555555555",
      confirmSourcePage: "7",
    };
    expect(
      validateCompanyRole(roleInput({ validFrom: "2020-01-01", lastConfirmedOn: "2019-01-01", ...source })).ok,
    ).toBe(false);
    expect(validateCompanyRole(roleInput({ lastConfirmedOn: "2099-01-01", ...source })).ok).toBe(false);
  });

  it("refuses a confirming document with no page", () => {
    const result = validateCompanyRole(
      roleInput({
        lastConfirmedOn: "2026-03-31",
        confirmSourceKind: "document",
        confirmDocumentId: "55555555-5555-4555-8555-555555555555",
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("staleness", () => {
  const now = new Date("2026-11-21T00:00:00Z");

  it("flags a current role nobody has ever confirmed", () => {
    expect(isConfirmationStale(null, null, now)).toBe(true);
  });

  it("flags a current role last confirmed over a year ago", () => {
    expect(isConfirmationStale(null, "2025-01-15", now)).toBe(true);
  });

  it("leaves a recently confirmed role alone", () => {
    expect(isConfirmationStale(null, "2026-06-30", now)).toBe(false);
  });

  it("does not flag a role that has ended", () => {
    // Nobody needs to re-check that a former officer still holds an office they
    // left, so an ended role is never stale however long ago it was confirmed.
    expect(isConfirmationStale("2022-01-01", null, now)).toBe(false);
    expect(isConfirmationStale("2022-01-01", "2019-01-01", now)).toBe(false);
  });

  it("treats the boundary as not yet stale", () => {
    expect(isConfirmationStale(null, "2025-11-21", now)).toBe(false);
    expect(isConfirmationStale(null, "2025-11-20", now)).toBe(true);
  });
});
