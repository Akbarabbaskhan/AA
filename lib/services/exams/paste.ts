/**
 * Parsing a column pasted from Excel.
 *
 * Deliberately in its own module with no imports: the marks grid is a client component, and
 * pulling this from the service would drag Prisma and argon2 into the browser bundle.
 * Pure, so the grid can preview a paste before anything is saved and the rules stay
 * testable on their own.
 */
export type PastedValue = { marksObtained: number | null; isAbsent: boolean; raw: string };

export function parsePastedColumn(text: string): PastedValue[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('\t')[0] ?? '')
    .filter((line, index, all) => line.trim().length > 0 || index < all.length - 1)
    .map((raw) => {
      const value = raw.trim();
      if (value.length === 0) return { marksObtained: null, isAbsent: false, raw };

      // The spellings a teacher actually types for an absence.
      if (/^(a|ab|abs|absent|-)$/i.test(value)) {
        return { marksObtained: null, isAbsent: true, raw };
      }

      const numeric = Number(value.replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(numeric)) return { marksObtained: null, isAbsent: false, raw };

      return { marksObtained: Math.round(numeric), isAbsent: false, raw };
    });
}
