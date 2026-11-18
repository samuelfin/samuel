import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  isAllowedMimeType,
  storagePathFor,
  validateUpload,
} from "./validation";

const VALID = {
  title: "MTN Nigeria FY2025 Annual Report",
  kind: "annual_report",
  licenceClass: "issuer_document",
  mimeType: "application/pdf",
  sizeBytes: 2_000_000,
};

const SHA = "a".repeat(64);

describe("isAllowedMimeType", () => {
  it("accepts the bucket's types and rejects everything else", () => {
    expect(isAllowedMimeType("application/pdf")).toBe(true);
    expect(isAllowedMimeType("text/csv")).toBe(true);
    expect(isAllowedMimeType("text/html")).toBe(false);
    expect(isAllowedMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
  });
});

describe("validateUpload", () => {
  it("accepts a well-formed document", () => {
    expect(validateUpload(VALID)).toEqual({ ok: true });
  });

  it("requires a title within the column's limit", () => {
    expect(validateUpload({ ...VALID, title: "   " }).ok).toBe(false);
    expect(validateUpload({ ...VALID, title: "x".repeat(301) }).ok).toBe(false);
    expect(validateUpload({ ...VALID, title: "x".repeat(300) }).ok).toBe(true);
  });

  it("rejects a kind or licence class outside the schema's sets", () => {
    expect(validateUpload({ ...VALID, kind: "memo" }).ok).toBe(false);
    expect(validateUpload({ ...VALID, licenceClass: "public" }).ok).toBe(false);
  });

  it("rejects a disallowed file type", () => {
    const result = validateUpload({ ...VALID, mimeType: "application/zip" });
    expect(result).toEqual({ ok: false, error: "Upload a PDF, CSV or Excel file." });
  });

  it("rejects an empty file and one over the size cap", () => {
    expect(validateUpload({ ...VALID, sizeBytes: 0 }).ok).toBe(false);
    expect(validateUpload({ ...VALID, sizeBytes: -1 }).ok).toBe(false);
    expect(validateUpload({ ...VALID, sizeBytes: MAX_DOCUMENT_BYTES }).ok).toBe(true);
    expect(validateUpload({ ...VALID, sizeBytes: MAX_DOCUMENT_BYTES + 1 }).ok).toBe(false);
  });

  it("accepts an http or https source link and nothing else", () => {
    expect(validateUpload({ ...VALID, sourceUri: "https://issuer.test/report.pdf" }).ok).toBe(true);
    expect(validateUpload({ ...VALID, sourceUri: "" }).ok).toBe(true);
    expect(validateUpload({ ...VALID, sourceUri: null }).ok).toBe(true);
    expect(validateUpload({ ...VALID, sourceUri: "javascript:alert(1)" }).ok).toBe(false);
    expect(validateUpload({ ...VALID, sourceUri: "file:///etc/passwd" }).ok).toBe(false);
    expect(validateUpload({ ...VALID, sourceUri: "issuer.test/report.pdf" }).ok).toBe(false);
  });
});

describe("storagePathFor", () => {
  it("shards on the checksum and uses the type's extension", () => {
    expect(storagePathFor(SHA, "application/pdf")).toBe(`aa/${SHA}.pdf`);
    expect(storagePathFor(SHA, "text/csv")).toBe(`aa/${SHA}.csv`);
    expect(
      storagePathFor(SHA, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(`aa/${SHA}.xlsx`);
  });

  it("is deterministic, so identical bytes never occupy two objects", () => {
    expect(storagePathFor(SHA, "application/pdf")).toBe(storagePathFor(SHA, "application/pdf"));
  });

  it("refuses anything that is not a hex sha256, so a path cannot be chosen", () => {
    expect(() => storagePathFor("../../etc/passwd", "application/pdf")).toThrow();
    expect(() => storagePathFor(SHA.toUpperCase(), "application/pdf")).toThrow();
    expect(() => storagePathFor("abc", "application/pdf")).toThrow();
    expect(() => storagePathFor(`${SHA}/../x`, "application/pdf")).toThrow();
  });
});
