/**
 * A CSV reader that handles what a school office actually produces.
 *
 * Excel exports arrive with a UTF-8 BOM, CRLF line endings, quoted fields containing commas
 * (addresses, guardian names), and doubled quotes inside quoted fields. A `split(',')`
 * parser silently mangles all four and the errors surface days later as corrupted names.
 */
export type CsvTable = {
  headers: string[];
  rows: string[][];
};

export function parseCsv(input: string, delimiter = ','): CsvTable {
  // Strip the byte order mark Excel prepends, or the first header becomes "﻿Name".
  const text = input.replace(/^﻿/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      // CRLF — the \n that follows closes the row.
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headerRow = rows.shift() ?? [];
  const headers = headerRow.map((header) => header.trim());

  return {
    headers,
    // Trailing blank lines are an artefact of the export, not a row the office meant.
    rows: rows.filter((entry) => entry.some((cell) => cell.trim().length > 0)),
  };
}

/** Guesses the delimiter, because a school's "CSV" is often semicolon- or tab-separated. */
export function detectDelimiter(sample: string): string {
  const firstLine = sample.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '';
  const counts = [',', ';', '\t', '|'].map((candidate) => ({
    candidate,
    count: firstLine.split(candidate).length - 1,
  }));
  const best = counts.sort((a, b) => b.count - a.count)[0];
  return best && best.count > 0 ? best.candidate : ',';
}
