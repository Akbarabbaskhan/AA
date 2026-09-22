import { randomUUID } from 'node:crypto';
import type { Gender, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { normalisePhone } from '@/lib/utils/phone';
import { writeAuditMany } from '@/lib/services/audit';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { parseCsv, detectDelimiter } from './csv';
import { guessMapping, missingRequiredFields, type StudentField } from './mapping';

/**
 * Bulk student import.
 *
 * "Build it properly: upload an Excel or CSV, map columns to fields in a UI, preview the
 * first 20 rows with validation errors flagged inline, then commit as a background job with
 * a downloadable error report for failed rows. Importing the same file twice must not
 * create duplicates — dedupe on admission number."
 *
 * Acceptance: 500 students, their guardians and their subject enrolments live in under ten
 * minutes, with every rejected row explained.
 */

export type RowIssue = {
  field: StudentField | '_row';
  message: string;
};

export type ValidatedRow = {
  /** 1-based, and counting the header — so it matches what the admin sees in Excel. */
  rowNumber: number;
  values: Partial<Record<StudentField, string>>;
  issues: RowIssue[];
  /** Set when the row matches an existing student by admission number. */
  existingStudentId: string | null;
  action: 'create' | 'update' | 'reject';
};

export type ImportPreview = {
  headers: string[];
  mapping: Partial<Record<StudentField, number>>;
  missingRequired: StudentField[];
  totalRows: number;
  /** "Preview the first 20 rows with validation errors flagged inline." */
  sample: ValidatedRow[];
  counts: { create: number; update: number; reject: number };
};

const GENDERS: Record<string, Gender> = {
  m: 'MALE',
  male: 'MALE',
  boy: 'MALE',
  f: 'FEMALE',
  female: 'FEMALE',
  girl: 'FEMALE',
  o: 'OTHER',
  other: 'OTHER',
};

/**
 * Dates in a Pakistani school export are `DD/MM/YYYY` far more often than `MM/DD/YYYY`.
 * Anything ambiguous that cannot be read is reported rather than guessed — a silently
 * wrong date of birth is worse than a rejected row.
 */
export function parseImportDate(raw: string): { value: Date | null; error?: string } {
  const text = raw.trim();
  if (text.length === 0) return { value: null };

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return { value: new Date(`${text}T00:00:00.000Z`) };

  const slashed = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (slashed) {
    const day = Number(slashed[1]);
    const month = Number(slashed[2]);
    const yearRaw = Number(slashed[3]);
    const year = yearRaw < 100 ? 1900 + yearRaw : yearRaw;

    if (month > 12) {
      return { value: null, error: 'Looks like MM/DD/YYYY; use DD/MM/YYYY or YYYY-MM-DD' };
    }
    if (day > 31 || day < 1 || month < 1) return { value: null, error: 'Not a valid date' };

    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) {
      return { value: null, error: 'Not a valid date' };
    }
    return { value: date };
  }

  return { value: null, error: 'Use DD/MM/YYYY or YYYY-MM-DD' };
}

type Lookups = {
  yearGroups: Map<string, string>;
  subjects: Map<string, { id: string; code: string }>;
  existingByAdmission: Map<string, string>;
  takenPhones: Set<string>;
  /** Phones that already belong to a guardian account, which a sibling reuses. */
  guardianPhones: Set<string>;
  takenEmails: Set<string>;
};

async function loadLookups(): Promise<Lookups> {
  const [yearGroups, subjects, students, users] = await Promise.all([
    prisma.yearGroup.findMany({ select: { id: true, name: true } }),
    prisma.subject.findMany({ select: { id: true, code: true, name: true } }),
    prisma.student.findMany({ select: { id: true, admissionNumber: true } }),
    prisma.user.findMany({
      select: { phone: true, email: true, guardian: { select: { id: true } } },
    }),
  ]);

  const subjectMap = new Map<string, { id: string; code: string }>();
  for (const subject of subjects) {
    subjectMap.set(subject.code.toLowerCase(), { id: subject.id, code: subject.code });
    subjectMap.set(subject.name.toLowerCase(), { id: subject.id, code: subject.code });
  }

  return {
    yearGroups: new Map(yearGroups.map((group) => [group.name.toLowerCase(), group.id])),
    subjects: subjectMap,
    existingByAdmission: new Map(
      students.map((student) => [student.admissionNumber.toLowerCase(), student.id]),
    ),
    takenPhones: new Set(users.map((user) => user.phone).filter((phone): phone is string => !!phone)),
    guardianPhones: new Set(
      users
        .filter((user) => user.guardian !== null)
        .map((user) => user.phone)
        .filter((phone): phone is string => !!phone),
    ),
    takenEmails: new Set(users.map((user) => user.email).filter((email): email is string => !!email)),
  };
}

function validateRow(
  rowNumber: number,
  cells: readonly string[],
  mapping: Partial<Record<StudentField, number>>,
  lookups: Lookups,
  seenAdmissions: Set<string>,
): ValidatedRow {
  const read = (field: StudentField): string => {
    const index = mapping[field];
    if (index === undefined) return '';
    return (cells[index] ?? '').trim();
  };

  const values: Partial<Record<StudentField, string>> = {};
  for (const field of Object.keys(mapping) as StudentField[]) {
    values[field] = read(field);
  }

  const issues: RowIssue[] = [];

  const admissionNumber = read('admissionNumber');
  if (admissionNumber.length === 0) {
    issues.push({ field: 'admissionNumber', message: 'Admission number is required' });
  } else if (seenAdmissions.has(admissionNumber.toLowerCase())) {
    // Duplicated inside the file itself, which is common after a copy-paste merge.
    issues.push({ field: 'admissionNumber', message: 'Appears more than once in this file' });
  }

  if (read('name').length === 0) {
    issues.push({ field: 'name', message: 'Student name is required' });
  }

  const yearGroup = read('yearGroup');
  if (yearGroup.length === 0) {
    issues.push({ field: 'yearGroup', message: 'Year group is required' });
  } else if (!lookups.yearGroups.has(yearGroup.toLowerCase())) {
    issues.push({
      field: 'yearGroup',
      message: `Unknown year group "${yearGroup}". Create it first, or correct the spelling.`,
    });
  }

  const gender = read('gender');
  if (gender.length > 0 && !GENDERS[gender.toLowerCase()]) {
    issues.push({ field: 'gender', message: `Could not read "${gender}" as a gender` });
  }

  const dateOfBirth = read('dateOfBirth');
  if (dateOfBirth.length > 0) {
    const parsed = parseImportDate(dateOfBirth);
    if (parsed.error) issues.push({ field: 'dateOfBirth', message: parsed.error });
  }

  const existingStudentId = lookups.existingByAdmission.get(admissionNumber.toLowerCase()) ?? null;

  const studentPhone = read('phone');
  if (studentPhone.length > 0) {
    const normalised = normalisePhone(studentPhone);
    if (!normalised) {
      issues.push({ field: 'phone', message: `Student phone "${studentPhone}" is not a usable number` });
    } else if (!existingStudentId && lookups.takenPhones.has(normalised)) {
      // A student cannot share a login with somebody else. Re-importing the same student
      // keeps their own number, so only a clash on a new row is an error.
      issues.push({ field: 'phone', message: 'Student phone already belongs to another account' });
    }
  }

  const guardianPhone = read('guardianPhone');
  if (guardianPhone.length > 0) {
    const normalised = normalisePhone(guardianPhone);
    if (!normalised) {
      issues.push({
        field: 'guardianPhone',
        message: `Guardian phone "${guardianPhone}" is not a usable number`,
      });
    } else if (lookups.takenPhones.has(normalised) && !lookups.guardianPhones.has(normalised)) {
      /*
       * A guardian's number being already known is the normal case, not an error: that is
       * how a sibling is linked to the parent account that already exists, and rejecting it
       * would break every second child in a family import.
       *
       * What is an error is a number that belongs to a student or a staff member, because
       * linking a parent to somebody else's login hands them that person's access.
       */
      issues.push({
        field: 'guardianPhone',
        message: 'That number already belongs to a student or staff account',
      });
    }
  }

  const subjects = read('subjects');
  if (subjects.length > 0) {
    for (const token of subjects.split(/[,;/]/)) {
      const code = token.trim();
      if (code.length === 0) continue;
      if (!lookups.subjects.has(code.toLowerCase())) {
        issues.push({ field: 'subjects', message: `Unknown subject "${code}"` });
      }
    }
  }

  if (admissionNumber.length > 0) seenAdmissions.add(admissionNumber.toLowerCase());

  return {
    rowNumber,
    values,
    issues,
    existingStudentId,
    action: issues.length > 0 ? 'reject' : existingStudentId ? 'update' : 'create',
  };
}

export async function previewStudentImport(
  actor: Actor,
  file: string,
  overrideMapping?: Partial<Record<StudentField, number>>,
): Promise<ImportPreview> {
  requireCapability(actor, 'import.run');

  const table = parseCsv(file, detectDelimiter(file));
  if (table.headers.length === 0) {
    throw ApiError.badRequest('emptyFile', 'That file has no header row.');
  }

  const mapping = overrideMapping ?? guessMapping(table.headers);
  const lookups = await loadLookups();
  const seenAdmissions = new Set<string>();

  const validated = table.rows.map((cells, index) =>
    validateRow(index + 2, cells, mapping, lookups, seenAdmissions),
  );

  return {
    headers: table.headers,
    mapping,
    missingRequired: missingRequiredFields(mapping),
    totalRows: validated.length,
    sample: validated.slice(0, 20),
    counts: {
      create: validated.filter((row) => row.action === 'create').length,
      update: validated.filter((row) => row.action === 'update').length,
      reject: validated.filter((row) => row.action === 'reject').length,
    },
  };
}

export type ImportResult = {
  jobId: string;
  total: number;
  created: number;
  updated: number;
  rejected: number;
  /** One line per failed row, downloadable — "every rejected row explained". */
  errorReport: { rowNumber: number; admissionNumber: string; reasons: string[] }[];
};

/**
 * Commits the import.
 *
 * Runs row by row rather than as one transaction on purpose: a single bad row in a
 * 500-row file must not roll back the 499 good ones and send the office back to the start.
 */
export async function commitStudentImport(
  actor: Actor,
  file: string,
  mapping: Partial<Record<StudentField, number>>,
  options: { fileName?: string } = {},
): Promise<ImportResult> {
  requireCapability(actor, 'import.run');

  const missing = missingRequiredFields(mapping);
  if (missing.length > 0) {
    throw ApiError.badRequest(
      'mappingIncomplete',
      'Map every required column before importing.',
      { mapping: missing.map((field) => `${field} is not mapped`) },
    );
  }

  const table = parseCsv(file, detectDelimiter(file));
  const lookups = await loadLookups();
  const seenAdmissions = new Set<string>();
  const rows = table.rows.map((cells, index) =>
    validateRow(index + 2, cells, mapping, lookups, seenAdmissions),
  );

  const academicYear = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (!academicYear) {
    throw ApiError.badRequest('noAcademicYear', 'Set a current academic year before importing.');
  }

  const job = await prisma.importJob.create({
    data: {
      schoolId: actor.schoolId,
      type: 'STUDENTS',
      fileUrl: options.fileName ?? 'inline',
      status: 'RUNNING',
      mappingJson: mapping as Prisma.InputJsonValue,
      rowCount: rows.length,
      createdById: actor.userId,
    },
  });

  // One hash for the whole batch: argon2 takes ~50ms, and 500 of them would add half a
  // minute to an import that is supposed to finish in ten. Every imported account is
  // forced to change it at first login anyway.
  const temporaryPassword = `Volt-${randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(temporaryPassword);

  let created = 0;
  let updated = 0;
  const errorReport: ImportResult['errorReport'] = [];
  const audits: Parameters<typeof writeAuditMany>[1][number][] = [];

  for (const row of rows) {
    if (row.action === 'reject') {
      errorReport.push({
        rowNumber: row.rowNumber,
        admissionNumber: row.values.admissionNumber ?? '',
        reasons: row.issues.map((issue) => `${issue.field}: ${issue.message}`),
      });
      continue;
    }

    try {
      const admissionNumber = row.values.admissionNumber!;
      const name = row.values.name!;
      const yearGroupId = lookups.yearGroups.get(row.values.yearGroup!.toLowerCase())!;
      const phone = row.values.phone ? normalisePhone(row.values.phone) : null;
      const email = row.values.email?.trim().toLowerCase() || null;
      const gender = row.values.gender ? GENDERS[row.values.gender.toLowerCase()] ?? null : null;
      const dateOfBirth = row.values.dateOfBirth
        ? parseImportDate(row.values.dateOfBirth).value
        : null;

      let studentId = row.existingStudentId;

      if (studentId) {
        const student = await prisma.student.update({
          where: { id: studentId },
          data: {
            ...(row.values.rollNumber ? { rollNumber: row.values.rollNumber } : {}),
            ...(row.values.house ? { house: row.values.house } : {}),
            ...(gender ? { gender } : {}),
            ...(dateOfBirth ? { dateOfBirth } : {}),
          },
          select: { id: true, userId: true },
        });
        await prisma.user.update({ where: { id: student.userId }, data: { name } });
        updated += 1;
        audits.push({
          action: 'student.import.update',
          entityType: 'Student',
          entityId: student.id,
          after: { admissionNumber, name },
        });
      } else {
        const user = await prisma.user.create({
          data: {
            schoolId: actor.schoolId,
            name,
            email,
            phone,
            passwordHash,
            // "Forced password change on first login for bulk-imported accounts."
            mustChangePassword: true,
          },
          select: { id: true },
        });

        const student = await prisma.student.create({
          data: {
            schoolId: actor.schoolId,
            userId: user.id,
            admissionNumber,
            rollNumber: row.values.rollNumber || admissionNumber,
            house: row.values.house || null,
            gender,
            dateOfBirth,
            status: 'ACTIVE',
          },
          select: { id: true },
        });

        await prisma.userRole.create({
          data: { schoolId: actor.schoolId, userId: user.id, role: 'STUDENT' },
        });

        studentId = student.id;
        created += 1;
        lookups.existingByAdmission.set(admissionNumber.toLowerCase(), student.id);
        if (phone) lookups.takenPhones.add(phone);
        if (email) lookups.takenEmails.add(email);

        audits.push({
          action: 'student.import.create',
          entityType: 'Student',
          entityId: student.id,
          after: { admissionNumber, name, yearGroup: row.values.yearGroup },
        });
      }

      // Guardian, linked rather than duplicated: a sibling import reuses the same account.
      const guardianPhone = row.values.guardianPhone
        ? normalisePhone(row.values.guardianPhone)
        : null;

      if (row.values.guardianName && guardianPhone) {
        const existingGuardianUser = await prisma.user.findFirst({
          where: { phone: guardianPhone },
          select: { id: true, guardian: { select: { id: true } } },
        });

        let guardianId = existingGuardianUser?.guardian?.id ?? null;

        if (!guardianId) {
          const guardianUser =
            existingGuardianUser ??
            (await prisma.user.create({
              data: {
                schoolId: actor.schoolId,
                name: row.values.guardianName,
                phone: guardianPhone,
                passwordHash,
                mustChangePassword: true,
                // Parents are the audience most likely to need Urdu.
                locale: 'ur',
              },
              select: { id: true, guardian: { select: { id: true } } },
            }));

          const guardian = await prisma.guardian.create({
            data: {
              schoolId: actor.schoolId,
              userId: guardianUser.id,
              relation: row.values.guardianRelation || 'Guardian',
              cnic: row.values.guardianCnic || null,
            },
            select: { id: true },
          });
          guardianId = guardian.id;

          await prisma.userRole.upsert({
            where: { userId_role: { userId: guardianUser.id, role: 'PARENT' } },
            create: { schoolId: actor.schoolId, userId: guardianUser.id, role: 'PARENT' },
            update: {},
          });

          // So the next sibling in this same file reuses the account rather than
          // colliding with it.
          lookups.takenPhones.add(guardianPhone);
          lookups.guardianPhones.add(guardianPhone);
        }

        await prisma.guardianStudent.upsert({
          where: { guardianId_studentId: { guardianId, studentId } },
          create: {
            schoolId: actor.schoolId,
            guardianId,
            studentId,
            isPrimary: true,
            receivesAlerts: true,
          },
          update: {},
        });
      }

      // Subject enrolments, matched to a section in the student's year group.
      if (row.values.subjects) {
        for (const token of row.values.subjects.split(/[,;/]/)) {
          const code = token.trim();
          if (code.length === 0) continue;
          const subject = lookups.subjects.get(code.toLowerCase());
          if (!subject) continue;

          /*
           * A student already taking this subject stays where they are.
           *
           * Without this check, re-importing the same file enrols them a second time: the
           * "emptiest section" below is a moving target, so the second run picks a
           * different section of the same subject and the student ends up in two. The
           * (student, section) unique constraint does not catch it, because the two rows
           * are genuinely different sections.
           */
          const alreadyTaking = await prisma.enrolment.findFirst({
            where: {
              studentId,
              droppedAt: null,
              section: { academicYearId: academicYear.id, subjectId: subject.id },
            },
            select: { id: true },
          });
          if (alreadyTaking) continue;

          // Otherwise fill the emptiest section, which keeps class sizes even.
          const section = await prisma.section.findFirst({
            where: {
              academicYearId: academicYear.id,
              yearGroupId,
              subjectId: subject.id,
            },
            orderBy: { enrolments: { _count: 'asc' } },
            select: { id: true },
          });
          if (!section) continue;

          await prisma.enrolment.create({
            data: {
              schoolId: actor.schoolId,
              academicYearId: academicYear.id,
              studentId,
              sectionId: section.id,
            },
          });
        }
      }
    } catch (error) {
      errorReport.push({
        rowNumber: row.rowNumber,
        admissionNumber: row.values.admissionNumber ?? '',
        reasons: [error instanceof Error ? error.message : 'Could not import this row'],
      });
    }
  }

  await writeAuditMany(actor, audits);

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      successCount: created + updated,
      errorCount: errorReport.length,
    },
  });

  return {
    jobId: job.id,
    total: rows.length,
    created,
    updated,
    rejected: errorReport.length,
    errorReport,
  };
}

/** The downloadable error report, as the CSV the office will open in Excel. */
export function errorReportCsv(report: ImportResult['errorReport']): string {
  const rows = [
    ['Row', 'Admission number', 'Why it was rejected'],
    ...report.map((entry) => [
      String(entry.rowNumber),
      entry.admissionNumber,
      entry.reasons.join('; '),
    ]),
  ];

  return rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
}
