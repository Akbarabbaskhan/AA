import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { writeAuditMany } from '@/lib/services/audit';
import {
  assertCanAccessSection,
  canAccessDepartment,
  can,
  canReadSectionMarks,
  hasRole,
  requireCapability,
  ForbiddenError,
  type Actor,
} from '@/lib/permissions';
import { gradeFor, type GradeBand } from '@/lib/services/grading/bands';
import { classStatistics, outliers, type ClassStatistics } from '@/lib/services/grading/statistics';
import { resolveGradingScale } from './series';

/**
 * Marks entry.
 *
 * "The teacher screen is a spreadsheet-style grid: students down, one assessment across,
 * keyboard navigation with Enter and arrow keys, no mouse needed."
 *
 * The service side of that is small and strict: validate, save, recompute the class
 * statistics so the grid can flag outliers live, and audit any change to a mark.
 */

export const markEntrySchema = z
  .object({
    studentId: z.string().uuid(),
    marksObtained: z.number().int().min(0).nullable(),
    isAbsent: z.boolean().default(false),
  })
  .refine((entry) => entry.isAbsent || entry.marksObtained !== null, {
    message: 'Enter a mark, or mark the student absent',
  });

export const saveMarksSchema = z.object({
  entries: z.array(markEntrySchema).min(1).max(500),
});

export type MarkRow = {
  studentId: string;
  name: string;
  rollNumber: string;
  marksObtained: number | null;
  isAbsent: boolean;
  percent: number | null;
  grade: string | null;
  /** The pre-moderation mark, retained and shown to whoever can see it. */
  originalMarks: number | null;
  moderatedByName: string | null;
  enteredByName: string | null;
  /** More than three standard deviations from the class mean. A warning, never a block. */
  isOutlier: boolean;
};

export type MarksGrid = {
  assessment: {
    id: string;
    title: string;
    date: string;
    totalMarks: number;
    weightPercent: number;
    sectionId: string;
    sectionName: string;
    subjectName: string;
    subjectCode: string;
    componentCode: string | null;
    examSeriesId: string;
    examSeriesName: string;
    isPublished: boolean;
  };
  gradingScale: { id: string; name: string; bands: GradeBand[] };
  rows: MarkRow[];
  statistics: ClassStatistics;
  canEnter: boolean;
  canModerate: boolean;
};

async function loadAssessment(assessmentId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      date: true,
      totalMarks: true,
      weightPercent: true,
      academicYearId: true,
      sectionId: true,
      subjectComponent: { select: { code: true } },
      examSeries: { select: { id: true, name: true, isPublished: true } },
      section: {
        select: {
          id: true,
          name: true,
          teacherId: true,
          subject: { select: { name: true, code: true, departmentId: true } },
          enrolments: {
            where: { droppedAt: null },
            select: {
              student: {
                select: { id: true, rollNumber: true, user: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!assessment) throw ApiError.notFound('Assessment not found');
  return assessment;
}

export async function getMarksGrid(actor: Actor, assessmentId: string): Promise<MarksGrid> {
  // A student enrolled in this section must not reach it: `assertCanAccessSection` below
  // would let them through, because being enrolled is access to the section.
  if (!canReadSectionMarks(actor)) throw ApiError.notFound('Assessment not found');

  const assessment = await loadAssessment(assessmentId);
  const departmentId = assessment.section.subject.departmentId;

  // A teacher reaches their own sections; an HOD their department; an admin everything.
  const isDepartmentHead = departmentId !== null && canAccessDepartment(actor, departmentId);
  if (!hasRole(actor, 'ADMIN') && !isDepartmentHead) {
    assertCanAccessSection(actor, assessment.sectionId);
  }

  const [marks, scale] = await Promise.all([
    prisma.mark.findMany({
      where: { assessmentId },
      select: {
        studentId: true,
        marksObtained: true,
        isAbsent: true,
        originalMarks: true,
        moderatedBy: { select: { user: { select: { name: true } } } },
        enteredBy: { select: { user: { select: { name: true } } } },
      },
    }),
    resolveGradingScale(assessmentId),
  ]);

  const byStudent = new Map(marks.map((mark) => [mark.studentId, mark]));
  const samples = assessment.section.enrolments.map(({ student }) => {
    const mark = byStudent.get(student.id);
    return {
      studentId: student.id,
      marksObtained: mark?.marksObtained ?? null,
      isAbsent: mark?.isAbsent ?? false,
    };
  });

  const statistics = classStatistics(samples);
  const outlierIds = new Set(outliers(samples).map((entry) => entry.studentId));

  const rows: MarkRow[] = assessment.section.enrolments
    .map(({ student }) => {
      const mark = byStudent.get(student.id);
      const percent =
        mark && !mark.isAbsent && mark.marksObtained !== null && assessment.totalMarks > 0
          ? (mark.marksObtained / assessment.totalMarks) * 100
          : null;

      return {
        studentId: student.id,
        name: student.user.name,
        rollNumber: student.rollNumber,
        marksObtained: mark?.marksObtained ?? null,
        isAbsent: mark?.isAbsent ?? false,
        percent,
        grade: percent === null ? null : gradeFor(percent, scale.bands),
        originalMarks: mark?.originalMarks ?? null,
        moderatedByName: mark?.moderatedBy?.user.name ?? null,
        enteredByName: mark?.enteredBy?.user.name ?? null,
        isOutlier: outlierIds.has(student.id),
      };
    })
    // Roll-number order, which is also the order an Excel column pastes in.
    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));

  return {
    assessment: {
      id: assessment.id,
      title: assessment.title,
      date: assessment.date.toISOString().slice(0, 10),
      totalMarks: assessment.totalMarks,
      weightPercent: assessment.weightPercent,
      sectionId: assessment.sectionId,
      sectionName: assessment.section.name,
      subjectName: assessment.section.subject.name,
      subjectCode: assessment.section.subject.code,
      componentCode: assessment.subjectComponent?.code ?? null,
      examSeriesId: assessment.examSeries.id,
      examSeriesName: assessment.examSeries.name,
      isPublished: assessment.examSeries.isPublished,
    },
    gradingScale: scale,
    rows,
    statistics,
    canEnter:
      can(actor, 'marks.enter') &&
      !assessment.examSeries.isPublished &&
      (hasRole(actor, 'ADMIN') ||
        isDepartmentHead ||
        actor.sectionIds.includes(assessment.sectionId)),
    canModerate: can(actor, 'marks.moderate') && (hasRole(actor, 'ADMIN') || isDepartmentHead),
  };
}

export type SaveMarksResult = {
  saved: number;
  results: { studentId: string; applied: boolean; reason?: string }[];
  statistics: ClassStatistics;
  outliers: { studentId: string; marksObtained: number; deviationsFromMean: number }[];
};

/**
 * Saves marks.
 *
 * Called on every keystroke's blur by the grid — "autosave every entry; never lose a
 * teacher's work to a dropped connection" — so it has to be cheap and idempotent.
 */
export async function saveMarks(
  actor: Actor,
  assessmentId: string,
  input: z.infer<typeof saveMarksSchema>,
): Promise<SaveMarksResult> {
  requireCapability(actor, 'marks.enter');

  const assessment = await loadAssessment(assessmentId);

  // "Marks stay unpublished and invisible to students and parents until the HOD or Admin
  // publishes the whole series at once" — and once published they are a fixed record.
  if (assessment.examSeries.isPublished) {
    throw ApiError.conflict(
      'seriesPublished',
      'This series is published. Marks can no longer be changed.',
    );
  }

  const departmentId = assessment.section.subject.departmentId;
  const isDepartmentHead = departmentId !== null && canAccessDepartment(actor, departmentId);
  if (!hasRole(actor, 'ADMIN') && !isDepartmentHead && !actor.sectionIds.includes(assessment.sectionId)) {
    throw new ForbiddenError('You do not teach this section');
  }

  const enrolled = new Set(assessment.section.enrolments.map(({ student }) => student.id));
  const existing = await prisma.mark.findMany({
    where: { assessmentId },
    select: { studentId: true, marksObtained: true, isAbsent: true },
  });
  const byStudent = new Map(existing.map((mark) => [mark.studentId, mark]));

  const results: SaveMarksResult['results'] = [];
  const audits: Parameters<typeof writeAuditMany>[1][number][] = [];

  for (const entry of input.entries) {
    if (!enrolled.has(entry.studentId)) {
      results.push({ studentId: entry.studentId, applied: false, reason: 'notEnrolled' });
      continue;
    }

    // "Validation: no mark above total, no negatives."
    if (!entry.isAbsent && entry.marksObtained !== null) {
      if (entry.marksObtained > assessment.totalMarks) {
        results.push({ studentId: entry.studentId, applied: false, reason: 'aboveTotal' });
        continue;
      }
      if (entry.marksObtained < 0) {
        results.push({ studentId: entry.studentId, applied: false, reason: 'negative' });
        continue;
      }
    }

    const previous = byStudent.get(entry.studentId);
    // An absence is an absence, not a zero: storing 0 here would drag the class average.
    const marksObtained = entry.isAbsent ? null : entry.marksObtained;

    await prisma.mark.upsert({
      where: { studentId_assessmentId: { studentId: entry.studentId, assessmentId } },
      create: {
        schoolId: actor.schoolId,
        academicYearId: assessment.academicYearId,
        assessmentId,
        studentId: entry.studentId,
        marksObtained,
        isAbsent: entry.isAbsent,
        enteredById: actor.staffId ?? null,
        enteredAt: new Date(),
      },
      update: {
        marksObtained,
        isAbsent: entry.isAbsent,
        enteredById: actor.staffId ?? null,
        enteredAt: new Date(),
      },
    });

    results.push({ studentId: entry.studentId, applied: true });

    const changed =
      !previous ||
      previous.marksObtained !== marksObtained ||
      previous.isAbsent !== entry.isAbsent;

    // Autosave fires constantly; only a real change is worth an audit row.
    if (changed) {
      audits.push({
        action: previous ? 'marks.update' : 'marks.enter',
        entityType: 'Mark',
        entityId: `${assessmentId}:${entry.studentId}`,
        before: previous
          ? { marksObtained: previous.marksObtained, isAbsent: previous.isAbsent }
          : undefined,
        after: { marksObtained, isAbsent: entry.isAbsent },
      });
    }
  }

  await writeAuditMany(actor, audits);

  const fresh = await prisma.mark.findMany({
    where: { assessmentId },
    select: { studentId: true, marksObtained: true, isAbsent: true },
  });
  const samples = [...enrolled].map((studentId) => {
    const mark = fresh.find((entry) => entry.studentId === studentId);
    return {
      studentId,
      marksObtained: mark?.marksObtained ?? null,
      isAbsent: mark?.isAbsent ?? false,
    };
  });

  return {
    saved: results.filter((entry) => entry.applied).length,
    results,
    statistics: classStatistics(samples),
    outliers: outliers(samples),
  };
}

export type ModerationResult = {
  moderated: number;
  /** Per-row, so a moderator can see which adjustments did not take and why. */
  results: { studentId: string; applied: boolean; reason?: string }[];
};

export const moderationSchema = z.object({
  adjustments: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        marksObtained: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(500),
  reason: z.string().min(3).max(500),
});

/**
 * HOD moderation.
 *
 * "A moderation step: HOD can review and adjust before publication, with the original mark
 * retained and visible in the audit log."
 *
 * The original is kept on the row itself as well as in the audit, so a result card can show
 * that a mark was moderated without a query across the audit table.
 */
export async function moderateMarks(
  actor: Actor,
  assessmentId: string,
  input: z.infer<typeof moderationSchema>,
): Promise<ModerationResult> {
  requireCapability(actor, 'marks.moderate');

  const assessment = await loadAssessment(assessmentId);
  if (assessment.examSeries.isPublished) {
    throw ApiError.conflict('seriesPublished', 'This series is published and cannot be moderated.');
  }

  const departmentId = assessment.section.subject.departmentId;
  if (!hasRole(actor, 'ADMIN') && !(departmentId && canAccessDepartment(actor, departmentId))) {
    throw new ForbiddenError('That subject is outside your department');
  }

  const audits: Parameters<typeof writeAuditMany>[1][number][] = [];
  const results: ModerationResult['results'] = [];
  let moderated = 0;

  for (const adjustment of input.adjustments) {
    if (adjustment.marksObtained > assessment.totalMarks) {
      results.push({ studentId: adjustment.studentId, applied: false, reason: 'aboveTotal' });
      continue;
    }

    const existing = await prisma.mark.findFirst({
      where: { assessmentId, studentId: adjustment.studentId },
      select: { id: true, marksObtained: true, originalMarks: true, isAbsent: true },
    });
    if (!existing) {
      results.push({ studentId: adjustment.studentId, applied: false, reason: 'noMark' });
      continue;
    }
    if (existing.isAbsent) {
      // Moderating an absence would turn it into a mark the student never earned.
      results.push({ studentId: adjustment.studentId, applied: false, reason: 'absent' });
      continue;
    }
    if (existing.marksObtained === adjustment.marksObtained) {
      results.push({ studentId: adjustment.studentId, applied: false, reason: 'unchanged' });
      continue;
    }

    await prisma.mark.update({
      where: { id: existing.id },
      data: {
        marksObtained: adjustment.marksObtained,
        // Only the first moderation captures the original — a second pass must not
        // overwrite the teacher's mark with the first moderator's.
        originalMarks: existing.originalMarks ?? existing.marksObtained,
        moderatedById: actor.staffId ?? null,
        moderatedAt: new Date(),
      },
    });

    moderated += 1;
    results.push({ studentId: adjustment.studentId, applied: true });
    audits.push({
      action: 'marks.moderate',
      entityType: 'Mark',
      entityId: `${assessmentId}:${adjustment.studentId}`,
      before: { marksObtained: existing.marksObtained },
      after: { marksObtained: adjustment.marksObtained },
      reason: input.reason,
    });
  }

  await writeAuditMany(actor, audits);
  return { moderated, results };
}

/**
 * Maps a column pasted from Excel onto students in roll-number order.
 *
 * "Paste a column straight from Excel and have it map to students in roll-number order."
 * The parser lives in ./paste so the client-side grid can use it without importing this
 * module, which reaches the database.
 */
export { parsePastedColumn, type PastedValue } from './paste';
