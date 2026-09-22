import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ForbiddenError } from '@/lib/permissions';
import { ApiError } from '@/lib/api/errors';
import {
  amendRecord,
  getRegister,
  getTodaysClasses,
  saveRegister,
} from '@/lib/services/attendance/register';
import { syncBatch } from '@/lib/services/attendance/sync';
import {
  getDailyReport,
  getSectionAttendance,
  getStudentAttendance,
  getTeacherCompliance,
} from '@/lib/services/attendance/reports';
import { addDays, dateOnly, zonedDateString } from '@/lib/utils/tz';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';
import type { Actor } from '@/lib/permissions';

let schoolId: string;
let admin: Actor;
let teacher: Actor;
let hod: Actor;
let student: Actor;
let otherStudentId: string;
let sectionId: string;
let today: string;

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  hod = await actorByEmail(schoolId, 'emp-0001@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');
  today = zonedDateString(new Date());

  // A teacher who is only a teacher — emp-0001 is also an HOD, and the two roles see
  // different things.
  const pureTeacherEmail = await asActor(admin, async () => {
    const user = await testPrisma.user.findFirstOrThrow({
      where: {
        roles: { some: { role: 'TEACHER' }, none: { role: 'HOD' } },
        staff: { sections: { some: {} } },
      },
      select: { email: true },
    });
    return user.email!;
  });
  teacher = await actorByEmail(schoolId, pureTeacherEmail);

  sectionId = teacher.sectionIds[0]!;

  await asActor(admin, async () => {
    // Someone else's child, and deliberately not in the section under test — otherwise
    // "not enrolled" would silently be testing nothing.
    const other = await testPrisma.student.findFirstOrThrow({
      where: {
        id: { not: student.studentId! },
        enrolments: { none: { sectionId } },
      },
      select: { id: true },
    });
    otherStudentId = other.id;
  });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('the register', () => {
  /** A day with no session yet, so these assert the default state rather than leftovers. */
  const unmarkedDay = () => addDays(today, 1);

  it('pre-marks every student present so the teacher only taps absentees', async () => {
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date: unmarkedDay(), periodIndex: 1 }),
    );

    expect(register.students.length).toBeGreaterThan(5);
    expect(register.students.every((entry) => entry.status === 'PRESENT')).toBe(true);
    // Teachers identify faces faster than names, so the photo field is part of the payload.
    expect(register.students[0]).toHaveProperty('photoUrl');
    expect(register.students[0]).toHaveProperty('rollNumber');
  });

  it('sorts by roll number, which is the order a teacher reads a class in', async () => {
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date: unmarkedDay(), periodIndex: 1 }),
    );
    const rolls = register.students.map((entry) => entry.rollNumber);
    expect([...rolls].sort((a, b) => a.localeCompare(b))).toEqual(rolls);
  });

  it('refuses a section the teacher does not teach', async () => {
    const foreign = await asActor(admin, async () => {
      const section = await testPrisma.section.findFirstOrThrow({
        where: { id: { notIn: [...teacher.sectionIds] } },
        select: { id: true },
      });
      return section.id;
    });

    await expect(
      asActor(teacher, () =>
        getRegister(teacher, { sectionId: foreign, date: unmarkedDay(), periodIndex: 1 }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses a student trying to open a register at all', async () => {
    await expect(
      asActor(student, () => saveRegister(student, {
        sectionId: student.enrolledSectionIds[0]!,
        date: today,
        periodIndex: 1,
        marks: [{ studentId: student.studentId!, status: 'PRESENT' }],
      })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('marking a register', () => {
  // Today's registers are still inside the 24-hour window; anything older is locked.
  // `today` is read inside each test, because it is set in beforeAll.

  it('writes marks and is safe to submit twice', async () => {
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date: today, periodIndex: 1 }),
    );

    const marks = register.students.map((entry, index) => ({
      studentId: entry.studentId,
      status: index === 0 ? ('ABSENT' as const) : ('PRESENT' as const),
    }));

    const first = await asActor(teacher, () =>
      saveRegister(teacher, { sectionId, date: today, periodIndex: 1, marks }),
    );
    expect(first.results.every((entry) => entry.applied)).toBe(true);

    // A flaky connection retries the same payload; it must update, not duplicate.
    const second = await asActor(teacher, () =>
      saveRegister(teacher, { sectionId, date: today, periodIndex: 1, marks }),
    );
    expect(second.created).toBe(false);

    const sessions = await asActor(admin, () =>
      testPrisma.attendanceSession.count({
        where: { sectionId, date: new Date(`${today}T00:00:00.000Z`), periodIndex: 1 },
      }),
    );
    expect(sessions).toBe(1);

    const reloaded = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date: today, periodIndex: 1 }),
    );
    expect(reloaded.isMarked).toBe(true);
    expect(reloaded.students[0]?.status).toBe('ABSENT');
  });

  it('writes an audit row for a changed mark, and not for an unchanged one', async () => {
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date: today, periodIndex: 2 }),
    );
    const target = register.students[0]!;
    const marks = register.students.map((entry) => ({
      studentId: entry.studentId,
      status: 'PRESENT' as const,
    }));

    await asActor(teacher, () =>
      saveRegister(teacher, { sectionId, date: today, periodIndex: 2, marks }),
    );

    const countAudits = () =>
      asActor(admin, () =>
        testPrisma.auditLog.count({
          where: { entityType: 'AttendanceRecord', entityId: { contains: target.studentId } },
        }),
      );

    const beforeResubmit = await countAudits();
    await asActor(teacher, () =>
      saveRegister(teacher, { sectionId, date: today, periodIndex: 2, marks }),
    );
    // Re-submitting an unchanged register must not bury the real edits in noise.
    expect(await countAudits()).toBe(beforeResubmit);

    await asActor(teacher, () =>
      saveRegister(teacher, {
        sectionId,
        date: today,
        periodIndex: 2,
        marks: marks.map((mark, index) =>
          index === 0 ? { ...mark, status: 'ABSENT' as const } : mark,
        ),
      }),
    );
    expect(await countAudits()).toBe(beforeResubmit + 1);
  });

  it('rejects a mark for a student who is not enrolled, without failing the rest', async () => {
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date: today, periodIndex: 3 }),
    );

    const result = await asActor(teacher, () =>
      saveRegister(teacher, {
        sectionId,
        date: today,
        periodIndex: 3,
        marks: [
          { studentId: register.students[0]!.studentId, status: 'PRESENT' },
          { studentId: otherStudentId, status: 'ABSENT' },
        ],
      }),
    );

    const applied = result.results.filter((entry) => entry.applied);
    const rejected = result.results.filter((entry) => !entry.applied);
    expect(applied).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('notEnrolled');
  });

  it('locks a register 24 hours after the period and refuses a teacher\'s edit', async () => {
    // Deep in the seeded history, long past the lock window.
    const old = await asActor(admin, () =>
      testPrisma.attendanceSession.findFirstOrThrow({
        where: { sectionId },
        orderBy: { date: 'asc' },
        select: { date: true, periodIndex: true },
      }),
    );
    const oldDate = dateOnly(old.date);

    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date: oldDate, periodIndex: old.periodIndex }),
    );
    expect(register.isLocked).toBe(true);
    expect(register.canMark).toBe(false);

    await expect(
      asActor(teacher, () =>
        saveRegister(teacher, {
          sectionId,
          date: oldDate,
          periodIndex: old.periodIndex,
          marks: [{ studentId: register.students[0]!.studentId, status: 'ABSENT' }],
        }),
      ),
    ).rejects.toMatchObject({ status: 423, code: 'registerLocked' });
  });
});

describe('amending a locked register', () => {
  it('lets an admin amend with a reason and records who changed what', async () => {
    const record = await asActor(admin, () =>
      testPrisma.attendanceRecord.findFirstOrThrow({
        where: { status: 'ABSENT', amendedAt: null },
        select: { id: true, status: true, studentId: true },
      }),
    );

    const result = await asActor(admin, () =>
      amendRecord(admin, record.id, { status: 'EXCUSED', reason: 'Medical certificate produced' }),
    );
    expect(result.status).toBe('EXCUSED');

    const audit = await asActor(admin, () =>
      testPrisma.auditLog.findFirstOrThrow({
        where: { entityType: 'AttendanceRecord', entityId: record.id, action: 'attendance.amend' },
        orderBy: { createdAt: 'desc' },
      }),
    );

    // This is the row that answers "who changed my son's attendance, and what was it before".
    expect(audit.reason).toBe('Medical certificate produced');
    expect(audit.beforeJson).toMatchObject({ status: 'ABSENT' });
    expect(audit.afterJson).toMatchObject({ status: 'EXCUSED' });
    expect(audit.actorUserId).toBe(admin.userId);
  });

  it('refuses a teacher, even for their own section', async () => {
    const record = await asActor(admin, () =>
      testPrisma.attendanceRecord.findFirstOrThrow({
        where: { session: { sectionId } },
        select: { id: true },
      }),
    );

    await expect(
      asActor(teacher, () => amendRecord(teacher, record.id, { status: 'PRESENT', reason: 'Mistake' })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('offline sync', () => {
  it('preserves the period timestamp rather than the moment it reconnected', async () => {
    const date = today;
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date, periodIndex: 4 }),
    );

    // Marked in a lab at 08:05 Pakistan time; synced now.
    const markedAt = new Date(`${date}T03:05:00.000Z`);

    const result = await asActor(teacher, () =>
      syncBatch(teacher, {
        batchId: randomUUID(),
        registers: [
          {
            sectionId,
            date,
            periodIndex: 4,
            markedAt: markedAt.toISOString(),
            deviceId: 'pixel-5-lab',
            marks: register.students.map((entry) => ({
              studentId: entry.studentId,
              status: 'PRESENT' as const,
            })),
          },
        ],
      }),
    );

    expect(result.registers[0]?.status).toBe('applied');

    const session = await asActor(admin, () =>
      testPrisma.attendanceSession.findFirstOrThrow({
        where: { sectionId, date: new Date(`${date}T00:00:00.000Z`), periodIndex: 4 },
        select: { markedAt: true, syncedAt: true, deviceId: true },
      }),
    );

    expect(session.markedAt?.toISOString()).toBe(markedAt.toISOString());
    expect(session.deviceId).toBe('pixel-5-lab');
    // The sync time is recorded separately, not in place of the period timestamp.
    expect(session.syncedAt!.getTime()).toBeGreaterThan(session.markedAt!.getTime());
  });

  it('is idempotent: replaying a batch does not write twice', async () => {
    const date = today;
    const batchId = randomUUID();
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date, periodIndex: 5 }),
    );

    const payload = {
      batchId,
      registers: [
        {
          sectionId,
          date,
          periodIndex: 5,
          markedAt: new Date(`${date}T03:05:00.000Z`).toISOString(),
          marks: register.students.map((entry) => ({
            studentId: entry.studentId,
            status: 'PRESENT' as const,
          })),
        },
      ],
    };

    const first = await asActor(teacher, () => syncBatch(teacher, payload));
    expect(first.replayed).toBe(false);

    const replay = await asActor(teacher, () => syncBatch(teacher, payload));
    expect(replay.replayed).toBe(true);
    expect(replay.registers[0]?.status).toBe('applied');
  });

  it('keeps the earliest mark when two devices queued the same period', async () => {
    const date = today;
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date, periodIndex: 6 }),
    );
    const marks = register.students.map((entry) => ({
      studentId: entry.studentId,
      status: 'PRESENT' as const,
    }));

    const later = new Date(`${date}T03:40:00.000Z`);
    const earlier = new Date(`${date}T03:05:00.000Z`);

    // The device that reconnects first carries the later mark.
    await asActor(teacher, () =>
      syncBatch(teacher, {
        batchId: randomUUID(),
        registers: [{ sectionId, date, periodIndex: 6, markedAt: later.toISOString(), marks }],
      }),
    );
    await asActor(teacher, () =>
      syncBatch(teacher, {
        batchId: randomUUID(),
        registers: [{ sectionId, date, periodIndex: 6, markedAt: earlier.toISOString(), marks }],
      }),
    );

    const session = await asActor(admin, () =>
      testPrisma.attendanceSession.findFirstOrThrow({
        where: { sectionId, date: new Date(`${date}T00:00:00.000Z`), periodIndex: 6 },
        select: { markedAt: true },
      }),
    );
    expect(session.markedAt?.toISOString()).toBe(earlier.toISOString());
  });

  it('reports per-register results rather than one success flag', async () => {
    const date = today;
    const register = await asActor(teacher, () =>
      getRegister(teacher, { sectionId, date, periodIndex: 7 }),
    );

    const foreignSection = await asActor(admin, () =>
      testPrisma.section
        .findFirstOrThrow({ where: { id: { notIn: [...teacher.sectionIds] } }, select: { id: true } })
        .then((section) => section.id),
    );

    const result = await asActor(teacher, () =>
      syncBatch(teacher, {
        batchId: randomUUID(),
        registers: [
          {
            sectionId,
            date,
            periodIndex: 7,
            marks: register.students.map((entry) => ({
              studentId: entry.studentId,
              status: 'PRESENT' as const,
            })),
          },
          {
            // Not this teacher's section — one bad register must not strand the queue.
            sectionId: foreignSection,
            date,
            periodIndex: 7,
            marks: [{ studentId: otherStudentId, status: 'PRESENT' as const }],
          },
        ],
      }),
    );

    expect(result.registers).toHaveLength(2);
    expect(result.registers[0]?.status).toBe('applied');
    expect(result.registers[1]?.status).toBe('failed');
  });
});

describe('attendance views', () => {
  it('gives a student their own calendar and per-subject percentages', async () => {
    const view = await asActor(student, () => getStudentAttendance(student, student.studentId!));

    expect(view.calendar.length).toBeGreaterThan(50);
    expect(view.bySubject.length).toBeGreaterThanOrEqual(3);
    expect(view.overall.percent).toBeGreaterThan(50);
    expect(view.overall.percent).toBeLessThanOrEqual(100);
    for (const subject of view.bySubject) {
      expect(subject.percent).not.toBeNull();
    }
  });

  it('never lets a student read another student\'s attendance', async () => {
    // The isolation rule, on a real endpoint with a real id.
    await expect(
      asActor(student, () => getStudentAttendance(student, otherStudentId)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a parent read their own child and nobody else', async () => {
    const guardianUserId = await asActor(admin, async () => {
      const link = await testPrisma.guardianStudent.findFirstOrThrow({
        where: { studentId: student.studentId! },
        select: { guardian: { select: { userId: true } } },
      });
      return link.guardian.userId;
    });

    const { resolveActor } = await import('@/lib/permissions/resolve');
    const parent = await asActor(admin, () => resolveActor(guardianUserId));
    expect(parent).not.toBeNull();

    const view = await asActor(parent!, () => getStudentAttendance(parent!, student.studentId!));
    expect(view.studentId).toBe(student.studentId);

    await expect(
      asActor(parent!, () => getStudentAttendance(parent!, otherStudentId)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('gives a teacher section percentages with the defaulters first', async () => {
    const summary = await asActor(teacher, () => getSectionAttendance(teacher, sectionId));

    expect(summary.students.length).toBeGreaterThan(5);
    expect(summary.sessionsMarked).toBeGreaterThan(0);

    // Sorted worst-first: the list exists to find the students in trouble.
    const percents = summary.students.map((entry) => entry.percent ?? 101);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  it('gives an admin the campus picture and who has not marked', async () => {
    const report = await asActor(admin, () => getDailyReport(admin, '2026-09-14'));

    expect(report.campus.percent).toBeGreaterThan(50);
    expect(report.byYearGroup.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(report.absentees)).toBe(true);
    // Around 4% of registers go unmarked in the seed, so this list is never empty —
    // which is the point of having it.
    expect(report.unmarked.length).toBeGreaterThan(0);
  });

  it('expects nothing from teachers on a holiday', async () => {
    const holiday = await asActor(admin, () =>
      testPrisma.holiday.findFirstOrThrow({ select: { date: true } }),
    );
    const report = await asActor(admin, () => getDailyReport(admin, dateOnly(holiday.date)));
    expect(report.unmarked).toEqual([]);
  });

  it('refuses a teacher the campus-wide report', async () => {
    await expect(asActor(teacher, () => getDailyReport(teacher))).rejects.toBeInstanceOf(ApiError);
  });

  it('refuses an HOD the campus-wide report, who sees their department not the campus', async () => {
    await expect(asActor(hod, () => getDailyReport(hod))).rejects.toBeInstanceOf(ApiError);
    await expect(asActor(hod, () => getTeacherCompliance(hod))).rejects.toBeInstanceOf(ApiError);
  });

  it('ranks teacher marking compliance worst-first', async () => {
    const rows = await asActor(admin, () => getTeacherCompliance(admin));
    expect(rows.length).toBeGreaterThan(10);

    const percents = rows.map((row) => row.percent);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    for (const row of rows) {
      expect(row.marked).toBeLessThanOrEqual(row.expected);
    }
  });
});

describe('a teacher\'s day', () => {
  it('lists today\'s classes with what is already marked', async () => {
    const classes = await asActor(teacher, () => getTodaysClasses(teacher));

    for (const entry of classes) {
      expect(entry.studentCount).toBeGreaterThan(0);
      expect(entry.periodIndex).toBeGreaterThanOrEqual(1);
      expect(typeof entry.isMarked).toBe('boolean');
    }
    // Ordered by period — the teacher's day runs in order.
    const periods = classes.map((entry) => entry.periodIndex);
    expect([...periods].sort((a, b) => a - b)).toEqual(periods);
  });
});
