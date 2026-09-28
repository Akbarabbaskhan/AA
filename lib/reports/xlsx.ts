import { deflateRawSync, crc32 } from 'node:zlib';

/**
 * A minimal `.xlsx` writer.
 *
 * Every report exports to Excel, and the obvious way to do that is a spreadsheet library —
 * but the two candidates weigh a couple of megabytes, pull in transitive advisories, and would
 * be the largest dependency in a system holding minors' data for the sake of one file format.
 * An xlsx is a zip of five small XML parts, so this writes them.
 *
 * The parts are the minimum Excel and LibreOffice accept: content types, the package
 * relationships, the workbook, its relationships, one sheet per report section, and a styles
 * part with exactly two formats — a bold header and a date. Strings are written inline rather
 * than through a shared-strings table, which costs a few bytes and removes a whole index that
 * can disagree with the cells.
 *
 * Verified against a reference reader in the tests, because a file format nobody can open is
 * the same lesson as the QR code that would not scan.
 */

export type CellValue = string | number | boolean | null;

export type Sheet = {
  /** Excel sheet names: 31 characters, and none of : \\ / ? * [ ] */
  name: string;
  columns: { header: string; width?: number }[];
  rows: CellValue[][];
};

function escapeXml(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Control characters are not legal in XML 1.0 and Excel refuses the whole file for one.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  );
}

/** `A`, `B`, … `Z`, `AA`. Excel's column letters, which are base-26 with no zero. */
export function columnLetter(index: number): string {
  let letters = '';
  let remaining = index + 1;
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return letters;
}

export function safeSheetName(name: string, fallback = 'Sheet'): string {
  const cleaned = name
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned.length > 0 ? cleaned : fallback;
}

function cellXml(value: CellValue, reference: string, isHeader: boolean): string {
  const style = isHeader ? ' s="1"' : '';
  if (value === null || value === undefined || value === '') {
    return `<c r="${reference}"${style}/>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"${style}><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const rows: string[] = [];

  const headerCells = sheet.columns
    .map((column, index) => cellXml(column.header, `${columnLetter(index)}1`, true))
    .join('');
  rows.push(`<row r="1">${headerCells}</row>`);

  sheet.rows.forEach((row, rowIndex) => {
    const reference = rowIndex + 2;
    const cells = row
      .map((value, index) => cellXml(value, `${columnLetter(index)}${reference}`, false))
      .join('');
    rows.push(`<row r="${reference}">${cells}</row>`);
  });

  const cols = sheet.columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 18}" customWidth="1"/>`,
    )
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    // The header row stays put when a principal scrolls a thousand-row absence list.
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    `<cols>${cols}</cols>`,
    `<sheetData>${rows.join('')}</sheetData>`,
    '</worksheet>',
  ].join('');
}

const CONTENT_TYPES = (count: number): string =>
  [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    Array.from(
      { length: count },
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ).join(''),
    '</Types>',
  ].join('');

const ROOT_RELS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
  '</Relationships>',
].join('');

const STYLES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>',
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>',
  '<borders count="1"><border/></borders>',
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  // 0: body, 1: bold header.
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>',
  // Readers warn about a workbook with no named default style, and a warning in a principal's
  // spreadsheet is a support call.
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
  '</styleSheet>',
].join('');

function workbookXml(sheets: readonly Sheet[]): string {
  const entries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(safeSheetName(sheet.name, `Sheet${index + 1}`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheets>${entries}</sheets>`,
    '</workbook>',
  ].join('');
}

function workbookRels(count: number): string {
  const sheetRels = Array.from(
    { length: count },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    sheetRels,
    `<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    '</Relationships>',
  ].join('');
}

type ZipEntry = { path: string; data: Buffer };

/**
 * A zip container, written by hand.
 *
 * Deflate comes from `node:zlib` and the CRC from the same module, so the only thing here is
 * the record layout: a local header per entry, a central directory, and the end-of-directory
 * record. Dates are fixed rather than "now", which makes an export of the same data
 * byte-identical — a property a test can assert and a school can diff.
 */
function zip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x2100, 12); // date: 1 Jan 2000, fixed for reproducibility
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x2100, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, end]);
}

/** The workbook, as bytes ready to stream. */
export function buildXlsx(sheets: readonly Sheet[]): Buffer {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet');

  const entries: ZipEntry[] = [
    { path: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES(sheets.length), 'utf8') },
    { path: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { path: 'xl/workbook.xml', data: Buffer.from(workbookXml(sheets), 'utf8') },
    { path: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels(sheets.length), 'utf8') },
    { path: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    ...sheets.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      data: Buffer.from(sheetXml(sheet), 'utf8'),
    })),
  ];

  return zip(entries);
}
