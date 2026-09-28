import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import {
  assertCanAccessSection,
  can,
  hasRole,
  requireCapability,
  type Actor,
} from '@/lib/permissions';
import { gradeFor, parseBands } from '@/lib/services/grading/bands';
import { writeAudit } from '@/lib/services/audit';

/**
 * Predicted grades.
 *
 * The grade a school puts on a UCAS form or a university application, which is a teacher's
 * judgement rather than an average — so the teacher's prediction is what is stored, and the
 * system's own suggestion sits beside it as a starting point rather than replacing it. The two
 * are different `method`s on the same record so the board-results analysis can ask the honest
 * question later: was the teacher's judgement better than the arithmetic?
 *
 * The capability has existed since M0 and nothing implemented it. This is that gap closed.
 */

export const predictionQuerySchema = z.object({
  sectionId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
});

export type PredictionRow = {
  studentId: string;
  studentName: string;
  rollNumber: string;
  subjectId: string;
  subjectName: string;
  /** The mean across published series, which is what the suggestion is built from. */
  currentPercent: number | null;
  suggestedGrade: string | null;
  teacherGrade: string | null;
  confidence: number | null;
  setByName: string | null;
  updatedAt: string | null;
};

async function defaultBands() {
  const scale = await prisma.gradingScale.findFirst({
    where: { isDefault: true },
    select: { bandsJson: true },
  });
  return parseBands(scale?.bandsJson ?? []);
}

/**
 * One section's predictions, with the arithmetic beside each one.
 *
 * A teacher predicting twenty-eight grades wants the evidence on the same row: their own mark
 * history for that student, and the grade it maps to. Asking them to open another screen per
 * student is how the whole exercise ends up done from memory in one sitting.
 */
export async function listPredictions(
  actor: Actor,
  query: z.infer<typeof predictionQuerySchema>,
): Promise<PredictionRow[]> {
  requireCapability(actor, 'marks.read.section');
  if (!query.sectionId && !query.studentId) {
    throw ApiError.badRequest('noTarget', 'Name a section or a student.');
  }
  if (query.sectionId) assertCanAccessSection(actor, query.sectionId);

  const section = query.sectionId
    ? await prisma.section.findFirst({
        where: { id: query.sectionId },
        select: {
          id: true,
          subjectId: true,
          subject: { select: { name: true } },
          enrolments: {
            where: { droppedAt: null },
            select: {
              student: {
                select: { id: true, rollNumber: true, user: { select: { name: true } } },
              },
            },
          },
        },
      })
    : null;

  if (query.sectionId && !section) throw ApiError.notFound('Section not found');

  const studentIds = section
    ? section.enrolments.map((entry) => entry.student.id)
    : [query.studentId!];
  const subjectId = section?.subjectId;

  const [marks, predictions, bands] = await Promise.all([
    prisma.mark.findMany({
      where: {
        studentId: { in: studentIds },
        isAbsent: false,
        marksObtained: { not: null },
        assessment: {
          examSeries: { isPublished: true },
          ...(subjectId ? { section: { subjectId } } : {}),
        },
      },
      select: {
        studentId: true,
        marksObtained: true,
        assessment: { select: { totalMarks: true, section: { select: { subjectId: true } } } },
      },
    }),
    prisma.predictedGrade.findMany({
      where: {
        studentId: { in: studentIds },
        ...(subjectId ? { subjectId } : {}),
      },
      select: {
        studentId: true,
        subjectId: true,
        grade: true,
        method: true,
        confidence: true,
        updatedAt: true,
        setBy: { select: { user: { select: { name: true } } } },
      },
    }),
    defaultBands(),
  ]);

  const meanByStudent = new Map<string, { total: number; count: number }>();
  for (const mark of marks) {
    const key = `${mark.studentId}:${mark.assessment.section.subjectId}`;
    const entry = meanByStudent.get(key) ?? { total: 0, count: 0 };
    entry.total += ((mark.marksObtained ?? 0) / mark.assessment.totalMarks) * 100;
    entry.count += 1;
    meanByStudent.set(key, entry);
  }

  const teacherByStudent = new Map(
    predictions
      .filter((row) => row.method === 'TEACHER')
      .map((row) => [`${row.studentId}:${row.subjectId}`, row]),
  );

  const students = section
    ? section.enrolments.map((entry) => entry.student)
    : await prisma.student.findMany({
        where: { id: { in: studentIds } },
        select: { id: true, rollNumber: true, user: { select: { name: true } } },
      });

  const subjectName = section?.subject.name ?? '';

  return students
    .map((student) => {
      const key = `${student.id}:${subjectId ?? ''}`;
      const mean = meanByStudent.get(key);
      const percent = mean && mean.count > 0 ? mean.total / mean.count : null;
      const teacher = teacherByStudent.get(key);

      return {
        studentId: student.id,
        studentName: student.user.name,
        rollNumber: student.rollNumber,
        subjectId: subjectId ?? '',
        subjectName,
        currentPercent: percent === null ? null : Number(percent.toFixed(1)),
        suggestedGrade: percent === null ? null : gradeFor(percent, bands),
        teacherGrade: teacher?.grade ?? null,
        confidence: teacher?.confidence ?? null,
        setByName: teacher?.setBy?.user.name ?? null,
        updatedAt: teacher?.updatedAt.toISOString() ?? null,
      };
    })
    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));
}

export const predictionInputSchema = z.object({
  sectionId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        grade: z.string().min(1).max(4),
        /** 1–5, how sure the teacher is. Printed nowhere; used to sort a review list. */
        confidence: z.number().int().min(1).max(5).nullable().default(null),
      }),
    )
    .min(1)
    .max(200),
});

export async function setPredictedGrades(
  actor: Actor,
  raw: z.input<typeof predictionInputSchema>,
): Promise<{ saved: number }> {
  requireCapability(actor, 'predictedgrade.set');
  const input = predictionInputSchema.parse(raw);

  const section = await prisma.section.findFirst({
    where: { id: input.sectionId },
    select: {
      id: true,
      subjectId: true,
      academicYearId: true,
      teacherId: true,
      enrolments: { where: { droppedAt: null }, select: { studentId: true } },
    },
  });
  if (!section) throw ApiError.notFound('Section not found');

  // A teacher predicts for their own sections; a coordinator for any.
  if (
    !hasRole(actor, 'ADMIN') &&
    !can(actor, 'marks.moderate') &&
    section.teacherId !== actor.staffId
  ) {
    throw ApiError.notFound('Section not found');
  }

  const enrolled = new Set(section.enrolments.map((entry) => entry.studentId));
  const bands = await defaultBands();
  const validGrades = new Set(bands.map((band) => band.grade));

  let saved = 0;

  for (const entry of input.entries) {
    if (!enrolled.has(entry.studentId)) continue;
    if (validGrades.size > 0 && !validGrades.has(entry.grade)) {
      throw ApiError.badRequest('unknownGrade', `${entry.grade} is not a grade on this scale.`, {
        grade: [`Use one of ${[...validGrades].join(', ')}`],
      });
    }

    const previous = await prisma.predictedGrade.findFirst({
      where: {
        studentId: entry.studentId,
        subjectId: section.subjectId,
        academicYearId: section.academicYearId,
        method: 'TEACHER',
      },
      select: { id: true, grade: true },
    });

    if (previous) {
      if (previous.grade === entry.grade) continue;
      await prisma.predictedGrade.update({
        where: { id: previous.id },
        data: { grade: entry.grade, confidence: entry.confidence, setById: actor.staffId },
      });
    } else {
      await prisma.predictedGrade.create({
        data: {
          schoolId: actor.schoolId,
          academicYearId: section.academicYearId,
          studentId: entry.studentId,
          subjectId: section.subjectId,
          grade: entry.grade,
          method: 'TEACHER',
          confidence: entry.confidence,
          setById: actor.staffId,
        },
      });
    }

    /*
     * Audited, and worth it: a predicted grade is the number a university offer hangs on, and
     * "who changed my son's prediction from an A to a B, and when?" is the same question as the
     * one the audit log exists to answer about marks.
     */
    await writeAudit(actor, {
      action: previous ? 'predictedgrade.update' : 'predictedgrade.set',
      entityType: 'Mark',
      entityId: `predicted:${entry.studentId}:${section.subjectId}`,
      ...(previous ? { before: { grade: previous.grade } } : {}),
      after: { grade: entry.grade, confidence: entry.confidence },
    });

    saved += 1;
  }

  return { saved };
}
