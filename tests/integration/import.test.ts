import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenError } from '@/lib/permissions';
import {
  commitStudentImport,
  errorReportCsv,
  previewStudentImport,
} from '@/lib/services/import/students';
import { guessMapping } from '@/lib/services/import/mapping';
import { actorByEmail, asActor, getSchoolId, testPrisma } from '../helpers';
import type { Actor } from '@/lib/permissions';

let schoolId: string;
let admin: Actor;
let teacher: Actor;

/** A file shaped the way a school office actually exports one. */
function buildFile(count: number, startAt = 1): string {
  const header =
    'Adm No,Name of Student,Class,Roll No,Gender,DOB,House,' +
    "Father's Name,Father Mobile,Relation,Subjects";

  const rows = Array.from({ length: count }, (_, index) => {
    const serial = startAt + index;
    const admission = `IMP-${String(serial).padStart(5, '0')}`;
    return [
      admission,
      `Imported Student ${serial}`,
      'AS1',
      `IMP-${String(serial).padStart(4, '0')}`,
      serial % 2 === 0 ? 'F' : 'M',
      `${String((serial % 28) + 1).padStart(2, '0')}/04/2009`,
      'Iqbal',
      `Imported Father ${serial}`,
      `+9231${String(7_000_000 + serial).slice(-7)}`,
      'Father',
      '"9701,9702,9700"',
    ].join(',');
  });

  return `﻿${header}\r\n${rows.join('\r\n')}\r\n`;
}

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');

  const teacherEmail = await asActor(admin, async () => {
    const user = await testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'TEACHER' } } },
      select: { email: true },
    });
    return user.email!;
  });
  teacher = await actorByEmail(schoolId, teacherEmail);
});

afterAll(async () => {
  // Leave the demo tenant as the seed built it.
  await asActor(admin, async () => {
    const imported = await testPrisma.student.findMany({
      where: { admissionNumber: { startsWith: 'IMP-' } },
      select: { userId: true },
    });
    const guardians = await testPrisma.user.findMany({
      where: { OR: [{ name: { startsWith: 'Imported Father' } }, { name: 'Shared Father' }] },
      select: { id: true },
    });
    await testPrisma.user.deleteMany({
      where: { id: { in: [...imported.map((s) => s.userId), ...guardians.map((g) => g.id)] } },
    });
  });
  await testPrisma.$disconnect();
});

describe('import preview', () => {
  it('guesses the mapping and flags problems before anything is written', async () => {
    const file = buildFile(3);
    const preview = await asActor(admin, () => previewStudentImport(admin, file));

    expect(preview.missingRequired).toEqual([]);
    expect(preview.totalRows).toBe(3);
    expect(preview.counts.create).toBe(3);
    expect(preview.counts.reject).toBe(0);
    // The guardian's number must land on the guardian, not on the student.
    expect(preview.mapping.guardianPhone).toBeDefined();
    expect(preview.mapping.phone).toBeUndefined();
  });

  it('shows at most the first twenty rows', async () => {
    const preview = await asActor(admin, () => previewStudentImport(admin, buildFile(40)));
    expect(preview.totalRows).toBe(40);
    expect(preview.sample).toHaveLength(20);
  });

  it('explains every bad row inline rather than failing the file', async () => {
    const file = [
      '﻿Adm No,Name of Student,Class,DOB,Subjects',
      'IMP-90001,Valid Student,AS1,17/04/2009,9701',
      ',Missing Admission,AS1,17/04/2009,9701',
      'IMP-90002,,AS1,17/04/2009,9701',
      'IMP-90003,Bad Year Group,Year 47,17/04/2009,9701',
      'IMP-90004,Bad Date,AS1,04/17/2009,9701',
      'IMP-90005,Bad Subject,AS1,17/04/2009,9999',
      'IMP-90001,Duplicate In File,AS1,17/04/2009,9701',
    ].join('\r\n');

    const preview = await asActor(admin, () => previewStudentImport(admin, file));
    const issues = Object.fromEntries(
      preview.sample.map((row) => [row.rowNumber, row.issues.map((issue) => issue.field)]),
    );

    expect(issues[2]).toEqual([]);
    expect(issues[3]).toContain('admissionNumber');
    expect(issues[4]).toContain('name');
    expect(issues[5]).toContain('yearGroup');
    expect(issues[6]).toContain('dateOfBirth');
    expect(issues[7]).toContain('subjects');
    // The same admission number twice in one file is a copy-paste merge, and common.
    expect(issues[8]).toContain('admissionNumber');
    expect(preview.counts.reject).toBe(6);
  });

  it('refuses a teacher', async () => {
    await expect(
      asActor(teacher, () => previewStudentImport(teacher, buildFile(1))),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('import commit', () => {
  it('takes 500 students, their guardians and their subjects, well inside ten minutes', async () => {
    const file = buildFile(500);
    const startedAt = Date.now();

    const preview = await asActor(admin, () => previewStudentImport(admin, file));
    const result = await asActor(admin, () =>
      commitStudentImport(admin, file, preview.mapping, { fileName: 'lgs-students.csv' }),
    );

    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    expect(result.created).toBe(500);
    expect(result.rejected).toBe(0);
    // The acceptance criterion is ten minutes for a real office; this is the machine part.
    expect(elapsedSeconds).toBeLessThan(120);

    const [students, guardianLinks, enrolments] = await asActor(admin, async () => [
      await testPrisma.student.count({ where: { admissionNumber: { startsWith: 'IMP-' } } }),
      await testPrisma.guardianStudent.count({
        where: { student: { admissionNumber: { startsWith: 'IMP-' } } },
      }),
      await testPrisma.enrolment.count({
        where: { student: { admissionNumber: { startsWith: 'IMP-' } } },
      }),
    ]);

    expect(students).toBe(500);
    expect(guardianLinks).toBe(500);
    // Three subjects each.
    expect(enrolments).toBe(1500);
  }, 180_000);

  it('forces imported accounts to change their password at first login', async () => {
    const user = await asActor(admin, () =>
      testPrisma.user.findFirstOrThrow({
        where: { student: { admissionNumber: { startsWith: 'IMP-' } } },
        select: { mustChangePassword: true },
      }),
    );
    expect(user.mustChangePassword).toBe(true);
  });

  it('does not create duplicates when the same file is imported twice', async () => {
    // The single most common way a school's data gets ruined.
    const file = buildFile(500);
    const preview = await asActor(admin, () => previewStudentImport(admin, file));

    expect(preview.counts.create).toBe(0);
    expect(preview.counts.update).toBe(500);

    const result = await asActor(admin, () => commitStudentImport(admin, file, preview.mapping));
    expect(result.created).toBe(0);
    expect(result.updated).toBe(500);

    const [students, enrolments] = await asActor(admin, async () => [
      await testPrisma.student.count({ where: { admissionNumber: { startsWith: 'IMP-' } } }),
      await testPrisma.enrolment.count({
        where: { student: { admissionNumber: { startsWith: 'IMP-' } } },
      }),
    ]);
    expect(students).toBe(500);
    expect(enrolments).toBe(1500);
  }, 180_000);

  it('links a sibling to the guardian account that already exists', async () => {
    const file = [
      '﻿Adm No,Name of Student,Class,Father\'s Name,Father Mobile',
      'IMP-70001,Sibling One,AS1,Shared Father,+923177000001',
      'IMP-70002,Sibling Two,AS1,Shared Father,+923177000001',
    ].join('\r\n');

    const preview = await asActor(admin, () => previewStudentImport(admin, file));
    await asActor(admin, () => commitStudentImport(admin, file, preview.mapping));

    const guardian = await asActor(admin, () =>
      testPrisma.guardian.findFirstOrThrow({
        where: { user: { phone: '+923177000001' } },
        select: { _count: { select: { students: true } } },
      }),
    );
    // One parent account, two children — which is what the child switcher is for.
    expect(guardian._count.students).toBe(2);
  });

  it('records the job and refuses to run with a required column unmapped', async () => {
    const jobs = await asActor(admin, () =>
      testPrisma.importJob.count({ where: { type: 'STUDENTS', status: 'COMPLETED' } }),
    );
    expect(jobs).toBeGreaterThan(0);

    await expect(
      asActor(admin, () => commitStudentImport(admin, buildFile(1), { name: 1 })),
    ).rejects.toMatchObject({ code: 'mappingIncomplete' });
  });
});

describe('the error report', () => {
  it('produces a CSV the office can open and act on', () => {
    const csv = errorReportCsv([
      { rowNumber: 14, admissionNumber: 'ADM-001', reasons: ['yearGroup: Unknown year group "Year 47"'] },
      { rowNumber: 15, admissionNumber: '', reasons: ['admissionNumber: Admission number is required'] },
    ]);

    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"Row","Admission number","Why it was rejected"');
    expect(lines[1]).toContain('"14"');
    expect(lines[1]).toContain('Year 47');
    // The quotes inside the reason must be escaped, or Excel breaks the row apart.
    expect(lines[1]).toContain('""Year 47""');
  });
});

describe('mapping guesses survive a messy header row', () => {
  it('handles the spellings and stray spacing of a real export', () => {
    const mapping = guessMapping([
      '  ADMISSION NO.  ',
      'Student Name',
      'Grade',
      'Mobile',
      "Father's Name",
      'Father Mobile',
    ]);
    expect(mapping.admissionNumber).toBe(0);
    expect(mapping.name).toBe(1);
    expect(mapping.yearGroup).toBe(2);
    expect(mapping.phone).toBe(3);
    expect(mapping.guardianName).toBe(4);
    expect(mapping.guardianPhone).toBe(5);
  });
});
