/**
 * A spreadsheet, written by hand.
 *
 * An .xlsx file is a zip of XML. Writing the few parts Excel insists on is about
 * two hundred lines, which is cheaper than a dependency that can go unmaintained
 * in a repository whose whole promise is that a reader can audit it. Nothing
 * here is clever: entries are stored rather than deflated, strings are inline
 * rather than pooled, and the result opens in Excel, LibreOffice and Numbers.
 *
 * Two things it is careful about.
 *
 * A cell beginning =, +, - or @ is prefixed with an apostrophe. A workbook keeps
 * formulas in their own element, so a value is not evaluated the way it would be
 * in a CSV — but a figures file is opened by people whose job is to paste it
 * somewhere else, and a cell that becomes a formula on the way is a figure that
 * changed without anybody deciding to change it.
 *
 * And every string is escaped for XML. A company called "Smith & Sons" is not an
 * edge case; it is Tuesday.
 */

export type CellValue = string | number | null;

export interface Sheet {
  /** Shown on the tab. Excel refuses more than 31 characters and some symbols. */
  name: string;
  rows: CellValue[][];
}

const DANGEROUS_LEAD = /^[=+\-@\t\r]/;

function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
      // Control characters are not legal in XML 1.0 and make Excel refuse the
      // whole file rather than skip the cell.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  );
}

/** Excel's own sheet-name rules, applied quietly rather than failing a download. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned) || "Sheet";
}

/** A1, B1, …, Z1, AA1. */
export function cellRef(column: number, row: number): string {
  let reference = "";
  let remaining = column + 1;
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    reference = String.fromCharCode(65 + index) + reference;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return reference + (row + 1);
}

function cellXml(value: CellValue, column: number, row: number): string {
  if (value === null || value === "") return "";
  const reference = cellRef(column, row);
  if (typeof value === "number" && Number.isFinite(value)) {
    return '<c r="' + reference + '"><v>' + String(value) + "</v></c>";
  }
  const text = String(value);
  const guarded = DANGEROUS_LEAD.test(text) ? "'" + text : text;
  return (
    '<c r="' +
    reference +
    '" t="inlineStr"><is><t xml:space="preserve">' +
    escapeXml(guarded) +
    "</t></is></c>"
  );
}

function sheetXml(sheet: Sheet): string {
  const rows = sheet.rows
    .map((cells, rowIndex) => {
      const body = cells.map((value, column) => cellXml(value, column, rowIndex)).join("");
      return '<row r="' + (rowIndex + 1) + '">' + body + "</row>";
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<sheetData>" +
    rows +
    "</sheetData></worksheet>"
  );
}

// ---------------------------------------------------------------------------
// The zip container
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

function writeUint16(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(target: number[], value: number): void {
  target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

/**
 * A zip with stored (uncompressed) entries. A figures workbook is tens of
 * kilobytes; trading a few of them for a container anybody can read without a
 * compression library is the right way round.
 */
function zip(entries: readonly ZipEntry[]): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.bytes);
    const offset = local.length;

    writeUint32(local, 0x04034b50);
    writeUint16(local, 20); // version needed
    writeUint16(local, 0x0800); // UTF-8 names
    writeUint16(local, 0); // stored
    writeUint16(local, 0); // time
    writeUint16(local, 0); // date
    writeUint32(local, crc);
    writeUint32(local, entry.bytes.length);
    writeUint32(local, entry.bytes.length);
    writeUint16(local, name.length);
    writeUint16(local, 0);
    local.push(...name, ...entry.bytes);

    writeUint32(central, 0x02014b50);
    writeUint16(central, 20); // version made by
    writeUint16(central, 20); // version needed
    writeUint16(central, 0x0800);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, crc);
    writeUint32(central, entry.bytes.length);
    writeUint32(central, entry.bytes.length);
    writeUint16(central, name.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, offset);
    central.push(...name);
  }

  const end: number[] = [];
  writeUint32(end, 0x06054b50);
  writeUint16(end, 0);
  writeUint16(end, 0);
  writeUint16(end, entries.length);
  writeUint16(end, entries.length);
  writeUint32(end, central.length);
  writeUint32(end, local.length);
  writeUint16(end, 0);

  return new Uint8Array([...local, ...central, ...end]);
}

/** The workbook. One worksheet per sheet, in the order given. */
export function buildXlsx(sheets: readonly Sheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error("A workbook needs at least one sheet");
  const encoder = new TextEncoder();
  const named = sheets.map((sheet) => ({ ...sheet, name: safeSheetName(sheet.name) }));

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    named
      .map(
        (_, index) =>
          '<Override PartName="/xl/worksheets/sheet' +
          (index + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      )
      .join("") +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    named
      .map(
        (sheet, index) =>
          '<sheet name="' +
          escapeXml(sheet.name) +
          '" sheetId="' +
          (index + 1) +
          '" r:id="rId' +
          (index + 1) +
          '"/>',
      )
      .join("") +
    "</sheets></workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    named
      .map(
        (_, index) =>
          '<Relationship Id="rId' +
          (index + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
          (index + 1) +
          '.xml"/>',
      )
      .join("") +
    "</Relationships>";

  return zip([
    { path: "[Content_Types].xml", bytes: encoder.encode(contentTypes) },
    { path: "_rels/.rels", bytes: encoder.encode(rootRels) },
    { path: "xl/workbook.xml", bytes: encoder.encode(workbook) },
    { path: "xl/_rels/workbook.xml.rels", bytes: encoder.encode(workbookRels) },
    ...named.map((sheet, index) => ({
      path: "xl/worksheets/sheet" + (index + 1) + ".xml",
      bytes: encoder.encode(sheetXml(sheet)),
    })),
  ]);
}
