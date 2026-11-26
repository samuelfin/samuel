import { describe, expect, it } from "vitest";
import { buildXlsx, cellRef, safeSheetName } from "./xlsx";

/**
 * The workbook is validated by taking it apart again.
 *
 * A hand-written container is only worth having if something proves it is a
 * container: these tests read the zip back entry by entry, check every CRC, and
 * look at the XML that came out. A file Excel refuses is worse than no download,
 * because it fails in the reader's hands rather than in ours.
 */

interface Entry {
  path: string;
  text: string;
  crcOk: boolean;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A deliberately small reader for stored entries, so the test shares no code with the writer. */
function unzip(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: Entry[] = [];
  let offset = 0;

  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    expect(method, "entries are stored, not deflated").toBe(0);
    const declaredCrc = view.getUint32(offset + 14, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const data = bytes.slice(dataStart, dataStart + size);

    entries.push({
      path: decoder.decode(bytes.slice(nameStart, nameStart + nameLength)),
      text: decoder.decode(data),
      crcOk: crc32(data) === declaredCrc,
    });
    offset = dataStart + size;
  }

  return entries;
}

describe("the workbook container", () => {
  const workbook = buildXlsx([
    { name: "Figures", rows: [["Year", "Revenue"], ["FY2024", 2131750]] },
    { name: "Sources", rows: [["Zenith Bank Plc & others", "page 39"]] },
  ]);

  const entries = unzip(workbook);

  it("is a zip Excel will open, with every part it insists on", () => {
    expect(entries.map((entry) => entry.path)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
  });

  it("gets every checksum right", () => {
    expect(entries.every((entry) => entry.crcOk)).toBe(true);
  });

  it("ends with a central directory, so a reader can find the entries", () => {
    // The end-of-central-directory signature, at the end of the file.
    const tail = workbook.slice(workbook.length - 22);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("names both sheets in the workbook part", () => {
    const text = entries.find((entry) => entry.path === "xl/workbook.xml")?.text ?? "";
    expect(text).toContain('name="Figures"');
    expect(text).toContain('name="Sources"');
  });
});

describe("what a cell carries", () => {
  function sheetText(rows: (string | number | null)[][]): string {
    const entries = unzip(buildXlsx([{ name: "Sheet", rows }]));
    return entries.find((entry) => entry.path === "xl/worksheets/sheet1.xml")?.text ?? "";
  }

  it("writes a number as a number and a string as an inline string", () => {
    const text = sheetText([[2131750, "Revenue"]]);
    expect(text).toContain('<c r="A1"><v>2131750</v></c>');
    expect(text).toContain('t="inlineStr"');
    expect(text).toContain("<t xml:space=\"preserve\">Revenue</t>");
  });

  it("escapes a company that has an ampersand in its name", () => {
    expect(sheetText([["Smith & Sons <Plc>"]])).toContain("Smith &amp; Sons &lt;Plc&gt;");
  });

  it("will not let a cell become a formula on the way into somebody's spreadsheet", () => {
    // A workbook keeps formulas in their own element, so this is belt and
    // braces — but a figures file is opened by people who paste it elsewhere,
    // and a figure that changes in transit is the one defect nobody would spot.
    const text = sheetText([["=SUM(A1:A9)"], ["+1"], ["-1"], ["@import"]]);
    expect(text).toContain("&apos;=SUM(A1:A9)");
    expect(text).toContain("&apos;+1");
    expect(text).toContain("&apos;-1");
    expect(text).toContain("&apos;@import");
  });

  it("leaves an empty cell out rather than writing an empty string", () => {
    const text = sheetText([["Revenue", null, ""]]);
    expect(text).toContain('r="A1"');
    expect(text).not.toContain('r="B1"');
    expect(text).not.toContain('r="C1"');
  });

  it("drops control characters that would make Excel refuse the file", () => {
    expect(sheetText([["bad\u0000value"]])).toContain("badvalue");
  });
});

describe("the small print", () => {
  it("counts columns the way a spreadsheet does", () => {
    expect(cellRef(0, 0)).toBe("A1");
    expect(cellRef(25, 0)).toBe("Z1");
    expect(cellRef(26, 1)).toBe("AA2");
    expect(cellRef(27, 9)).toBe("AB10");
  });

  it("keeps a sheet name inside Excel's rules instead of failing the download", () => {
    expect(safeSheetName("Figures / Ratios [2024]")).toBe("Figures   Ratios  2024");
    expect(safeSheetName("x".repeat(40))).toHaveLength(31);
    expect(safeSheetName("   ")).toBe("Sheet");
  });

  it("refuses to write a workbook with no sheets", () => {
    expect(() => buildXlsx([])).toThrow(/at least one sheet/);
  });
});
