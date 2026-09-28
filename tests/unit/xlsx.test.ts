import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildXlsx, columnLetter, safeSheetName } from '@/lib/reports/xlsx';

/**
 * The workbook writer.
 *
 * The lesson from the QR code that would not scan: a file format is not "done" because the
 * bytes came out. The integration test opens one of these with a reference reader; this one
 * pins the pieces a reader depends on — the zip container, the part names, and the cell types.
 */

function entries(buffer: Buffer): string[] {
  // The central directory lists every path; reading it proves the container is well formed
  // rather than merely starting with the right two bytes.
  const text = buffer.toString('latin1');
  const found: string[] = [];
  let index = text.indexOf('PK\u0001\u0002');
  while (index !== -1) {
    const nameLength = buffer.readUInt16LE(index + 28);
    found.push(buffer.subarray(index + 46, index + 46 + nameLength).toString('utf8'));
    index = text.indexOf('PK\u0001\u0002', index + 1);
  }
  return found;
}

function part(buffer: Buffer, path: string): string {
  const text = buffer.toString('latin1');
  let index = text.indexOf('PK\u0003\u0004');
  while (index !== -1) {
    const nameLength = buffer.readUInt16LE(index + 26);
    const extraLength = buffer.readUInt16LE(index + 28);
    const compressedSize = buffer.readUInt32LE(index + 18);
    const name = buffer.subarray(index + 30, index + 30 + nameLength).toString('utf8');
    const start = index + 30 + nameLength + extraLength;
    if (name === path) {
      // Raw deflate, as a zip stores it: no zlib header to check.
      return inflateRawSync(buffer.subarray(start, start + compressedSize)).toString('utf8');
    }
    index = text.indexOf('PK\u0003\u0004', index + 1);
  }
  throw new Error(`No part named ${path}`);
}

describe('the xlsx writer', () => {
  const workbook = buildXlsx([
    {
      name: 'Numbers',
      columns: [{ header: 'Name' }, { header: 'Percent' }, { header: 'Marked' }],
      rows: [
        ['AS1', 92.4, true],
        ['A2', 0, false],
        ['Nothing', null, null],
      ],
    },
    { name: 'Second', columns: [{ header: 'One' }], rows: [['x']] },
  ]);

  it('is a zip with exactly the parts a reader looks for', () => {
    expect(workbook.subarray(0, 2).toString()).toBe('PK');
    expect(entries(workbook).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
  });

  it('writes numbers as numbers and booleans as booleans', () => {
    const sheet = part(workbook, 'xl/worksheets/sheet1.xml');
    // A percentage stored as a string is a column a bursar cannot sum.
    expect(sheet).toContain('<v>92.4</v>');
    expect(sheet).toContain('t="b"><v>1</v>');
    expect(sheet).toContain('t="b"><v>0</v>');
    // Zero is a value, not an empty cell.
    expect(sheet).toContain('<v>0</v>');
    // And an empty cell carries no type at all rather than the string "null".
    expect(sheet).not.toContain('null');
  });

  it('escapes what would otherwise break the XML', () => {
    const escaped = buildXlsx([
      { name: 'X', columns: [{ header: 'A & B' }], rows: [['<script>"quoted"</script>']] },
    ]);
    const sheet = part(escaped, 'xl/worksheets/sheet1.xml');
    expect(sheet).toContain('A &amp; B');
    expect(sheet).toContain('&lt;script&gt;');
    expect(sheet).not.toContain('<script>');
  });

  it('names every sheet legally', () => {
    expect(safeSheetName('By section / teacher')).toBe('By section   teacher');
    expect(safeSheetName('a'.repeat(50)).length).toBe(31);
    expect(safeSheetName('')).toBe('Sheet');
  });

  it('counts columns the way Excel does', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
    expect(columnLetter(51)).toBe('AZ');
    expect(columnLetter(52)).toBe('BA');
  });

  it('is byte-identical for the same data', () => {
    // Fixed timestamps in the zip records: an export a school diffs against last week's should
    // differ only where the figures differ.
    const again = buildXlsx([
      {
        name: 'Numbers',
        columns: [{ header: 'Name' }, { header: 'Percent' }, { header: 'Marked' }],
        rows: [
          ['AS1', 92.4, true],
          ['A2', 0, false],
          ['Nothing', null, null],
        ],
      },
      { name: 'Second', columns: [{ header: 'One' }], rows: [['x']] },
    ]);
    expect(again.equals(workbook)).toBe(true);
  });
});
