import { describe, expect, it } from "vitest";
import { slugify, validateCompany, type CompanyInput } from "./validation";

function input(overrides: Partial<CompanyInput> = {}): CompanyInput {
  return {
    name: "Example Cement Plc",
    slug: "example-cement",
    listingStatus: "listed",
    ngxSymbol: "EXCEM",
    ...overrides,
  };
}

describe("slugify", () => {
  it("joins words with single hyphens", () => {
    expect(slugify("Dangote Cement Plc")).toBe("dangote-cement-plc");
  });

  it("collapses runs of punctuation and spaces", () => {
    expect(slugify("Trans—Atlantic   Holdings, PLC.")).toBe("trans-atlantic-holdings-plc");
  });

  it("leaves nothing dangerous in the result", () => {
    for (const raw of ["../../etc/passwd", "https://evil.test/x", "a/b?c=1#d", "<script>alert(1)</script>"]) {
      const slug = slugify(raw);
      expect(slug).not.toMatch(/[/:?#<>%.]/);
      if (slug) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("does not leave a trailing hyphen after truncating", () => {
    const slug = slugify(`${"ab ".repeat(60)}`);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBeLessThanOrEqual(120);
  });
});

describe("a company needs a name and an address", () => {
  it("accepts a well-formed profile", () => {
    const result = validateCompany(input());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slug).toBe("example-cement");
      expect(result.ngxSymbol).toBe("EXCEM");
    }
  });

  it("refuses an empty name", () => {
    const result = validateCompany(input({ name: "   " }));
    expect(result).toMatchObject({ ok: false });
  });

  it("derives the address from the name when none is given", () => {
    const result = validateCompany(input({ slug: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slug).toBe("example-cement-plc");
  });

  it("normalises a given address rather than refusing its spacing", () => {
    const result = validateCompany(input({ slug: "  Example   Cement  " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.slug).toBe("example-cement");
  });

  it("refuses a name that reduces to no address", () => {
    const result = validateCompany(input({ name: "!!! ???", slug: "" }));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a name carrying a line break", () => {
    const result = validateCompany(input({ name: "Example\nCement Plc" }));
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a name beyond 200 characters", () => {
    expect(validateCompany(input({ name: "x".repeat(201) })).ok).toBe(false);
  });
});

describe("the ticker", () => {
  it("is upper-cased", () => {
    const result = validateCompany(input({ ngxSymbol: "excem" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ngxSymbol).toBe("EXCEM");
  });

  it("allows a dot, as some NGX symbols carry one", () => {
    expect(validateCompany(input({ ngxSymbol: "GTCO.A" })).ok).toBe(true);
  });

  it("refuses spaces, slashes and markup", () => {
    for (const symbol of ["A B", "A/B", "<b>", "A'B", "TOOLONGSYMBOL12345"]) {
      expect(validateCompany(input({ ngxSymbol: symbol })).ok, symbol).toBe(false);
    }
  });

  it("is required for a listed company", () => {
    const result = validateCompany(input({ listingStatus: "listed", ngxSymbol: "" }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/NGX symbol/i);
  });

  it("is not required before a company lists", () => {
    const result = validateCompany(input({ listingStatus: "pre_listing", ngxSymbol: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ngxSymbol).toBeNull();
  });

  it("is not required once a company has gone", () => {
    for (const status of ["delisted", "unlisted", "suspended"]) {
      expect(validateCompany(input({ listingStatus: status, ngxSymbol: "" })).ok, status).toBe(true);
    }
  });
});

describe("the listing status", () => {
  it("refuses anything outside the five", () => {
    for (const status of ["approved", "LISTED", "", "pending", "'; drop table companies; --"]) {
      expect(validateCompany(input({ listingStatus: status })).ok, status).toBe(false);
    }
  });
});

describe("the website", () => {
  it("accepts an ordinary https address", () => {
    const result = validateCompany(input({ website: "https://issuer.test/investors" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.website).toBe("https://issuer.test/investors");
  });

  it("refuses a scheme that is not http", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.test",
      "evil.test",
      "file:///etc/passwd",
    ]) {
      expect(validateCompany(input({ website: url })).ok, url).toBe(false);
    }
  });

  it("refuses a line break before the scheme, which the column's check would let through", () => {
    // `^https?://` in Postgres is not newline-sensitive, so the database alone
    // would reject this one — but a tab or newline inside the address is stripped
    // by browsers, which is how `java\nscript:` becomes a live scheme. Neither
    // shape is allowed to reach a stored link.
    for (const url of ["\njavascript:alert(1)", "https://ok.test\njavascript:alert(1)", "java\nscript:alert(1)"]) {
      expect(validateCompany(input({ website: url })).ok, JSON.stringify(url)).toBe(false);
    }
  });

  it("refuses an address with a space in it", () => {
    expect(validateCompany(input({ website: "https://issuer.test/a b" })).ok).toBe(false);
  });
});

describe("the listing board", () => {
  it("accepts the three current NGX boards", () => {
    for (const board of ["Premium Board", "Main Board", "Growth Board"]) {
      expect(validateCompany(input({ listingBoard: board })).ok, board).toBe(true);
    }
  });

  it("accepts ASeM, which delisted history still needs", () => {
    expect(validateCompany(input({ listingBoard: "ASeM" })).ok).toBe(true);
  });

  it("treats an empty board as none given", () => {
    const result = validateCompany(input({ listingBoard: "  " }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.listingBoard).toBeNull();
  });

  it("refuses one too short or too long to be a board name", () => {
    expect(validateCompany(input({ listingBoard: "M" })).ok).toBe(false);
    expect(validateCompany(input({ listingBoard: "x".repeat(61) })).ok).toBe(false);
  });
});

describe("editing", () => {
  it("requires a reason", () => {
    const result = validateCompany(input({ isEdit: true }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toMatch(/why/i);
  });

  it("accepts a reason", () => {
    const result = validateCompany(input({ isEdit: true, changeReason: "Renamed at the 2026 AGM" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changeReason).toBe("Renamed at the 2026 AGM");
  });

  it("does not require one when creating", () => {
    expect(validateCompany(input({ isEdit: false })).ok).toBe(true);
  });

  it("refuses a reason beyond 500 characters", () => {
    expect(validateCompany(input({ isEdit: true, changeReason: "x".repeat(501) })).ok).toBe(false);
  });
});

describe("the sector", () => {
  it("accepts an id from the catalogue", () => {
    expect(validateCompany(input({ sectorId: "industrial_goods" })).ok).toBe(true);
  });

  it("refuses anything that is not an id", () => {
    for (const sector of ["Industrial Goods", "industrial-goods", "'; drop table sectors; --", "A"]) {
      expect(validateCompany(input({ sectorId: sector })).ok, sector).toBe(false);
    }
  });
});
