import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from '@/lib/services/import/csv';
import { guessMapping, missingRequiredFields } from '@/lib/services/import/mapping';
import { parseImportDate } from '@/lib/services/import/students';

describe('CSV parsing', () => {
  it('reads a plain file', () => {
    const table = parseCsv('Name,Roll\nAyesha Khan,12\nBilal Malik,13\n');
    expect(table.headers).toEqual(['Name', 'Roll']);
    expect(table.rows).toEqual([
      ['Ayesha Khan', '12'],
      ['Bilal Malik', '13'],
    ]);
  });

  it('strips the byte order mark Excel prepends', () => {
    // Without this the first column is named "﻿Name" and never maps to anything.
    const table = parseCsv('﻿Name,Roll\nAyesha,1\n');
    expect(table.headers[0]).toBe('Name');
  });

  it('handles CRLF line endings', () => {
    const table = parseCsv('Name,Roll\r\nAyesha,1\r\nBilal,2\r\n');
    expect(table.rows).toEqual([
      ['Ayesha', '1'],
      ['Bilal', '2'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // Addresses and guardian names are exactly where a split(',') parser corrupts data.
    const table = parseCsv('Name,Address\n"Khan, Ayesha","12 Main Road, Gulberg III, Lahore"\n');
    expect(table.rows[0]).toEqual(['Khan, Ayesha', '12 Main Road, Gulberg III, Lahore']);
  });

  it('unescapes doubled quotes', () => {
    const table = parseCsv('Name,Note\nAyesha,"She said ""present"" twice"\n');
    expect(table.rows[0]?.[1]).toBe('She said "present" twice');
  });

  it('keeps embedded newlines inside a quoted field', () => {
    const table = parseCsv('Name,Address\nAyesha,"12 Main Road\nGulberg"\n');
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.[1]).toBe('12 Main Road\nGulberg');
  });

  it('drops the trailing blank lines an export leaves behind', () => {
    const table = parseCsv('Name,Roll\nAyesha,1\n\n\n');
    expect(table.rows).toHaveLength(1);
  });

  it('preserves empty cells rather than collapsing the row', () => {
    const table = parseCsv('Name,Roll,House\nAyesha,,Iqbal\n');
    expect(table.rows[0]).toEqual(['Ayesha', '', 'Iqbal']);
  });

  it('detects semicolon and tab separated files', () => {
    expect(detectDelimiter('Name;Roll;House\n')).toBe(';');
    expect(detectDelimiter('Name\tRoll\tHouse\n')).toBe('\t');
    expect(detectDelimiter('Name,Roll,House\n')).toBe(',');
    expect(detectDelimiter('Name\n')).toBe(',');
  });
});

describe('column mapping', () => {
  it('guesses the headers a real school export uses', () => {
    const headers = [
      'Adm No',
      'Name of Student',
      'Class',
      "Father's Name",
      'Father Mobile',
      'DOB',
      'Gender',
    ];
    const mapping = guessMapping(headers);

    expect(mapping.admissionNumber).toBe(0);
    expect(mapping.name).toBe(1);
    expect(mapping.yearGroup).toBe(2);
    expect(mapping.guardianName).toBe(3);
    expect(mapping.guardianPhone).toBe(4);
    expect(mapping.dateOfBirth).toBe(5);
    expect(mapping.gender).toBe(6);
  });

  it('does not map two fields onto the same column', () => {
    const mapping = guessMapping(['Name', 'Roll No', 'Admission Number']);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it('reports the required fields it could not find', () => {
    const mapping = guessMapping(['Nickname', 'Favourite colour']);
    expect(missingRequiredFields(mapping).sort()).toEqual(['admissionNumber', 'name', 'yearGroup']);
  });

  it('finds nothing to complain about once the required columns are there', () => {
    const mapping = guessMapping(['Admission No', 'Student Name', 'Year Group']);
    expect(missingRequiredFields(mapping)).toEqual([]);
  });
});

describe('import date parsing', () => {
  it('reads ISO dates', () => {
    expect(parseImportDate('2009-04-17').value?.toISOString()).toBe('2009-04-17T00:00:00.000Z');
  });

  it('reads DD/MM/YYYY, which is what a Pakistani export uses', () => {
    expect(parseImportDate('17/04/2009').value?.toISOString()).toBe('2009-04-17T00:00:00.000Z');
    expect(parseImportDate('7-4-2009').value?.toISOString()).toBe('2009-04-07T00:00:00.000Z');
  });

  it('refuses to guess on an American-looking date rather than silently swapping it', () => {
    // A wrong date of birth that imports cleanly is worse than a rejected row.
    const result = parseImportDate('04/17/2009');
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/DD\/MM\/YYYY/);
  });

  it('rejects impossible dates', () => {
    expect(parseImportDate('31/02/2009').value).toBeNull();
    expect(parseImportDate('not a date').error).toBeTruthy();
  });

  it('treats an empty cell as no date, not an error', () => {
    expect(parseImportDate('')).toEqual({ value: null });
    expect(parseImportDate('   ')).toEqual({ value: null });
  });
});
