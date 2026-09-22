import type { AttendanceStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { getSchoolSettings } from '@/lib/services/school-settings';
import {
  assertCanAccessSection,
  assertCanAccessStudent,
  can,
  type Actor,
} from '@/lib/permissions';
import { addDays, dateOnly, toDateOnly, zonedDateString } from '@/lib/utils/tz';
import { currentAbsenceStreak, tally, withinRollingWindow, type DatedStatus } from './policy';

/**
 * The attendance views, one per audience:
 *
 *   Student — a monthly calendar heatmap and a percentage per subject
 *   Parent  — the same, for their child
 *   Teacher — per-section percentages and a defaulters list
 *   Admin   — campus-wide daily percentage, year-group comparison, and who has not marked
 */

async function currentAcademicYearId(): Promise<string> {
  const year = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (!year) throw ApiError.badRequest('noAcademicYear', 'No academic year is set as current.');
  return year.id;
}

export type DayCell = {
  date: string;
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** null on a day with no sessions — a holiday renders as a gap, not as a zero. */
  percent: number | null;
};

export type SubjectAttendance = {
  subjectCode: string;
  subjectName: string;
  sectionId: string;
  attended: number;
  counted: number;
  percent: number | null;
};

export type StudentAttendance = {
  studentId: string;
  studentName: string;
  from: string;
  to: string;
  overall: { attended: number; counted: number; percent: number | null };
  rolling: { windowDays: number; percent: number | null; belowThreshold: boolean };
  consecutiveAbsences: number;
  calendar: DayCell[];
  bySubject: SubjectAttendance[];
};

export async function getStudentAttendance(
  actor: Actor,
  studentId: string,
  range: { from?: string; to?: string } = {},
): Promise<StudentAttendance> {
  const settings = await getSchoolSettings();
  const to = range.to ?? zonedDateString(new Date(), settings.timezone);
  const from = range.from ?? addDays(to, -180);

  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: {
      id: true,
      user: { select: { name: true } },
      enrolments: { where: { droppedAt: null }, select: { sectionId: true } },
    },
  });
  if (!student) throw ApiError.notFound('Student not found');

  // A teacher may only look at a student in a section they teach; a parent, only their own
  // child. The check uses the student's real sections, not a claim from the request.
  assertCanAccessStudent(
    actor,
    studentId,
    student.enrolments.map((entry) => entry.sectionId),
  );

  const records = await prisma.attendanceRecord.findMany({
    where: {
      studentId,
      session: { date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    },
    select: {
      status: true,
      session: {
        select: {
          date: true,
          section: {
            select: { id: true, subject: { select: { code: true, name: true } } },
          },
        },
      },
    },
  });

  const dated: DatedStatus[] = records.map((record) => ({
    date: dateOnly(record.session.date),
    status: record.status,
  }));

  const overall = tally(dated.map((entry) => entry.status));

  const rollingWindow = withinRollingWindow(dated, to, settings.attendance.rollingWindowDays);
  const rollingTally = tally(rollingWindow.map((entry) => entry.status));

  // Calendar heatmap: one cell per day that actually had sessions.
  const byDate = new Map<string, AttendanceStatus[]>();
  for (const entry of dated) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry.status]);
  }

  const calendar: DayCell[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, statuses]) => {
      const cell = tally(statuses);
      return {
        date,
        present: statuses.filter((status) => status === 'PRESENT').length,
        absent: statuses.filter((status) => status === 'ABSENT').length,
        late: statuses.filter((status) => status === 'LATE').length,
        excused: statuses.filter((status) => status === 'EXCUSED' || status === 'LEAVE').length,
        percent: cell.percent,
      };
    });

  const bySection = new Map<string, { code: string; name: string; statuses: AttendanceStatus[] }>();
  for (const record of records) {
    const section = record.session.section;
    const entry = bySection.get(section.id) ?? {
      code: section.subject.code,
      name: section.subject.name,
      statuses: [],
    };
    entry.statuses.push(record.status);
    bySection.set(section.id, entry);
  }

  const bySubject: SubjectAttendance[] = [...bySection.entries()]
    .map(([sectionId, entry]) => {
      const result = tally(entry.statuses);
      return {
        sectionId,
        subjectCode: entry.code,
        subjectName: entry.name,
        attended: result.attended,
        counted: result.counted,
        percent: result.percent,
      };
    })
    .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  return {
    studentId: student.id,
    studentName: student.user.name,
    from,
    to,
    overall: { attended: overall.attended, counted: overall.counted, percent: overall.percent },
    rolling: {
      windowDays: settings.attendance.rollingWindowDays,
      percent: rollingTally.percent,
      belowThreshold:
        rollingTally.percent !== null &&
        rollingTally.percent < settings.attendance.minimumPercent,
    },
    consecutiveAbsences: currentAbsenceStreak(dated),
    calendar,
    bySubject,
  };
}

export type SectionAttendanceSummary = {
  sectionId: string;
  sectionName: string;
  subjectName: string;
  from: string;
  to: string;
  percent: number | null;
  sessionsMarked: number;
  students: {
    studentId: string;
    name: string;
    rollNumber: string;
    photoUrl: string | null;
    attended: number;
    counted: number;
    percent: number | null;
    belowThreshold: boolean;
    consecutiveAbsences: number;
  }[];
};

/** A teacher's view: how the section is doing, and who is in trouble. */
export async function getSectionAttendance(
  actor: Actor,
  sectionId: string,
  range: { from?: string; to?: string } = {},
): Promise<SectionAttendanceSummary> {
  assertCanAccessSection(actor, sectionId);

  const settings = await getSchoolSettings();
  const to = range.to ?? zonedDateString(new Date(), settings.timezone);
  const from = range.from ?? addDays(to, -settings.attendance.rollingWindowDays + 1);

  const section = await prisma.section.findFirst({
    where: { id: sectionId },
    select: {
      id: true,
      name: true,
      subject: { select: { name: true } },
      enrolments: {
        where: { droppedAt: null },
        select: {
          student: {
            select: {
              id: true,
              rollNumber: true,
              photoUrl: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!section) throw ApiError.notFound('Section not found');

  const [records, sessionsMarked] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: {
        session: {
          sectionId,
          date: { gte: toDateOnly(from), lte: toDateOnly(to) },
        },
      },
      select: { studentId: true, status: true, session: { select: { date: true } } },
    }),
    prisma.attendanceSession.count({
      where: { sectionId, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
    }),
  ]);

  const byStudent = new Map<string, DatedStatus[]>();
  for (const record of records) {
    const list = byStudent.get(record.studentId) ?? [];
    list.push({ date: dateOnly(record.session.date), status: record.status });
    byStudent.set(record.studentId, list);
  }

  const students = section.enrolments
    .map(({ student }) => {
      const entries = byStudent.get(student.id) ?? [];
      const result = tally(entries.map((entry) => entry.status));
      return {
        studentId: student.id,
        name: student.user.name,
        rollNumber: student.rollNumber,
        photoUrl: student.photoUrl,
        attended: result.attended,
        counted: result.counted,
        percent: result.percent,
        belowThreshold:
          result.percent !== null && result.percent < settings.attendance.minimumPercent,
        consecutiveAbsences: currentAbsenceStreak(entries),
      };
    })
    .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));

  const sectionTally = tally(records.map((record) => record.status));

  return {
    sectionId: section.id,
    sectionName: section.name,
    subjectName: section.subject.name,
    from,
    to,
    percent: sectionTally.percent,
    sessionsMarked,
    students,
  };
}

export type DailyAttendanceReport = {
  date: string;
  campus: { attended: number; counted: number; percent: number | null };
  byYearGroup: { yearGroupId: string; name: string; percent: number | null; counted: number }[];
  absentees: {
    studentId: string;
    name: string;
    rollNumber: string;
    yearGroup: string;
    periods: number[];
  }[];
  /** "Teachers who have not marked" — the list principals lean forward for. */
  unmarked: {
    sectionId: string;
    sectionName: string;
    periodIndex: number;
    teacherName: string | null;
    teacherId: string | null;
  }[];
};

export async function getDailyReport(
  actor: Actor,
  date?: string,
): Promise<DailyAttendanceReport> {
  // Campus-wide figures need campus-wide scope. An HOD holds
  // `attendance.read.department`, which is not this report — letting it through here would
  // quietly hand a head of department every year group's numbers.
  if (!can(actor, 'attendance.read.school')) {
    throw ApiError.notFound('Report not available');
  }

  const settings = await getSchoolSettings();
  const day = date ?? zonedDateString(new Date(), settings.timezone);
  const academicYearId = await currentAcademicYearId();
  const dayOfWeek = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;

  /*
   * The year-group breakdown is an aggregate over every record marked today — about four
   * thousand rows at this campus. Pulling them into Node with a nested include and counting
   * them in JavaScript costs ~390ms, over the 300ms budget for a screen the coordinator
   * opens every morning. Postgres does the same work in a few milliseconds.
   *
   * Raw SQL bypasses the tenancy extension, so `school_id` is bound explicitly here. Every
   * raw query in this codebase must do that, and it is why there are so few of them.
   */
  const [totals, absentRecords, expectedSlots, markedSessions, holiday] = await Promise.all([
    prisma.$queryRaw<
      { yearGroupId: string; name: string; attended: bigint; counted: bigint }[]
    >`
      SELECT yg.id   AS "yearGroupId",
             yg.name AS "name",
             COUNT(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE'))            AS "attended",
             COUNT(*) FILTER (WHERE r.status IN ('PRESENT', 'LATE', 'ABSENT'))  AS "counted"
      FROM attendance_records r
      JOIN attendance_sessions s ON s.id = r.session_id
      JOIN sections sec         ON sec.id = s.section_id
      JOIN year_groups yg       ON yg.id = sec.year_group_id
      WHERE r.school_id = ${actor.schoolId}
        AND r.academic_year_id = ${academicYearId}
        AND s.date = ${toDateOnly(day)}::date
      GROUP BY yg.id, yg.name
      ORDER BY yg.name
    `,

    // Only the absences, which is a far smaller set than every record of the day.
    prisma.attendanceRecord.findMany({
      where: { academicYearId, status: 'ABSENT', session: { date: toDateOnly(day) } },
      select: {
        student: { select: { id: true, rollNumber: true, user: { select: { name: true } } } },
        session: {
          select: {
            periodIndex: true,
            section: { select: { yearGroup: { select: { name: true } } } },
          },
        },
      },
    }),

    prisma.timetableSlot.findMany({
      where: { academicYearId, dayOfWeek },
      select: {
        sectionId: true,
        periodIndex: true,
        section: {
          select: {
            name: true,
            teacherId: true,
            teacher: { select: { user: { select: { name: true } } } },
          },
        },
      },
    }),

    prisma.attendanceSession.findMany({
      where: { academicYearId, date: toDateOnly(day) },
      select: { sectionId: true, periodIndex: true },
    }),

    prisma.holiday.findFirst({ where: { academicYearId, date: toDateOnly(day) } }),
  ]);

  const byYearGroup = totals.map((row) => {
    const attended = Number(row.attended);
    const counted = Number(row.counted);
    return {
      yearGroupId: row.yearGroupId,
      name: row.name,
      counted,
      percent: counted === 0 ? null : (attended / counted) * 100,
    };
  });

  const campusAttended = totals.reduce((sum, row) => sum + Number(row.attended), 0);
  const campusCounted = totals.reduce((sum, row) => sum + Number(row.counted), 0);

  const absenteeMap = new Map<
    string,
    { name: string; rollNumber: string; yearGroup: string; periods: number[] }
  >();
  for (const record of absentRecords) {
    const existing = absenteeMap.get(record.student.id) ?? {
      name: record.student.user.name,
      rollNumber: record.student.rollNumber,
      // Taken from the section the period belongs to, which is the year group the student
      // was actually sitting in — not a guess from their first enrolment.
      yearGroup: record.session.section.yearGroup.name,
      periods: [],
    };
    existing.periods.push(record.session.periodIndex);
    absenteeMap.set(record.student.id, existing);
  }

  const markedKeys = new Set(
    markedSessions.map((entry) => `${entry.sectionId}:${entry.periodIndex}`),
  );

  // On a holiday nothing is expected, so nobody is "not marking".
  const unmarked = holiday
    ? []
    : expectedSlots
        .filter((slot) => !markedKeys.has(`${slot.sectionId}:${slot.periodIndex}`))
        .map((slot) => ({
          sectionId: slot.sectionId,
          sectionName: slot.section.name,
          periodIndex: slot.periodIndex,
          teacherName: slot.section.teacher?.user.name ?? null,
          teacherId: slot.section.teacherId,
        }))
        .sort((a, b) => a.periodIndex - b.periodIndex);

  return {
    date: day,
    campus: {
      attended: campusAttended,
      counted: campusCounted,
      percent: campusCounted === 0 ? null : (campusAttended / campusCounted) * 100,
    },
    byYearGroup,
    absentees: [...absenteeMap.entries()]
      .map(([studentId, entry]) => ({
        studentId,
        ...entry,
        periods: entry.periods.sort((a, b) => a - b),
      }))
      .sort((a, b) => b.periods.length - a.periods.length),
    unmarked,
  };
}

export type TeacherComplianceRow = {
  teacherId: string;
  teacherName: string;
  expected: number;
  marked: number;
  percent: number;
};

/** "A teacher-compliance list showing who is not marking." */
export async function getTeacherCompliance(
  actor: Actor,
  range: { from?: string; to?: string } = {},
): Promise<TeacherComplianceRow[]> {
  if (!can(actor, 'report.school')) {
    throw ApiError.notFound('Report not available');
  }

  const settings = await getSchoolSettings();
  const to = range.to ?? zonedDateString(new Date(), settings.timezone);
  const from = range.from ?? addDays(to, -13);
  const academicYearId = await currentAcademicYearId();

  const [slots, sessions, holidays] = await Promise.all([
    prisma.timetableSlot.findMany({
      where: { academicYearId },
      select: {
        sectionId: true,
        periodIndex: true,
        dayOfWeek: true,
        section: {
          select: { teacherId: true, teacher: { select: { user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.attendanceSession.findMany({
      where: { academicYearId, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
      select: { sectionId: true, periodIndex: true, date: true },
    }),
    prisma.holiday.findMany({
      where: { academicYearId, date: { gte: toDateOnly(from), lte: toDateOnly(to) } },
      select: { date: true },
    }),
  ]);

  const holidayDates = new Set(holidays.map((entry) => dateOnly(entry.date)));
  const markedKeys = new Set(
    sessions.map((entry) => `${dateOnly(entry.date)}:${entry.sectionId}:${entry.periodIndex}`),
  );

  const byTeacher = new Map<string, { name: string; expected: number; marked: number }>();

  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (holidayDates.has(date)) continue;
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

    for (const slot of slots) {
      if (slot.dayOfWeek !== dayOfWeek) continue;
      const teacherId = slot.section.teacherId;
      if (!teacherId) continue;

      const entry = byTeacher.get(teacherId) ?? {
        name: slot.section.teacher?.user.name ?? 'Unassigned',
        expected: 0,
        marked: 0,
      };
      entry.expected += 1;
      if (markedKeys.has(`${date}:${slot.sectionId}:${slot.periodIndex}`)) entry.marked += 1;
      byTeacher.set(teacherId, entry);
    }
  }

  return [...byTeacher.entries()]
    .map(([teacherId, entry]) => ({
      teacherId,
      teacherName: entry.name,
      expected: entry.expected,
      marked: entry.marked,
      percent: entry.expected === 0 ? 100 : (entry.marked / entry.expected) * 100,
    }))
    .sort((a, b) => a.percent - b.percent);
}
