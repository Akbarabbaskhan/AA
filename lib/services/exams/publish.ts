import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { writeAudit } from '@/lib/services/audit';
import { requireCapability, type Actor } from '@/lib/permissions';
import { parseBands, type GradeBand } from '@/lib/services/grading/bands';
import { aggregateSubject, type ComponentScore } from '@/lib/services/grading/aggregate';
import { classStatistics, percentile, percentileBand } from '@/lib/services/grading/statistics';
import { tally } from '@/lib/services/attendance/policy';

/**
 * Series publication.
 *
 * "Marks stay unpublished and invisible to students and parents until the HOD or Admin
 * publishes the whole series at once. Staggered visibility causes complaints."
 *
 * Publication computes every student's subject grades once and freezes them into a
 * ResultCard row. That snapshot is what the PDF and the portal both read afterwards, so a
 * card printed today still prints identically in three years even if a grading scale is
 * later edited — which is the whole reason it is a snapshot and not a live query.
 */

export type ResultCardComponent = {
  code: string;
  name: string;
  marksObtained: number | null;
  totalMarks: number;
  percent: number | null;
  grade: string | null;
  isAbsent: boolean;
  weightPercent: number;
};

export type ResultCardSubject = {
  subjectCode: string;
  subjectName: string;
  sectionName: string;
  teacherName: string | null;
  components: ResultCardComponent[];
  percent: number | null;
  grade: string | null;
  missingComponents: string[];
  /** For comparison on the card, as the spec requires. */
  classAveragePercent: number | null;
  /** Private to the student: a band, never a rank. */
  percentileBand: string | null;
};

export type ResultCardAggregate = {
  examSeriesName: string;
  examSeriesType: string;
  startDate: string;
  endDate: string;
  gradingScaleName: string;
  subjects: ResultCardSubject[];
  attendancePercent: number | null;
  /** Teacher remarks visible to the family. */
  remarks: { staffName: string; body: string }[];
  generatedAt: string;
};

type AssessmentRow = {
  id: string;
  totalMarks: number;
  weightPercent: number;
  sectionId: string;
  subjectComponent: { id: string; code: string; name: string } | null;
  section: {
    name: string;
    subject: { id: string; code: string; name: string };
    teacher: { user: { name: string } } | null;
  };
};

export type PublishResult = {
  examSeriesId: string;
  studentsGraded: number;
  resultCards: number;
  subjectsGraded: number;
};

export async function publishExamSeries(
  actor: Actor,
  examSeriesId: string,
): Promise<PublishResult> {
  requireCapability(actor, 'exam.publish');

  const series = await prisma.examSeries.findFirst({
    where: { id: examSeriesId },
    select: {
      id: true,
      name: true,
      type: true,
      startDate: true,
      endDate: true,
      isPublished: true,
      academicYearId: true,
    },
  });
  if (!series) throw ApiError.notFound('Exam series not found');
  if (series.isPublished) {
    throw ApiError.conflict('alreadyPublished', 'That series is already published.');
  }

  const [assessments, defaultScale] = await Promise.all([
    prisma.assessment.findMany({
      where: { examSeriesId },
      select: {
        id: true,
        totalMarks: true,
        weightPercent: true,
        sectionId: true,
        subjectComponent: { select: { id: true, code: true, name: true } },
        section: {
          select: {
            name: true,
            subject: { select: { id: true, code: true, name: true } },
            teacher: { select: { user: { select: { name: true } } } },
          },
        },
      },
    }) as Promise<AssessmentRow[]>,
    prisma.gradingScale.findFirst({
      where: { isDefault: true },
      select: { name: true, bandsJson: true },
    }),
  ]);

  if (assessments.length === 0) {
    throw ApiError.badRequest('noAssessments', 'That series has no papers in it yet.');
  }
  if (!defaultScale) {
    throw ApiError.badRequest('noGradingScale', 'This school has no default grading scale.');
  }

  const bands: GradeBand[] = parseBands(defaultScale.bandsJson);
  const assessmentById = new Map(assessments.map((assessment) => [assessment.id, assessment]));

  // Everything in bulk: at 2,000 students across four subjects this is ~30,000 marks, and a
  // query per student would take minutes rather than seconds.
  const marks = await prisma.mark.findMany({
    where: { assessmentId: { in: assessments.map((assessment) => assessment.id) } },
    select: {
      assessmentId: true,
      studentId: true,
      marksObtained: true,
      isAbsent: true,
    },
  });

  // Class average per paper, computed once and reused on every card in that section.
  const marksByAssessment = new Map<string, typeof marks>();
  for (const mark of marks) {
    marksByAssessment.set(mark.assessmentId, [
      ...(marksByAssessment.get(mark.assessmentId) ?? []),
      mark,
    ]);
  }

  // student → subject → components
  type StudentSubject = { assessmentIds: string[] };
  const byStudent = new Map<string, Map<string, StudentSubject>>();

  for (const mark of marks) {
    const assessment = assessmentById.get(mark.assessmentId);
    if (!assessment) continue;

    const subjects = byStudent.get(mark.studentId) ?? new Map<string, StudentSubject>();
    const subjectId = assessment.section.subject.id;
    const entry = subjects.get(subjectId) ?? { assessmentIds: [] };
    entry.assessmentIds.push(mark.assessmentId);
    subjects.set(subjectId, entry);
    byStudent.set(mark.studentId, subjects);
  }

  const markLookup = new Map(marks.map((mark) => [`${mark.assessmentId}:${mark.studentId}`, mark]));

  // Attendance for the term, printed on the card.
  const attendance = await prisma.attendanceRecord.groupBy({
    by: ['studentId', 'status'],
    where: {
      academicYearId: series.academicYearId,
      session: { date: { gte: series.startDate, lte: series.endDate } },
    },
    _count: { _all: true },
  });

  const attendanceByStudent = new Map<string, { status: string; count: number }[]>();
  for (const row of attendance) {
    attendanceByStudent.set(row.studentId, [
      ...(attendanceByStudent.get(row.studentId) ?? []),
      { status: row.status, count: row._count._all },
    ]);
  }

  // Remarks the school has marked visible to parents.
  const remarks = await prisma.behaviourNote.findMany({
    where: {
      isVisibleToParent: true,
      studentId: { in: [...byStudent.keys()] },
      createdAt: { gte: series.startDate },
    },
    select: { studentId: true, body: true, staff: { select: { user: { select: { name: true } } } } },
  });
  const remarksByStudent = new Map<string, { staffName: string; body: string }[]>();
  for (const remark of remarks) {
    remarksByStudent.set(remark.studentId, [
      ...(remarksByStudent.get(remark.studentId) ?? []),
      { staffName: remark.staff.user.name, body: remark.body },
    ]);
  }

  // Subject percentages across the whole cohort, for the private percentile band.
  const subjectPopulations = new Map<string, number[]>();
  const studentSubjectPercent = new Map<string, Map<string, number>>();

  const buildSubject = (studentId: string, subjectId: string, entry: StudentSubject) => {
    const scores: ComponentScore[] = entry.assessmentIds.map((assessmentId) => {
      const assessment = assessmentById.get(assessmentId)!;
      const mark = markLookup.get(`${assessmentId}:${studentId}`);
      return {
        componentId: assessment.subjectComponent?.id ?? null,
        componentCode: assessment.subjectComponent?.code ?? 'Paper',
        componentName: assessment.subjectComponent?.name ?? assessment.section.subject.name,
        weightPercent: assessment.weightPercent,
        marksObtained: mark?.marksObtained ?? null,
        totalMarks: assessment.totalMarks,
        isAbsent: mark?.isAbsent ?? true,
      };
    });
    return aggregateSubject(scores, bands);
  };

  for (const [studentId, subjects] of byStudent) {
    const percents = new Map<string, number>();
    for (const [subjectId, entry] of subjects) {
      const result = buildSubject(studentId, subjectId, entry);
      if (result.percent !== null) {
        percents.set(subjectId, result.percent);
        subjectPopulations.set(subjectId, [
          ...(subjectPopulations.get(subjectId) ?? []),
          result.percent,
        ]);
      }
    }
    studentSubjectPercent.set(studentId, percents);
  }

  const classAverageByAssessment = new Map<string, number | null>();
  for (const [assessmentId, rows] of marksByAssessment) {
    const assessment = assessmentById.get(assessmentId);
    if (!assessment) continue;
    const statistics = classStatistics(rows);
    classAverageByAssessment.set(
      assessmentId,
      statistics.mean === null || assessment.totalMarks === 0
        ? null
        : (statistics.mean / assessment.totalMarks) * 100,
    );
  }

  const cards: Prisma.ResultCardCreateManyInput[] = [];
  let subjectsGraded = 0;

  for (const [studentId, subjects] of byStudent) {
    const cardSubjects: ResultCardSubject[] = [];

    for (const [subjectId, entry] of subjects) {
      const result = buildSubject(studentId, subjectId, entry);
      const first = assessmentById.get(entry.assessmentIds[0]!)!;

      const components: ResultCardComponent[] = result.components.map((component, index) => {
        const assessment = assessmentById.get(entry.assessmentIds[index]!)!;
        return {
          code: component.componentCode,
          name: component.componentName,
          marksObtained: component.marksObtained,
          totalMarks: assessment.totalMarks,
          percent: component.percent,
          grade: component.grade,
          isAbsent: component.isAbsent,
          weightPercent: component.weightPercent,
        };
      });

      // Weighted class average across the same papers, so the comparison is like for like.
      let weightedAverage = 0;
      let averageWeight = 0;
      for (const assessmentId of entry.assessmentIds) {
        const average = classAverageByAssessment.get(assessmentId);
        const assessment = assessmentById.get(assessmentId)!;
        if (average === null || average === undefined) continue;
        weightedAverage += average * assessment.weightPercent;
        averageWeight += assessment.weightPercent;
      }

      const own = studentSubjectPercent.get(studentId)?.get(subjectId) ?? null;
      const population = subjectPopulations.get(subjectId) ?? [];

      cardSubjects.push({
        subjectCode: first.section.subject.code,
        subjectName: first.section.subject.name,
        sectionName: first.section.name,
        teacherName: first.section.teacher?.user.name ?? null,
        components,
        percent: result.percent,
        grade: result.grade,
        missingComponents: result.missingComponents,
        classAveragePercent: averageWeight === 0 ? null : weightedAverage / averageWeight,
        percentileBand:
          own === null ? null : percentileBand(percentile(own, population)),
      });
      subjectsGraded += 1;
    }

    const attendanceRows = attendanceByStudent.get(studentId) ?? [];
    const attendanceTally = tally(
      attendanceRows.flatMap((row) =>
        Array.from({ length: row.count }, () => row.status as never),
      ),
    );

    const aggregate: ResultCardAggregate = {
      examSeriesName: series.name,
      examSeriesType: series.type,
      startDate: series.startDate.toISOString().slice(0, 10),
      endDate: series.endDate.toISOString().slice(0, 10),
      gradingScaleName: defaultScale.name,
      subjects: cardSubjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName)),
      attendancePercent: attendanceTally.percent,
      remarks: remarksByStudent.get(studentId) ?? [],
      generatedAt: new Date().toISOString(),
    };

    cards.push({
      schoolId: actor.schoolId,
      studentId,
      examSeriesId,
      aggregateJson: aggregate as unknown as Prisma.InputJsonValue,
      publishedAt: new Date(),
    });
  }

  // Replace rather than append, so re-publishing after an unpublish is clean.
  await prisma.resultCard.deleteMany({ where: { examSeriesId } });
  for (let index = 0; index < cards.length; index += 500) {
    await prisma.resultCard.createMany({ data: cards.slice(index, index + 500) });
  }

  await prisma.examSeries.update({
    where: { id: examSeriesId },
    data: { isPublished: true, publishedAt: new Date() },
  });

  await writeAudit(actor, {
    action: 'exam.series.publish',
    entityType: 'Mark',
    entityId: examSeriesId,
    after: { name: series.name, resultCards: cards.length, subjects: subjectsGraded },
  });

  return {
    examSeriesId,
    studentsGraded: byStudent.size,
    resultCards: cards.length,
    subjectsGraded,
  };
}

/**
 * Unpublishing exists for the case where a series went out with a broken paper total.
 * It is deliberately noisy in the audit log, because a grade a family has already seen
 * disappearing is the sort of thing a principal gets asked about.
 */
export async function unpublishExamSeries(actor: Actor, examSeriesId: string, reason: string) {
  requireCapability(actor, 'exam.publish');

  const series = await prisma.examSeries.findFirst({
    where: { id: examSeriesId },
    select: { id: true, name: true, isPublished: true },
  });
  if (!series) throw ApiError.notFound('Exam series not found');
  if (!series.isPublished) {
    throw ApiError.conflict('notPublished', 'That series is not published.');
  }

  await prisma.examSeries.update({
    where: { id: examSeriesId },
    data: { isPublished: false, publishedAt: null },
  });
  await prisma.resultCard.deleteMany({ where: { examSeriesId } });

  await writeAudit(actor, {
    action: 'exam.series.unpublish',
    entityType: 'Mark',
    entityId: examSeriesId,
    before: { isPublished: true },
    after: { isPublished: false },
    reason,
  });

  return { examSeriesId, unpublished: true };
}
