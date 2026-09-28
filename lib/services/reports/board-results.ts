import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';

/**
 * Entering the board's own results.
 *
 * They arrive months after the school's last mark, as a list from CAIE or Pearson, and the
 * only thing anybody wants to do with them is compare them to what the school predicted. So
 * entry is a paste box: roll number, subject code, grade — the shape of the file the board
 * sends — and every row that does not match a student or a subject is reported rather than
 * dropped, because a silently skipped row is a student who looks unpredicted for ever.
 */

export const boardResultsSchema = z.object({
  /** As the board names it: "June 2026". */
  session: z.string().min(4).max(40),
  /** `rollNumber,subjectCode,grade` per line. Tabs or commas, header row optional. */
  text: z.string().min(3).max(200_000),
});

export type BoardResultImport = {
  session: string;
  recorded: number;
  updated: number;
  problems: { line: number; text: string; reason: string }[];
};

export async function recordBoardResults(
  actor: Actor,
  raw: z.infer<typeof boardResultsSchema>,
): Promise<BoardResultImport> {
  requireCapability(actor, 'exam.manage');
  const input = boardResultsSchema.parse(raw);

  const lines = input.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const [students, subjects, scale] = await Promise.all([
    prisma.student.findMany({
      where: { deletedAt: null },
      select: { id: true, rollNumber: true },
    }),
    prisma.subject.findMany({ select: { id: true, code: true, name: true } }),
    prisma.gradingScale.findFirst({ where: { isDefault: true }, select: { bandsJson: true } }),
  ]);

  const byRoll = new Map(students.map((student) => [student.rollNumber.toUpperCase(), student.id]));
  const byCode = new Map(subjects.map((subject) => [subject.code.toUpperCase(), subject.id]));
  const byName = new Map(subjects.map((subject) => [subject.name.toUpperCase(), subject.id]));
  const validGrades = new Set(
    ((scale?.bandsJson ?? []) as { grade: string }[]).map((band) => band.grade.toUpperCase()),
  );

  const problems: BoardResultImport['problems'] = [];
  const rows: { studentId: string; subjectId: string; grade: string }[] = [];

  lines.forEach((line, index) => {
    const parts = line.split(/[\t,;]/).map((part) => part.trim());
    if (parts.length < 3) {
      // A header row is the usual first line; only complain about it if it is not one.
      if (index === 0 && /roll/i.test(line)) return;
      problems.push({
        line: index + 1,
        text: line,
        reason: 'Expected roll number, subject, grade',
      });
      return;
    }

    const [roll, subject, grade] = parts as [string, string, string];
    if (index === 0 && /roll/i.test(roll)) return;

    const studentId = byRoll.get(roll.toUpperCase());
    if (!studentId) {
      problems.push({ line: index + 1, text: line, reason: `No student with roll number ${roll}` });
      return;
    }

    const subjectId = byCode.get(subject.toUpperCase()) ?? byName.get(subject.toUpperCase());
    if (!subjectId) {
      problems.push({ line: index + 1, text: line, reason: `No subject matching ${subject}` });
      return;
    }

    const cleanGrade = grade.toUpperCase();
    if (validGrades.size > 0 && !validGrades.has(cleanGrade)) {
      problems.push({
        line: index + 1,
        text: line,
        reason: `${grade} is not a grade on this school's scale`,
      });
      return;
    }

    rows.push({ studentId, subjectId, grade: cleanGrade });
  });

  let recorded = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.boardResult.findFirst({
      where: { studentId: row.studentId, subjectId: row.subjectId, session: input.session },
      select: { id: true, grade: true },
    });

    if (existing) {
      if (existing.grade === row.grade) continue;
      await prisma.boardResult.update({
        where: { id: existing.id },
        data: { grade: row.grade, enteredById: actor.userId },
      });
      // A corrected grade is audited: a board grade changing is exactly the thing a family
      // will ask about later.
      await writeAudit(actor, {
        action: 'boardresult.update',
        entityType: 'Mark',
        entityId: `board:${existing.id}`,
        before: { grade: existing.grade },
        after: { grade: row.grade, session: input.session },
      });
      updated += 1;
      continue;
    }

    await prisma.boardResult.create({
      data: {
        schoolId: actor.schoolId,
        studentId: row.studentId,
        subjectId: row.subjectId,
        session: input.session,
        grade: row.grade,
        enteredById: actor.userId,
      },
    });
    recorded += 1;
  }

  if (recorded + updated === 0 && problems.length > 0) {
    throw ApiError.badRequest('noRowsRecorded', 'None of those lines could be read.', {
      text: problems.slice(0, 5).map((problem) => `Line ${problem.line}: ${problem.reason}`),
    });
  }

  await writeAudit(actor, {
    action: 'boardresult.import',
    entityType: 'Mark',
    entityId: `board-session:${input.session}`,
    after: { session: input.session, recorded, updated, rejected: problems.length },
  });

  return { session: input.session, recorded, updated, problems: problems.slice(0, 50) };
}

export async function listBoardSessions(
  actor: Actor,
): Promise<{ session: string; results: number }[]> {
  requireCapability(actor, 'report.school');
  const rows = await prisma.boardResult.groupBy({
    by: ['session'],
    _count: { _all: true },
    orderBy: { session: 'desc' },
  });
  return rows.map((row) => ({ session: row.session, results: row._count._all }));
}
