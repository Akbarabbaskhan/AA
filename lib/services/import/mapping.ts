import { z } from 'zod';

/**
 * Column mapping for bulk import.
 *
 * "Upload an Excel or CSV, map columns to fields in a UI." A school's spreadsheet never has
 * the column names the system wants, so the mapping is data the admin confirms — but the
 * guesses below get most files right on the first screen, which is the difference between
 * a ten-minute onboarding and an afternoon.
 */
export const STUDENT_FIELDS = {
  admissionNumber: { label: 'Admission number', required: true },
  name: { label: 'Student name', required: true },
  rollNumber: { label: 'Roll number', required: false },
  gender: { label: 'Gender', required: false },
  dateOfBirth: { label: 'Date of birth', required: false },
  yearGroup: { label: 'Year group', required: true },
  house: { label: 'House', required: false },
  phone: { label: 'Student phone', required: false },
  email: { label: 'Student email', required: false },
  guardianName: { label: 'Guardian name', required: false },
  guardianPhone: { label: 'Guardian phone', required: false },
  guardianRelation: { label: 'Guardian relation', required: false },
  guardianCnic: { label: 'Guardian CNIC', required: false },
  subjects: { label: 'Subjects (comma separated codes)', required: false },
} as const;

export type StudentField = keyof typeof STUDENT_FIELDS;

export const studentFieldNames = Object.keys(STUDENT_FIELDS) as StudentField[];

/** Header spellings seen in real school exports, normalised. */
const SYNONYMS: Record<StudentField, string[]> = {
  admissionNumber: ['admission no', 'admission number', 'adm no', 'admno', 'admission', 'reg no', 'registration number'],
  name: ['name', 'student name', 'full name', 'student', 'name of student'],
  rollNumber: ['roll no', 'roll number', 'roll', 'class roll no'],
  gender: ['gender', 'sex', 'm/f'],
  dateOfBirth: ['dob', 'date of birth', 'birth date', 'birthdate'],
  yearGroup: ['year group', 'class', 'grade', 'year', 'level', 'section class'],
  house: ['house'],
  phone: ['phone', 'mobile', 'student mobile', 'contact', 'cell'],
  email: ['email', 'e-mail', 'student email'],
  guardianName: ['father name', "father's name", 'guardian name', 'parent name', 'guardian'],
  guardianPhone: ['father mobile', 'guardian mobile', 'parent mobile', 'guardian phone', 'parent contact', 'father contact'],
  guardianRelation: ['relation', 'guardian relation', 'relationship'],
  guardianCnic: ['cnic', 'father cnic', 'guardian cnic', 'nic'],
  subjects: ['subjects', 'subject combination', 'options', 'combination'],
};

function normalise(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function words(value: string): string[] {
  return normalise(value).split(' ').filter(Boolean);
}

/** True when `phrase` appears as a run of whole words inside `haystack`. */
function containsPhrase(haystack: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > haystack.length) return false;
  for (let start = 0; start + phrase.length <= haystack.length; start += 1) {
    if (phrase.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/**
 * Best-effort guess of which spreadsheet column feeds which field. The admin always
 * confirms it — a wrong guess costs a dropdown, an unguessed column costs a support call.
 *
 * Exact header matches are claimed first, across every field, before any looser matching
 * runs. Without that ordering "Father Mobile" is claimed by the student's phone simply
 * because `phone` is checked earlier in the list, and the guardian silently loses their
 * number — which is the one field the absence alerts depend on.
 *
 * The loose pass matches whole words only. A substring match maps "Nickname" onto the
 * student's name, and a required column that looks mapped is worse than one that is
 * obviously missing.
 */
export function guessMapping(headers: readonly string[]): Partial<Record<StudentField, number>> {
  const mapping: Partial<Record<StudentField, number>> = {};
  const used = new Set<number>();
  const headerWords = headers.map(words);
  const headerNormalised = headers.map(normalise);

  for (const field of studentFieldNames) {
    const candidates = SYNONYMS[field].map(normalise);
    const index = headerNormalised.findIndex(
      (header, position) => !used.has(position) && candidates.includes(header),
    );
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }

  for (const field of studentFieldNames) {
    if (mapping[field] !== undefined) continue;
    const candidates = SYNONYMS[field].map(words);
    const index = headerWords.findIndex(
      (header, position) =>
        !used.has(position) && candidates.some((candidate) => containsPhrase(header, candidate)),
    );
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }

  return mapping;
}

export const mappingSchema = z.record(z.string(), z.number().int().min(0));

export function missingRequiredFields(
  mapping: Partial<Record<StudentField, number>>,
): StudentField[] {
  return studentFieldNames.filter(
    (field) => STUDENT_FIELDS[field].required && mapping[field] === undefined,
  );
}
