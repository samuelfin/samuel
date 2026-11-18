import { describe, expect, it } from "vitest";
import { EMPTY, direction, formatAsOf, formatDecimal, formatSignedPercent, isDecimalString } from "./format";

describe("formatDecimal", () => {
  it("groups thousands and fixes decimals", () => {
    expect(formatDecimal("102345.675")).toBe("102,345.68");
    expect(formatDecimal("1000", 0)).toBe("1,000");
  });

  it("keeps precision beyond binary floating point", () => {
    // 12345678901234567.891 cannot be represented exactly as a JS number.
    expect(formatDecimal("12345678901234567.891")).toBe("12,345,678,901,234,567.89");
  });

  it("returns an em dash for missing or malformed input instead of a zero", () => {
    expect(formatDecimal(undefined)).toBe(EMPTY);
    expect(formatDecimal(null)).toBe(EMPTY);
    expect(formatDecimal("")).toBe(EMPTY);
    expect(formatDecimal("1e3")).toBe(EMPTY);
    expect(formatDecimal("12,345")).toBe(EMPTY);
    expect(formatDecimal("NaN")).toBe(EMPTY);
  });
});

describe("direction and signed percent", () => {
  it("reads direction from the string sign", () => {
    expect(direction("1.5")).toBe("up");
    expect(direction("+0.01")).toBe("up");
    expect(direction("-0.40")).toBe("down");
    expect(direction("0.00")).toBe("flat");
    expect(direction("-0")).toBe("flat");
    expect(direction(undefined)).toBe("flat");
  });

  it("formats with an explicit sign and a true minus", () => {
    expect(formatSignedPercent("1.254")).toBe("+1.25%");
    expect(formatSignedPercent("-0.4")).toBe("−0.40%");
    expect(formatSignedPercent("0")).toBe("0.00%");
    expect(formatSignedPercent("abc")).toBe(EMPTY);
  });
});

describe("formatAsOf", () => {
  it("renders Lagos time with a WAT label", () => {
    expect(formatAsOf("2026-11-18T13:30:00Z")).toBe("18 Nov 2026, 14:30 WAT");
  });

  it("can render a date only, in Lagos time", () => {
    expect(formatAsOf("2026-11-18T23:30:00Z", false)).toBe("19 Nov 2026");
  });

  it("returns an em dash for invalid timestamps", () => {
    expect(formatAsOf("not-a-date")).toBe(EMPTY);
    expect(formatAsOf(undefined)).toBe(EMPTY);
  });
});

describe("isDecimalString", () => {
  it("accepts plain signed decimals only", () => {
    expect(isDecimalString("-12.5")).toBe(true);
    expect(isDecimalString("12.")).toBe(false);
    expect(isDecimalString(12.5)).toBe(false);
  });
});
