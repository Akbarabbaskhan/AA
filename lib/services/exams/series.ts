import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { writeAudit } from '@/lib/services/audit';
import {
  canAccessDepartment,
  canReadSectionMarks,
  hasRole,
  requireCapability,
  type Actor,
} from '@/lib/permissions';
import { toDateOnly } from '@/lib/utils/tz';
import { parseBands } from '@/lib/services/grading/bands';

/**
 * Exam setup.
 *
 * "An Admin or HOD creates an ExamSeries ('October Mocks 2026'), then adds Assessment rows
 * under it — one per subject component per section."
 */

export const examSeriesSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(['TEST', 'MONTHLY', 'MID_TERM', 'MOCK', 'FINAL']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function currentAcademicYearId(): Promise<string> {
  const year = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (!year) throw ApiError.badRequest('noAcademicYear', 'No academic year is set as current.');
  return year.id;
}

export async function createExamSeries(actor: Actor, input: z.infer<typeof examSeriesSchema>) {
  requireCapability(actor, 'exam.manage');

  if (input.endDate < input.startDate) {
    throw ApiError.badRequest('invalidDates', 'The series ends before it starts.');
  }

  const academicYearId = await currentAcademicYearId();

  const series = await prisma.examSeries.create({
    data: {
      schoolId: actor.schoolId,
      academicYearId,
      name: input.name,
      type: input.type,
      startDate: toDateOnly(input.startDate),
      endDate: toDateOnly(input.endDate),
    },
  });

  await writeAudit(actor, {
    action: 'exam.series.create',
    entityType: 'Mark',
    entityId: series.id,
    after: { name: series.name, type: series.type },
  });

  return series;
}

export type ExamSeriesSummary = {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  isPublished: boolean;
  publishedAt: string | null;
  assessmentCount: number;
  /** How much of the series has marks in, which is what an HOD wants to see before publishing. */
  marksEntered: number;
  marksExpected: number;
};

export async function listExamSeries(actor: Actor): Promise<ExamSeriesSummary[]> {
  if (!canReadSectionMarks(actor)) throw ApiError.notFound('Exam series not available');
  const academicYearId = await currentAcademicYearId();

  const series = await prisma.examSeries.findMany({
    where: { academicYearId },
    orderBy: { startDate: 'desc' },
    select: {
      id: true,
      name: true,
      type: true,
      startDate: true,
      endDate: true,
      isPublished: true,
      publishedAt: true,
      assessments: {
        select: {
          id: true,
          _count: { select: { marks: true } },
          section: { select: { _count: { select: { enrolments: { where: { droppedAt: null } } } } } },
        },
      },
    },
  });

  return series.map((entry) => ({
    id: entry.id,
    name: entry.name,
    type: entry.type,
    startDate: entry.startDate.toISOString().slice(0, 10),
    endDate: entry.endDate.toISOString().slice(0, 10),
    isPublished: entry.isPublished,
    publishedAt: entry.publishedAt?.toISOString() ?? null,
    assessmentCount: entry.assessments.length,
    marksEntered: entry.assessments.reduce((sum, a) => sum + a._count.marks, 0),
    marksExpected: entry.assessments.reduce((sum, a) => sum + a.section._count.enrolments, 0),
  }));
}

export const assessmentSchema = z.object({
  examSeriesId: z.string().uuid(),
  sectionId: z.string().uuid(),
  subjectComponentId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalMarks: z.number().int().min(1).max(1000),
  weightPercent: z.number().int().min(0).max(100),
  gradingScaleId: z.string().uuid().nullable().optional(),
});

export async function createAssessment(actor: Actor, input: z.infer<typeof assessmentSchema>) {
  requireCapability(actor, 'exam.manage');

  const [series, section] = await Promise.all([
    prisma.examSeries.findFirst({
      where: { id: input.examSeriesId },
      select: { id: true, academicYearId: true, isPublished: true },
    }),
    prisma.section.findFirst({
      where: { id: input.sectionId },
      select: { id: true, subject: { select: { id: true, departmentId: true } } },
    }),
  ]);

  if (!series) throw ApiError.notFound('Exam series not found');
  if (!section) throw ApiError.notFound('Section not found');

  // A published series is a historical record. Adding a paper to it would change result
  // cards that have already gone home.
  if (series.isPublished) {
    throw ApiError.conflict('seriesPublished', 'That series is published and cannot be changed.');
  }

  // An HOD sets up their own department's papers, not the whole school's.
  if (!hasRole(actor, 'ADMIN') && section.subject.departmentId) {
    if (!canAccessDepartment(actor, section.subject.departmentId)) {
      throw ApiError.notFound('Section not found');
    }
  }

  if (input.subjectComponentId) {
    const component = await prisma.subjectComponent.findFirst({
      where: { id: input.subjectComponentId, subjectId: section.subject.id },
      select: { id: true },
    });
    if (!component) {
      throw ApiError.badRequest(
        'componentMismatch',
        'That component belongs to a different subject.',
      );
    }
  }

  const assessment = await prisma.assessment.create({
    data: {
      schoolId: actor.schoolId,
      academicYearId: series.academicYearId,
      examSeriesId: input.examSeriesId,
      sectionId: input.sectionId,
      subjectComponentId: input.subjectComponentId ?? null,
      title: input.title,
      date: toDateOnly(input.date),
      totalMarks: input.totalMarks,
      weightPercent: input.weightPercent,
      gradingScaleId: input.gradingScaleId ?? null,
    },
  });

  await writeAudit(actor, {
    action: 'exam.assessment.create',
    entityType: 'Mark',
    entityId: assessment.id,
    after: { title: assessment.title, totalMarks: assessment.totalMarks },
  });

  return assessment;
}

/**
 * Creates one assessment per component per section for a whole subject in one action.
 *
 * Setting up a mock series by hand means twelve subjects × four components × a dozen
 * sections — around five hundred rows. Nobody does that twice, and a school that has to
 * would keep using the spreadsheet.
 */
export const bulkAssessmentSchema = z.object({
  examSeriesId: z.string().uuid(),
  subjectId: z.string().uuid(),
  yearGroupId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Per component: its total marks. Weights come from the component definition. */
  componentTotals: z.record(z.string().uuid(), z.number().int().min(1).max(1000)),
});

export async function createAssessmentsForSubject(
  actor: Actor,
  input: z.infer<typeof bulkAssessmentSchema>,
) {
  requireCapability(actor, 'exam.manage');

  const series = await prisma.examSeries.findFirst({
    where: { id: input.examSeriesId },
    select: { id: true, academicYearId: true, isPublished: true },
  });
  if (!series) throw ApiError.notFound('Exam series not found');
  if (series.isPublished) {
    throw ApiError.conflict('seriesPublished', 'That series is published and cannot be changed.');
  }

  const [sections, components] = await Promise.all([
    prisma.section.findMany({
      where: {
        academicYearId: series.academicYearId,
        subjectId: input.subjectId,
        ...(input.yearGroupId ? { yearGroupId: input.yearGroupId } : {}),
      },
      select: { id: true },
    }),
    prisma.subjectComponent.findMany({
      where: { subjectId: input.subjectId, id: { in: Object.keys(input.componentTotals) } },
      select: { id: true, code: true, name: true, weightPercent: true },
    }),
  ]);

  if (sections.length === 0) throw ApiError.notFound('No sections found for that subject');
  if (components.length === 0) throw ApiError.badRequest('noComponents', 'No components selected.');

  const rows: Prisma.AssessmentCreateManyInput[] = [];
  for (const section of sections) {
    for (const component of components) {
      rows.push({
        schoolId: actor.schoolId,
        academicYearId: series.academicYearId,
        examSeriesId: series.id,
        sectionId: section.id,
        subjectComponentId: component.id,
        title: `${component.code} ${component.name}`,
        date: toDateOnly(input.date),
        totalMarks: input.componentTotals[component.id]!,
        weightPercent: component.weightPercent,
      });
    }
  }

  const created = await prisma.assessment.createMany({ data: rows, skipDuplicates: true });

  await writeAudit(actor, {
    action: 'exam.assessment.bulkCreate',
    entityType: 'Mark',
    entityId: series.id,
    after: { sections: sections.length, components: components.length, created: created.count },
  });

  return { created: created.count, sections: sections.length, components: components.length };
}

/** The grading scale an assessment uses: its own override, or the school default. */
export async function resolveGradingScale(assessmentId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId },
    select: { gradingScale: { select: { id: true, name: true, bandsJson: true } } },
  });

  const scale =
    assessment?.gradingScale ??
    (await prisma.gradingScale.findFirst({
      where: { isDefault: true },
      select: { id: true, name: true, bandsJson: true },
    }));

  if (!scale) {
    throw ApiError.badRequest('noGradingScale', 'This school has no default grading scale.');
  }

  return { id: scale.id, name: scale.name, bands: parseBands(scale.bandsJson) };
}
