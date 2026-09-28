import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { canAny, requireAnyCapability, type Actor } from '@/lib/permissions';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { getDailyReport, getTeacherCompliance } from '@/lib/services/attendance/reports';
import { getGradeDrops } from '@/lib/services/exams/results';
import { getCollectionReport, getDefaulters } from '@/lib/services/fees/reports';
import { gradeDistribution } from '@/lib/services/grading/statistics';
import { zonedDateString } from '@/lib/utils/tz';
import { REPORT_DEFINITIONS, type ReportKey } from './definitions';
import type { Sheet } from '@/lib/reports/xlsx';

/**
 * The reporting module.
 *
 * Each report returns the same shape — a title, a subtitle, headline figures and a set of
 * tables — so the screen, the Excel export, the PDF and the scheduled email are four views of
 * one thing rather than four implementations that drift. A table is rows of primitives, which
 * is what a spreadsheet cell can hold and what a PDF can lay out.
 */

export type ReportTable = {
  name: string;
  columns: { header: string; width?: number; align?: 'start' | 'end' }[];
  rows: (string | number | boolean | null)[][];
};

export type Report = {
  key: ReportKey;
  title: string;
  subtitle: string;
  /** The two or three numbers somebody reads before the tables. */
  headline: { label: string; value: string }[];
  tables: ReportTable[];
  generatedAt: string;
};

export const reportQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  examSeriesId: z.string().uuid().optional(),
  session: z.string().max(40).optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

function percent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function rupees(paisa: number): string {
  return `PKR ${Math.round(paisa / 100).toLocaleString('en-PK')}`;
}

/** Report 1: the campus at 08:40, which is when a principal asks. */
async function dailyAttendance(actor: Actor, query: ReportQuery): Promise<Report> {
  const settings = await getSchoolSettings();
  const day = query.date ?? zonedDateString(new Date(), settings.timezone);
  const report = await getDailyReport(actor, day);

  return {
    key: 'daily-attendance',
    title: 'Daily attendance summary',
    subtitle: day,
    headline: [
      { label: 'Campus attendance', value: percent(report.campus.percent) },
      { label: 'Absent', value: String(report.absentees.length) },
      { label: 'Registers not marked', value: String(report.unmarked.length) },
    ],
    tables: [
      {
        name: 'By year group',
        columns: [{ header: 'Year group' }, { header: 'Attendance %' }, { header: 'Counted' }],
        rows: report.byYearGroup.map((row) => [
          row.name,
          row.percent === null ? null : Number(row.percent.toFixed(1)),
          row.counted,
        ]),
      },
      {
        name: 'Absent today',
        columns: [
          { header: 'Roll number' },
          { header: 'Name', width: 28 },
          { header: 'Year group' },
          { header: 'Periods missed' },
        ],
        rows: report.absentees.map((row) => [
          row.rollNumber,
          row.name,
          row.yearGroup,
          row.periods.length,
        ]),
      },
      {
        name: 'Registers not marked',
        columns: [
          { header: 'Section', width: 24 },
          { header: 'Period' },
          { header: 'Teacher', width: 24 },
        ],
        rows: report.unmarked.map((row) => [
          row.sectionName,
          row.periodIndex,
          row.teacherName ?? '—',
        ]),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Report 2: grade distribution by subject, section and teacher, against the previous series.
 *
 * The trend column is the point. A subject whose mean fell four points is a conversation; a
 * subject whose mean is 62% is a number.
 */
async function academicPerformance(actor: Actor, query: ReportQuery): Promise<Report> {
  const published = await prisma.examSeries.findMany({
    where: { isPublished: true },
    orderBy: { startDate: 'desc' },
    take: 2,
    select: { id: true, name: true },
  });

  const current = query.examSeriesId
    ? await prisma.examSeries.findFirst({
        where: { id: query.examSeriesId },
        select: { id: true, name: true },
      })
    : published[0];
  if (!current) throw ApiError.notFound('No published exam series');

  const previous = published.find((series) => series.id !== current.id) ?? null;

  const scale = await prisma.gradingScale.findFirst({
    where: { isDefault: true },
    select: { bandsJson: true },
  });
  const bands = (scale?.bandsJson ?? []) as { grade: string; minPercent: number }[];
  const orderedGrades = bands.map((band) => band.grade);

  type Row = {
    subject: string;
    section: string;
    teacher: string;
    marks: number;
    mean: number;
    previousMean: number | null;
    grades: string[];
  };

  const marks = await prisma.mark.findMany({
    where: {
      assessment: { examSeriesId: current.id },
      isAbsent: false,
      marksObtained: { not: null },
    },
    select: {
      marksObtained: true,
      assessment: {
        select: {
          totalMarks: true,
          section: {
            select: {
              name: true,
              subject: { select: { name: true } },
              teacher: { select: { user: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  const previousMarks = previous
    ? await prisma.mark.findMany({
        where: {
          assessment: { examSeriesId: previous.id },
          isAbsent: false,
          marksObtained: { not: null },
        },
        select: {
          marksObtained: true,
          assessment: {
            select: { totalMarks: true, section: { select: { name: true } } },
          },
        },
      })
    : [];

  const previousBySection = new Map<string, { total: number; count: number }>();
  for (const mark of previousMarks) {
    const key = mark.assessment.section.name;
    const entry = previousBySection.get(key) ?? { total: 0, count: 0 };
    entry.total += ((mark.marksObtained ?? 0) / mark.assessment.totalMarks) * 100;
    entry.count += 1;
    previousBySection.set(key, entry);
  }

  const bySection = new Map<string, Row & { total: number }>();
  for (const mark of marks) {
    const section = mark.assessment.section;
    const key = section.name;
    const entry = bySection.get(key) ?? {
      subject: section.subject.name,
      section: section.name,
      teacher: section.teacher?.user.name ?? '—',
      marks: 0,
      mean: 0,
      previousMean: null,
      grades: [],
      total: 0,
    };
    const percentValue = ((mark.marksObtained ?? 0) / mark.assessment.totalMarks) * 100;
    entry.total += percentValue;
    entry.marks += 1;
    const band = bands.find((entryBand) => percentValue >= entryBand.minPercent);
    if (band) entry.grades.push(band.grade);
    bySection.set(key, entry);
  }

  const rows = [...bySection.values()]
    .map((row) => {
      const previousEntry = previousBySection.get(row.section);
      return {
        ...row,
        mean: row.marks === 0 ? 0 : row.total / row.marks,
        previousMean:
          previousEntry && previousEntry.count > 0
            ? previousEntry.total / previousEntry.count
            : null,
      };
    })
    .sort((a, b) => a.subject.localeCompare(b.subject) || a.section.localeCompare(b.section));

  const bySubject = new Map<string, { total: number; count: number; grades: string[] }>();
  for (const row of rows) {
    const entry = bySubject.get(row.subject) ?? { total: 0, count: 0, grades: [] };
    entry.total += row.mean * row.marks;
    entry.count += row.marks;
    entry.grades.push(...row.grades);
    bySubject.set(row.subject, entry);
  }

  const distributionColumns = orderedGrades.map((grade) => ({ header: grade, width: 8 }));

  return {
    key: 'academic-performance',
    title: 'Academic performance',
    subtitle: previous ? `${current.name}, against ${previous.name}` : current.name,
    headline: [
      { label: 'Series', value: current.name },
      {
        label: 'Campus mean',
        value: percent(
          rows.length === 0
            ? null
            : rows.reduce((sum, row) => sum + row.mean * row.marks, 0) /
                rows.reduce((sum, row) => sum + row.marks, 0),
        ),
      },
      { label: 'Marks counted', value: String(rows.reduce((sum, row) => sum + row.marks, 0)) },
    ],
    tables: [
      {
        name: 'By subject',
        columns: [
          { header: 'Subject', width: 24 },
          { header: 'Mean %' },
          { header: 'Marks' },
          ...distributionColumns,
        ],
        rows: [...bySubject.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([subject, entry]) => {
            const distribution = gradeDistribution(entry.grades, orderedGrades);
            return [
              subject,
              entry.count === 0 ? null : Number((entry.total / entry.count).toFixed(1)),
              entry.count,
              ...orderedGrades.map(
                (grade) =>
                  distribution.find(
                    (slice: { grade: string; count: number }) => slice.grade === grade,
                  )?.count ?? 0,
              ),
            ];
          }),
      },
      {
        name: 'By section and teacher',
        columns: [
          { header: 'Subject', width: 20 },
          { header: 'Section', width: 18 },
          { header: 'Teacher', width: 24 },
          { header: 'Mean %' },
          { header: 'Previous %' },
          { header: 'Change' },
          { header: 'Marks' },
        ],
        rows: rows.map((row) => [
          row.subject,
          row.section,
          row.teacher,
          Number(row.mean.toFixed(1)),
          row.previousMean === null ? null : Number(row.previousMean.toFixed(1)),
          row.previousMean === null ? null : Number((row.mean - row.previousMean).toFixed(1)),
          row.marks,
        ]),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** Report 3: collected against expected, aging, and how the money arrived. */
async function feeCollection(actor: Actor): Promise<Report> {
  const [collection, defaulters] = await Promise.all([
    getCollectionReport(actor),
    getDefaulters(actor, { limit: 500, minOutstanding: 1 }),
  ]);

  return {
    key: 'fee-collection',
    title: 'Fee collection',
    subtitle: 'Against what is due, not against what is billed',
    headline: [
      { label: 'Collected', value: rupees(collection.totals.collected) },
      { label: 'Collection rate', value: percent(collection.totals.rate * 100) },
      { label: 'Outstanding', value: rupees(collection.totals.outstanding) },
    ],
    tables: [
      {
        name: 'By period',
        columns: [
          { header: 'Period', width: 18 },
          { header: 'Billed' },
          { header: 'Collected' },
          { header: 'Outstanding' },
          { header: 'Rate %' },
          { header: 'Due yet' },
        ],
        rows: collection.byPeriod.map((row) => [
          row.periodLabel,
          Math.round(row.billed / 100),
          Math.round(row.collected / 100),
          Math.round(row.outstanding / 100),
          Number((row.rate * 100).toFixed(1)),
          row.isDue,
        ]),
      },
      {
        name: 'Aging',
        columns: [{ header: 'Bucket' }, { header: 'Families' }, { header: 'Outstanding' }],
        rows: Object.entries(defaulters.totals).map(([bucket, totals]) => [
          bucket,
          totals.students,
          Math.round(totals.outstanding / 100),
        ]),
      },
      {
        name: 'By method',
        columns: [{ header: 'Method' }, { header: 'Payments' }, { header: 'Amount' }],
        rows: collection.byMethod.map((row) => [
          row.method,
          row.count,
          Math.round(row.amount / 100),
        ]),
      },
      {
        name: 'By year group',
        columns: [
          { header: 'Year group' },
          { header: 'Billed' },
          { header: 'Collected' },
          { header: 'Rate %' },
        ],
        rows: collection.byYearGroup.map((row) => [
          row.yearGroupName,
          Math.round(row.billed / 100),
          Math.round(row.collected / 100),
          Number((row.rate * 100).toFixed(1)),
        ]),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Report 4: the at-risk list, which is four separate worries in one place.
 *
 * "Attendance under threshold, grade drop of two bands or more, missing submissions, fee
 * overdue — combined into one list." Combined is the whole value: each of those alone is a
 * screen somebody has to remember to open, and the student who is on three of them is the one
 * nobody has noticed.
 */
async function atRisk(actor: Actor): Promise<Report> {
  const settings = await getSchoolSettings();
  const threshold = settings.attendance.minimumPercent;

  const academicYear = await prisma.academicYear.findFirstOrThrow({
    where: { isCurrent: true },
    select: { id: true },
  });

  const [attendance, drops, submissions, overdue] = await Promise.all([
    // Attendance below the school's own threshold, counted in Postgres.
    prisma.$queryRaw<{ student_id: string; attended: bigint; counted: bigint }[]>`
      SELECT r.student_id,
             COUNT(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE'))           AS attended,
             COUNT(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE', 'ABSENT')) AS counted
      FROM attendance_records r
      WHERE r.school_id = ${actor.schoolId}
        AND r.academic_year_id = ${academicYear.id}
      GROUP BY r.student_id
      HAVING COUNT(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE', 'ABSENT')) >= 20
    `,
    getGradeDrops(actor, { minimumDrop: 2 }),
    prisma.$queryRaw<{ student_id: string; missing: bigint }[]>`
      SELECT e.student_id, COUNT(*) AS missing
      FROM assignments a
      JOIN enrolments e ON e.section_id = a.section_id AND e.dropped_at IS NULL
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = e.student_id
      WHERE a.school_id = ${actor.schoolId}
        AND a.deleted_at IS NULL
        AND a.is_published = true
        AND a.due_at < now()
        AND s.id IS NULL
      GROUP BY e.student_id
      HAVING COUNT(*) >= 2
    `,
    getDefaulters(actor, { limit: 1_000, minOutstanding: 1 }).catch(() => ({
      rows: [],
      totals: {} as never,
    })),
  ]);

  const belowThreshold = new Map<string, number>();
  for (const row of attendance) {
    const counted = Number(row.counted);
    const value = counted === 0 ? 100 : (Number(row.attended) / counted) * 100;
    if (value < threshold) belowThreshold.set(row.student_id, value);
  }

  const missingByStudent = new Map(submissions.map((row) => [row.student_id, Number(row.missing)]));
  const dropByStudent = new Map(drops.map((row) => [row.studentId, row]));
  const overdueByStudent = new Map(overdue.rows.map((row) => [row.studentId, row]));

  const studentIds = [
    ...new Set([
      ...belowThreshold.keys(),
      ...missingByStudent.keys(),
      ...dropByStudent.keys(),
      ...overdueByStudent.keys(),
    ]),
  ];

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds }, deletedAt: null },
    select: {
      id: true,
      rollNumber: true,
      user: { select: { name: true } },
      enrolments: {
        where: { droppedAt: null },
        take: 1,
        select: { section: { select: { yearGroup: { select: { name: true } } } } },
      },
      guardians: {
        where: { isPrimary: true },
        take: 1,
        select: { guardian: { select: { user: { select: { name: true, phone: true } } } } },
      },
    },
  });

  const rows = students
    .map((student) => {
      const attendancePercent = belowThreshold.get(student.id) ?? null;
      const drop = dropByStudent.get(student.id);
      const missing = missingByStudent.get(student.id) ?? 0;
      const fees = overdueByStudent.get(student.id);
      const flags =
        (attendancePercent !== null ? 1 : 0) +
        (drop ? 1 : 0) +
        (missing > 0 ? 1 : 0) +
        (fees ? 1 : 0);

      return {
        rollNumber: student.rollNumber,
        name: student.user.name,
        yearGroup: student.enrolments[0]?.section.yearGroup.name ?? '—',
        attendancePercent,
        gradeDrop: drop ? `${drop.subjectName} ${drop.previousGrade}→${drop.currentGrade}` : null,
        missing,
        outstanding: fees ? Math.round(fees.outstanding / 100) : 0,
        guardian: student.guardians[0]?.guardian.user.name ?? '—',
        phone: student.guardians[0]?.guardian.user.phone ?? '—',
        flags,
      };
    })
    // Most worries first: the student on three lists is the one to ring today.
    .sort(
      (a, b) => b.flags - a.flags || (a.attendancePercent ?? 100) - (b.attendancePercent ?? 100),
    );

  return {
    key: 'at-risk',
    title: 'At-risk students',
    subtitle: `Attendance under ${threshold}%, a two-band grade drop, missing work, or fees overdue`,
    headline: [
      { label: 'On the list', value: String(rows.length) },
      {
        label: 'On two or more counts',
        value: String(rows.filter((row) => row.flags >= 2).length),
      },
      {
        label: 'Below attendance threshold',
        value: String(rows.filter((row) => row.attendancePercent !== null).length),
      },
    ],
    tables: [
      {
        name: 'At risk',
        columns: [
          { header: 'Flags' },
          { header: 'Roll number' },
          { header: 'Name', width: 26 },
          { header: 'Year group' },
          { header: 'Attendance %' },
          { header: 'Grade drop', width: 24 },
          { header: 'Missing work' },
          { header: 'Fees overdue (PKR)' },
          { header: 'Guardian', width: 24 },
          { header: 'Phone', width: 18 },
        ],
        rows: rows.map((row) => [
          row.flags,
          row.rollNumber,
          row.name,
          row.yearGroup,
          row.attendancePercent === null ? null : Number(row.attendancePercent.toFixed(1)),
          row.gradeDrop,
          row.missing,
          row.outstanding,
          row.guardian,
          row.phone,
        ]),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** Report 5: who is marking registers, entering marks and uploading anything. */
async function teacherActivity(actor: Actor): Promise<Report> {
  const compliance = await getTeacherCompliance(actor);

  const academicYear = await prisma.academicYear.findFirstOrThrow({
    where: { isCurrent: true },
    select: { id: true },
  });

  const [marksEntered, resources, assignments] = await Promise.all([
    prisma.mark.groupBy({
      by: ['enteredById'],
      where: { academicYearId: academicYear.id },
      _count: { _all: true },
    }),
    prisma.resource.groupBy({ by: ['uploadedById'], _count: { _all: true } }),
    prisma.assignment.groupBy({
      by: ['createdById'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const staffIds = [
    ...new Set([
      ...compliance.map((row) => row.teacherId),
      ...marksEntered.flatMap((row) => (row.enteredById ? [row.enteredById] : [])),
      ...resources.flatMap((row) => (row.uploadedById ? [row.uploadedById] : [])),
      ...assignments.flatMap((row) => (row.createdById ? [row.createdById] : [])),
    ]),
  ];

  const staff = await prisma.staff.findMany({
    where: { id: { in: staffIds } },
    select: {
      id: true,
      employeeCode: true,
      user: { select: { name: true } },
      department: { select: { name: true } },
    },
  });

  const marksBy = new Map(marksEntered.map((row) => [row.enteredById ?? '', row._count._all]));
  const resourcesBy = new Map(resources.map((row) => [row.uploadedById ?? '', row._count._all]));
  const assignmentsBy = new Map(assignments.map((row) => [row.createdById ?? '', row._count._all]));
  const complianceBy = new Map(compliance.map((row) => [row.teacherId, row]));

  const rows = staff
    .map((member) => ({
      code: member.employeeCode,
      name: member.user.name,
      department: member.department?.name ?? '—',
      expected: complianceBy.get(member.id)?.expected ?? 0,
      marked: complianceBy.get(member.id)?.marked ?? 0,
      compliance: complianceBy.get(member.id)?.percent ?? null,
      marks: marksBy.get(member.id) ?? 0,
      resources: resourcesBy.get(member.id) ?? 0,
      assignments: assignmentsBy.get(member.id) ?? 0,
    }))
    .sort((a, b) => (a.compliance ?? 101) - (b.compliance ?? 101));

  const marking = rows.filter((row) => row.expected > 0);

  return {
    key: 'teacher-activity',
    title: 'Teacher activity',
    subtitle: 'Register marking over the last fortnight, and what has been set and uploaded',
    headline: [
      {
        label: 'Average marking compliance',
        value: percent(
          marking.length === 0
            ? null
            : marking.reduce((sum, row) => sum + (row.compliance ?? 0), 0) / marking.length,
        ),
      },
      {
        label: 'Below 90%',
        value: String(marking.filter((row) => (row.compliance ?? 100) < 90).length),
      },
      {
        label: 'Resources uploaded',
        value: String(rows.reduce((sum, row) => sum + row.resources, 0)),
      },
    ],
    tables: [
      {
        name: 'Teacher activity',
        columns: [
          { header: 'Code' },
          { header: 'Name', width: 26 },
          { header: 'Department', width: 20 },
          { header: 'Registers expected' },
          { header: 'Registers marked' },
          { header: 'Compliance %' },
          { header: 'Marks entered' },
          { header: 'Assignments set' },
          { header: 'Resources uploaded' },
        ],
        rows: rows.map((row) => [
          row.code,
          row.name,
          row.department,
          row.expected,
          row.marked,
          row.compliance === null ? null : Number(row.compliance.toFixed(1)),
          row.marks,
          row.assignments,
          row.resources,
        ]),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** Report 6: what the board said, against what the school predicted. */
async function boardResults(actor: Actor, query: ReportQuery): Promise<Report> {
  const sessions = await prisma.boardResult.groupBy({
    by: ['session'],
    _count: { _all: true },
    orderBy: { session: 'desc' },
  });

  const session = query.session ?? sessions[0]?.session ?? null;

  if (!session) {
    return {
      key: 'board-results',
      title: 'Board results analysis',
      subtitle: 'No board results have been entered yet',
      headline: [{ label: 'Results entered', value: '0' }],
      tables: [
        {
          name: 'Board results',
          columns: [{ header: 'Roll number' }, { header: 'Subject' }, { header: 'Grade' }],
          rows: [],
        },
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  const [results, scale] = await Promise.all([
    prisma.boardResult.findMany({
      where: { session },
      select: {
        grade: true,
        studentId: true,
        subjectId: true,
        subject: { select: { name: true } },
        student: { select: { rollNumber: true, user: { select: { name: true } } } },
      },
    }),
    prisma.gradingScale.findFirst({ where: { isDefault: true }, select: { bandsJson: true } }),
  ]);

  const bands = (scale?.bandsJson ?? []) as { grade: string }[];
  const order = new Map(bands.map((band, index) => [band.grade, index]));

  const predictions = await prisma.predictedGrade.findMany({
    where: {
      studentId: { in: [...new Set(results.map((row) => row.studentId))] },
      subjectId: { in: [...new Set(results.map((row) => row.subjectId))] },
    },
    orderBy: { createdAt: 'desc' },
    select: { studentId: true, subjectId: true, grade: true, method: true },
  });

  const predictionBy = new Map<string, string>();
  for (const prediction of predictions) {
    const key = `${prediction.studentId}:${prediction.subjectId}`;
    if (!predictionBy.has(key)) predictionBy.set(key, prediction.grade);
  }

  type Comparison = {
    rollNumber: string;
    name: string;
    subject: string;
    predicted: string | null;
    actual: string;
    /** Negative when the board graded lower than the school predicted. */
    difference: number | null;
  };

  const comparisons: Comparison[] = results.map((row) => {
    const predicted = predictionBy.get(`${row.studentId}:${row.subjectId}`) ?? null;
    const predictedIndex = predicted ? order.get(predicted) : undefined;
    const actualIndex = order.get(row.grade);
    return {
      rollNumber: row.student.rollNumber,
      name: row.student.user.name,
      subject: row.subject.name,
      predicted,
      actual: row.grade,
      difference:
        predictedIndex === undefined || actualIndex === undefined
          ? null
          : predictedIndex - actualIndex,
    };
  });

  const compared = comparisons.filter((row) => row.difference !== null);
  const exact = compared.filter((row) => row.difference === 0).length;
  const withinOne = compared.filter((row) => Math.abs(row.difference ?? 9) <= 1).length;

  const bySubject = new Map<string, { compared: number; exact: number; optimistic: number }>();
  for (const row of compared) {
    const entry = bySubject.get(row.subject) ?? { compared: 0, exact: 0, optimistic: 0 };
    entry.compared += 1;
    if (row.difference === 0) entry.exact += 1;
    // The school predicted a better grade than the board gave.
    if ((row.difference ?? 0) < 0) entry.optimistic += 1;
    bySubject.set(row.subject, entry);
  }

  return {
    key: 'board-results',
    title: 'Board results analysis',
    subtitle: session,
    headline: [
      { label: 'Results entered', value: String(results.length) },
      {
        label: 'Predicted exactly',
        value: percent(compared.length === 0 ? null : (exact / compared.length) * 100),
      },
      {
        label: 'Within one grade',
        value: percent(compared.length === 0 ? null : (withinOne / compared.length) * 100),
      },
    ],
    tables: [
      {
        name: 'Accuracy by subject',
        columns: [
          { header: 'Subject', width: 24 },
          { header: 'Compared' },
          { header: 'Exact' },
          { header: 'Exact %' },
          { header: 'School predicted higher' },
        ],
        rows: [...bySubject.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([subject, entry]) => [
            subject,
            entry.compared,
            entry.exact,
            Number(((entry.exact / entry.compared) * 100).toFixed(1)),
            entry.optimistic,
          ]),
      },
      {
        name: 'Biggest misses',
        columns: [
          { header: 'Roll number' },
          { header: 'Name', width: 26 },
          { header: 'Subject', width: 20 },
          { header: 'Predicted' },
          { header: 'Actual' },
          { header: 'Bands out' },
        ],
        rows: compared
          .filter((row) => Math.abs(row.difference ?? 0) >= 2)
          .sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0))
          .slice(0, 200)
          .map((row) => [
            row.rollNumber,
            row.name,
            row.subject,
            row.predicted,
            row.actual,
            row.difference,
          ]),
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export async function buildReport(
  actor: Actor,
  key: ReportKey,
  query: ReportQuery = {},
): Promise<Report> {
  const definition = REPORT_DEFINITIONS[key];
  if (!definition) throw ApiError.notFound('Report not found');
  requireAnyCapability(actor, definition.capabilities);

  switch (key) {
    case 'daily-attendance':
      return dailyAttendance(actor, query);
    case 'academic-performance':
      return academicPerformance(actor, query);
    case 'fee-collection':
      return feeCollection(actor);
    case 'at-risk':
      return atRisk(actor);
    case 'teacher-activity':
      return teacherActivity(actor);
    case 'board-results':
      return boardResults(actor, query);
    default:
      throw ApiError.notFound('Report not found');
  }
}

/** The reports this actor may open, for the index screen. */
export function availableReports(actor: Actor): ReportKey[] {
  return Object.values(REPORT_DEFINITIONS)
    .filter((definition) => canAny(actor, definition.capabilities))
    .map((definition) => definition.key);
}

/** A report's tables as workbook sheets. One sheet per table, in order. */
export function reportToSheets(report: Report): Sheet[] {
  const summary: Sheet = {
    name: 'Summary',
    columns: [
      { header: 'Figure', width: 28 },
      { header: 'Value', width: 24 },
    ],
    rows: [
      ['Report', report.title],
      ['Covering', report.subtitle],
      ['Generated', report.generatedAt],
      ...report.headline.map((entry) => [entry.label, entry.value] as (string | number | null)[]),
    ],
  };

  return [
    summary,
    ...report.tables.map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => ({
        header: column.header,
        ...(column.width ? { width: column.width } : {}),
      })),
      rows: table.rows,
    })),
  ];
}
