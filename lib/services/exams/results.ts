import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import {
  assertCanAccessStudent,
  canAccessDepartment,
  can,
  hasRole,
  requireCapability,
  type Actor,
} from '@/lib/permissions';
import { bandsDropped, gradeFor, parseBands, type GradeBand } from '@/lib/services/grading/bands';
import {
  attainmentRates,
  gradeDistribution,
  weightedRecentPercent,
} from '@/lib/services/grading/statistics';
import { weakestComponents } from '@/lib/services/grading/aggregate';
import type { ResultCardAggregate, ResultCardSubject } from './publish';

/**
 * Student-facing analytics.
 *
 * "This is what makes a student open the app when no test is due." Every figure here comes
 * from the frozen ResultCard snapshots, so a published grade never changes underneath a
 * family because someone edited a grading scale afterwards.
 */

async function defaultBands(): Promise<{ name: string; bands: GradeBand[] }> {
  const scale = await prisma.gradingScale.findFirst({
    where: { isDefault: true },
    select: { name: true, bandsJson: true },
  });
  if (!scale) throw ApiError.badRequest('noGradingScale', 'This school has no default grading scale.');
  return { name: scale.name, bands: parseBands(scale.bandsJson) };
}

export type StudentResultsView = {
  studentId: string;
  studentName: string;
  series: {
    examSeriesId: string;
    name: string;
    type: string;
    publishedAt: string | null;
    subjects: ResultCardSubject[];
    attendancePercent: number | null;
  }[];
  /** One line per subject per series — the chart a student screenshots. */
  trend: {
    subjectCode: string;
    subjectName: string;
    points: { examSeriesName: string; percent: number | null; grade: string | null }[];
  }[];
  /** "Which paper is dragging the grade down." */
  componentBreakdown: {
    subjectCode: string;
    subjectName: string;
    weakest: { componentCode: string; componentName: string; percent: number; lostPoints: number }[];
  }[];
  predicted: {
    subjectCode: string;
    subjectName: string;
    teacherGrade: string | null;
    systemGrade: string | null;
    systemPercent: number | null;
  }[];
  gradeBands: GradeBand[];
};

export async function getStudentResults(
  actor: Actor,
  studentId: string,
): Promise<StudentResultsView> {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: {
      id: true,
      user: { select: { name: true } },
      enrolments: { where: { droppedAt: null }, select: { sectionId: true } },
    },
  });
  if (!student) throw ApiError.notFound('Student not found');

  assertCanAccessStudent(
    actor,
    studentId,
    student.enrolments.map((entry) => entry.sectionId),
  );

  const [cards, { bands }, predictedRows] = await Promise.all([
    prisma.resultCard.findMany({
      where: {
        studentId,
        // Only published series reach a student or a parent.
        examSeries: { isPublished: true },
      },
      orderBy: { examSeries: { startDate: 'asc' } },
      select: {
        examSeriesId: true,
        publishedAt: true,
        aggregateJson: true,
        examSeries: { select: { name: true, type: true } },
      },
    }),
    defaultBands(),
    prisma.predictedGrade.findMany({
      where: { studentId, method: 'TEACHER' },
      select: { grade: true, subject: { select: { code: true, name: true } } },
    }),
  ]);

  const series = cards.map((card) => {
    const aggregate = card.aggregateJson as unknown as ResultCardAggregate;
    return {
      examSeriesId: card.examSeriesId,
      name: card.examSeries.name,
      type: card.examSeries.type,
      publishedAt: card.publishedAt?.toISOString() ?? null,
      subjects: aggregate.subjects ?? [],
      attendancePercent: aggregate.attendancePercent ?? null,
    };
  });

  // Grade trend: one series of points per subject, oldest first, so "C → C → B → B" reads
  // left to right the way the student experienced it.
  const trendMap = new Map<
    string,
    { subjectName: string; points: { examSeriesName: string; percent: number | null; grade: string | null }[] }
  >();

  for (const entry of series) {
    for (const subject of entry.subjects) {
      const existing = trendMap.get(subject.subjectCode) ?? {
        subjectName: subject.subjectName,
        points: [],
      };
      existing.points.push({
        examSeriesName: entry.name,
        percent: subject.percent,
        grade: subject.grade,
      });
      trendMap.set(subject.subjectCode, existing);
    }
  }

  const trend = [...trendMap.entries()]
    .map(([subjectCode, value]) => ({ subjectCode, ...value }))
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  // Component breakdown from the most recent series, which is the one worth acting on.
  const latest = series.at(-1);
  const componentBreakdown = (latest?.subjects ?? []).map((subject) => ({
    subjectCode: subject.subjectCode,
    subjectName: subject.subjectName,
    weakest: weakestComponents(
      {
        components: subject.components.map((component) => ({
          componentId: null,
          componentCode: component.code,
          componentName: component.name,
          weightPercent: component.weightPercent,
          marksObtained: component.marksObtained,
          totalMarks: component.totalMarks,
          isAbsent: component.isAbsent,
          percent: component.percent,
          grade: component.grade,
        })),
        percent: subject.percent,
        grade: subject.grade,
        weightCovered: subject.components
          .filter((component) => component.percent !== null)
          .reduce((sum, component) => sum + component.weightPercent, 0),
        missingComponents: subject.missingComponents,
      },
      3,
    ),
  }));

  const teacherPredicted = new Map(
    predictedRows.map((row) => [row.subject.code, { grade: row.grade, name: row.subject.name }]),
  );

  const predicted = trend.map((entry) => {
    // "Predicted grade — both the teacher-set grade and a system suggestion from weighted
    // recent performance, clearly labelled as which is which."
    const systemPercent = weightedRecentPercent(entry.points);
    return {
      subjectCode: entry.subjectCode,
      subjectName: entry.subjectName,
      teacherGrade: teacherPredicted.get(entry.subjectCode)?.grade ?? null,
      systemGrade: systemPercent === null ? null : gradeFor(systemPercent, bands),
      systemPercent,
    };
  });

  return {
    studentId: student.id,
    studentName: student.user.name,
    series,
    trend,
    componentBreakdown,
    predicted,
    gradeBands: bands,
  };
}

export type SectionPerformance = {
  sectionId: string;
  sectionName: string;
  subjectName: string;
  examSeriesName: string;
  distribution: { grade: string; count: number; percent: number }[];
  yearGroupDistribution: { grade: string; count: number; percent: number }[];
  rates: { entered: number; passRate: number | null; highGradeRate: number | null };
};

/** "Section performance distribution against the year group." */
export async function getSectionPerformance(
  actor: Actor,
  sectionId: string,
  examSeriesId: string,
): Promise<SectionPerformance> {
  requireCapability(actor, 'report.section');

  const section = await prisma.section.findFirst({
    where: { id: sectionId },
    select: {
      id: true,
      name: true,
      yearGroupId: true,
      subjectId: true,
      subject: { select: { name: true, code: true, departmentId: true } },
    },
  });
  if (!section) throw ApiError.notFound('Section not found');

  const departmentId = section.subject.departmentId;
  const isDepartmentHead = departmentId !== null && canAccessDepartment(actor, departmentId);
  if (!hasRole(actor, 'ADMIN') && !isDepartmentHead && !actor.sectionIds.includes(sectionId)) {
    throw ApiError.notFound('Section not found');
  }

  const [series, { bands }] = await Promise.all([
    prisma.examSeries.findFirst({ where: { id: examSeriesId }, select: { name: true } }),
    defaultBands(),
  ]);
  if (!series) throw ApiError.notFound('Exam series not found');

  const cards = await prisma.resultCard.findMany({
    where: {
      examSeriesId,
      student: {
        enrolments: {
          some: {
            droppedAt: null,
            section: { yearGroupId: section.yearGroupId, subjectId: section.subjectId },
          },
        },
      },
    },
    select: {
      aggregateJson: true,
      student: {
        select: {
          enrolments: {
            where: { droppedAt: null, section: { subjectId: section.subjectId } },
            select: { sectionId: true },
          },
        },
      },
    },
  });

  const sectionGrades: (string | null)[] = [];
  const yearGroupGrades: (string | null)[] = [];

  for (const card of cards) {
    const aggregate = card.aggregateJson as unknown as ResultCardAggregate;
    const subject = aggregate.subjects?.find((entry) => entry.subjectCode === section.subject.code);
    if (!subject) continue;

    yearGroupGrades.push(subject.grade);
    if (card.student.enrolments.some((entry) => entry.sectionId === sectionId)) {
      sectionGrades.push(subject.grade);
    }
  }

  const orderedGrades = bands.map((band) => band.grade);
  const passGrades = orderedGrades.slice(0, -1); // everything above the bottom band
  const highGrades = orderedGrades.slice(0, 3); // A*, A, B on a CAIE scale

  return {
    sectionId,
    sectionName: section.name,
    subjectName: section.subject.name,
    examSeriesName: series.name,
    distribution: gradeDistribution(sectionGrades, orderedGrades),
    yearGroupDistribution: gradeDistribution(yearGroupGrades, orderedGrades),
    rates: attainmentRates(sectionGrades, passGrades, highGrades),
  };
}

export type GradeDropRow = {
  studentId: string;
  studentName: string;
  rollNumber: string;
  subjectCode: string;
  subjectName: string;
  previousGrade: string;
  currentGrade: string;
  bandsDropped: number;
};

/**
 * "Students whose grade dropped two bands or more since the last series, flagged
 * automatically." This is the list a coordinator acts on, so it is computed rather than
 * left for someone to notice.
 */
export async function getGradeDrops(
  actor: Actor,
  options: { minimumDrop?: number } = {},
): Promise<GradeDropRow[]> {
  if (!can(actor, 'report.department') && !can(actor, 'report.school')) {
    throw ApiError.notFound('Report not available');
  }

  const minimumDrop = options.minimumDrop ?? 2;
  const { bands } = await defaultBands();

  const recent = await prisma.examSeries.findMany({
    where: { isPublished: true },
    orderBy: { startDate: 'desc' },
    take: 2,
    select: { id: true, name: true },
  });
  if (recent.length < 2) return [];

  const [current, previous] = recent;

  const cards = await prisma.resultCard.findMany({
    where: { examSeriesId: { in: [current!.id, previous!.id] } },
    select: {
      examSeriesId: true,
      studentId: true,
      aggregateJson: true,
      student: { select: { rollNumber: true, user: { select: { name: true } } } },
    },
  });

  const bySeries = new Map<string, Map<string, ResultCardAggregate>>();
  const studentMeta = new Map<string, { name: string; rollNumber: string }>();

  for (const card of cards) {
    const forSeries = bySeries.get(card.examSeriesId) ?? new Map();
    forSeries.set(card.studentId, card.aggregateJson as unknown as ResultCardAggregate);
    bySeries.set(card.examSeriesId, forSeries);
    studentMeta.set(card.studentId, {
      name: card.student.user.name,
      rollNumber: card.student.rollNumber,
    });
  }

  const currentCards: Map<string, ResultCardAggregate> =
    bySeries.get(current!.id) ?? new Map();
  const previousCards: Map<string, ResultCardAggregate> =
    bySeries.get(previous!.id) ?? new Map();

  const drops: GradeDropRow[] = [];

  for (const [studentId, aggregate] of currentCards) {
    const before = previousCards.get(studentId);
    if (!before) continue;

    for (const subject of aggregate.subjects ?? []) {
      const previousSubject = before.subjects?.find(
        (entry: ResultCardSubject) => entry.subjectCode === subject.subjectCode,
      );
      if (!previousSubject?.grade || !subject.grade) continue;

      const dropped = bandsDropped(previousSubject.grade, subject.grade, bands);
      if (dropped === null || dropped < minimumDrop) continue;

      const meta = studentMeta.get(studentId);
      drops.push({
        studentId,
        studentName: meta?.name ?? '—',
        rollNumber: meta?.rollNumber ?? '—',
        subjectCode: subject.subjectCode,
        subjectName: subject.subjectName,
        previousGrade: previousSubject.grade,
        currentGrade: subject.grade,
        bandsDropped: dropped,
      });
    }
  }

  return drops.sort((a, b) => b.bandsDropped - a.bandsDropped);
}
