import type { AttendanceStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { writeAudit, writeAuditMany } from '@/lib/services/audit';
import { getSchoolSettings } from '@/lib/services/school-settings';
import {
  assertCanAccessSection,
  canMarkSection,
  ForbiddenError,
  hasRole,
  type Actor,
} from '@/lib/permissions';
import { dateOnly, toDateOnly, zonedDateString, zonedDayOfWeek, zonedTimeString } from '@/lib/utils/tz';
import { isLocked, lockDeadline, shouldOverwrite } from './policy';

export const attendanceStatusSchema = z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'LEAVE']);

export const markSchema = z.object({
  studentId: z.string().uuid(),
  status: attendanceStatusSchema,
  minutesLate: z.number().int().min(0).max(600).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const saveRegisterSchema = z.object({
  sectionId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodIndex: z.number().int().min(1).max(20),
  /**
   * When the register was actually marked — supplied by the client so an offline register
   * keeps the period's own timestamp instead of the moment it reconnected.
   */
  markedAt: z.string().datetime().optional(),
  deviceId: z.string().max(128).optional(),
  marks: z.array(markSchema).min(1).max(200),
});

export type SaveRegisterInput = z.infer<typeof saveRegisterSchema>;

export type RegisterStudent = {
  studentId: string;
  name: string;
  rollNumber: string;
  /** Teachers identify faces faster than names. */
  photoUrl: string | null;
  status: AttendanceStatus;
  minutesLate: number | null;
  note: string | null;
};

export type Register = {
  sectionId: string;
  sectionName: string;
  subjectName: string;
  subjectCode: string;
  date: string;
  periodIndex: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  roomName: string | null;
  students: RegisterStudent[];
  isMarked: boolean;
  markedAt: string | null;
  markedByName: string | null;
  /** After this instant only an Admin may amend, and only with a reason. */
  locksAt: string;
  isLocked: boolean;
  canMark: boolean;
  canAmend: boolean;
};

async function loadPeriod(periodIndex: number) {
  const period = await prisma.period.findFirst({ where: { index: periodIndex } });
  if (!period) throw ApiError.badRequest('unknownPeriod', `There is no period ${periodIndex}.`);
  return period;
}

/**
 * The register a teacher sees. Every student is pre-marked present — the teacher taps only
 * the absentees, which is what gets a 30-student register done in under 15 seconds.
 */
export async function getRegister(
  actor: Actor,
  input: { sectionId: string; date: string; periodIndex: number },
): Promise<Register> {
  assertCanAccessSection(actor, input.sectionId);

  const [settings, period, section] = await Promise.all([
    getSchoolSettings(),
    loadPeriod(input.periodIndex),
    prisma.section.findFirst({
      where: { id: input.sectionId },
      select: {
        id: true,
        name: true,
        subject: { select: { name: true, code: true } },
        room: { select: { name: true } },
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
    }),
  ]);

  if (!section) throw ApiError.notFound('Section not found');

  const session = await prisma.attendanceSession.findFirst({
    where: {
      sectionId: input.sectionId,
      date: toDateOnly(input.date),
      periodIndex: input.periodIndex,
    },
    select: {
      id: true,
      markedAt: true,
      markedBy: { select: { user: { select: { name: true } } } },
      records: {
        select: { studentId: true, status: true, minutesLate: true, note: true },
      },
    },
  });

  const existing = new Map(session?.records.map((record) => [record.studentId, record]) ?? []);

  const students: RegisterStudent[] = section.enrolments
    .map(({ student }) => {
      const record = existing.get(student.id);
      return {
        studentId: student.id,
        name: student.user.name,
        rollNumber: student.rollNumber,
        photoUrl: student.photoUrl,
        // Pre-marked present: the default costs the teacher no taps for the usual case.
        status: record?.status ?? ('PRESENT' as AttendanceStatus),
        minutesLate: record?.minutesLate ?? null,
        note: record?.note ?? null,
      };
    })
    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber));

  const locked = isLocked(
    input.date,
    period.endTime,
    new Date(),
    settings.attendance.lockWindowHours,
    settings.timezone,
  );

  return {
    sectionId: section.id,
    sectionName: section.name,
    subjectName: section.subject.name,
    subjectCode: section.subject.code,
    date: input.date,
    periodIndex: input.periodIndex,
    periodLabel: period.label,
    startTime: period.startTime,
    endTime: period.endTime,
    roomName: section.room?.name ?? null,
    students,
    isMarked: session !== null,
    markedAt: session?.markedAt?.toISOString() ?? null,
    markedByName: session?.markedBy?.user.name ?? null,
    locksAt: lockDeadline(
      input.date,
      period.endTime,
      settings.attendance.lockWindowHours,
      settings.timezone,
    ).toISOString(),
    isLocked: locked,
    canMark: canMarkSection(actor, input.sectionId) && !locked,
    canAmend: hasRole(actor, 'ADMIN'),
  };
}

export type SaveRegisterResult = {
  sessionId: string;
  created: boolean;
  /** Per-student outcome — bulk endpoints return per-row results, not one success flag. */
  results: { studentId: string; applied: boolean; reason?: string }[];
};

/**
 * Writes a register.
 *
 * Safe to call twice with the same payload: the session is keyed on
 * (section, date, period) and each record on (session, student), so a retry from a flaky
 * connection updates rather than duplicates.
 */
export async function saveRegister(
  actor: Actor,
  input: SaveRegisterInput,
): Promise<SaveRegisterResult> {
  if (!canMarkSection(actor, input.sectionId)) {
    throw new ForbiddenError('You do not teach this section');
  }

  const [settings, period, section] = await Promise.all([
    getSchoolSettings(),
    loadPeriod(input.periodIndex),
    prisma.section.findFirst({
      where: { id: input.sectionId },
      select: {
        id: true,
        academicYearId: true,
        enrolments: { where: { droppedAt: null }, select: { studentId: true } },
      },
    }),
  ]);

  if (!section) throw ApiError.notFound('Section not found');

  const locked = isLocked(
    input.date,
    period.endTime,
    new Date(),
    settings.attendance.lockWindowHours,
    settings.timezone,
  );
  // Past the window the register is history. An Admin amends single records, with a reason.
  if (locked && !hasRole(actor, 'ADMIN')) {
    throw ApiError.locked(
      'registerLocked',
      'This register locked 24 hours after the period. Ask a coordinator to amend it.',
    );
  }

  const markedAt = input.markedAt ? new Date(input.markedAt) : new Date();
  const enrolled = new Set(section.enrolments.map((entry) => entry.studentId));

  /*
   * "Earliest timestamp wins" is the rule for reconciling two offline queues, not for a
   * teacher fixing a register they are looking at. A client only sends `markedAt` when it
   * is replaying something marked earlier on a device; a direct save has no such claim and
   * is simply the teacher's current intent, so it applies.
   */
  const isOfflineReplay = input.markedAt !== undefined;

  const existingSession = await prisma.attendanceSession.findFirst({
    where: {
      sectionId: input.sectionId,
      date: toDateOnly(input.date),
      periodIndex: input.periodIndex,
    },
    select: { id: true, markedAt: true },
  });

  // Two devices can mark the same period offline; the earliest wins.
  const overwrite = isOfflineReplay ? shouldOverwrite(existingSession, markedAt) : true;

  const session = existingSession
    ? await prisma.attendanceSession.update({
        where: { id: existingSession.id },
        data: {
          syncedAt: new Date(),
          ...(overwrite
            ? {
                markedAt,
                markedByStaffId: actor.staffId ?? null,
                deviceId: input.deviceId ?? null,
              }
            : {}),
        },
      })
    : await prisma.attendanceSession.create({
        data: {
          // Writes name the tenant explicitly: Prisma's types require it, so it cannot be
          // forgotten, and the tenancy extension rejects it if it is the wrong one.
          schoolId: actor.schoolId,
          academicYearId: section.academicYearId,
          sectionId: input.sectionId,
          date: toDateOnly(input.date),
          periodIndex: input.periodIndex,
          markedByStaffId: actor.staffId ?? null,
          markedAt,
          syncedAt: new Date(),
          deviceId: input.deviceId ?? null,
        },
      });

  const results: SaveRegisterResult['results'] = [];
  const audits: Parameters<typeof writeAuditMany>[1][number][] = [];

  for (const mark of input.marks) {
    if (!enrolled.has(mark.studentId)) {
      // A student who dropped the subject is not silently added back to it.
      results.push({ studentId: mark.studentId, applied: false, reason: 'notEnrolled' });
      continue;
    }

    if (!overwrite && existingSession) {
      results.push({ studentId: mark.studentId, applied: false, reason: 'supersededByEarlierMark' });
      continue;
    }

    const previous = await prisma.attendanceRecord.findFirst({
      where: { sessionId: session.id, studentId: mark.studentId },
      select: { id: true, status: true, minutesLate: true, note: true },
    });

    await prisma.attendanceRecord.upsert({
      where: { sessionId_studentId: { sessionId: session.id, studentId: mark.studentId } },
      create: {
        schoolId: actor.schoolId,
        academicYearId: section.academicYearId,
        sessionId: session.id,
        studentId: mark.studentId,
        status: mark.status,
        minutesLate: mark.minutesLate ?? null,
        note: mark.note ?? null,
      },
      update: {
        status: mark.status,
        minutesLate: mark.minutesLate ?? null,
        note: mark.note ?? null,
      },
    });

    results.push({ studentId: mark.studentId, applied: true });

    // Only a change is worth an audit row; re-submitting the same register would otherwise
    // bury the real edits.
    if (!previous || previous.status !== mark.status) {
      audits.push({
        action: previous ? 'attendance.update' : 'attendance.mark',
        entityType: 'AttendanceRecord',
        entityId: `${session.id}:${mark.studentId}`,
        before: previous ? { status: previous.status } : undefined,
        after: { status: mark.status, minutesLate: mark.minutesLate ?? null },
      });
    }
  }

  await writeAuditMany(actor, audits);

  return { sessionId: session.id, created: existingSession === null, results };
}

export const amendSchema = z.object({
  status: attendanceStatusSchema,
  minutesLate: z.number().int().min(0).max(600).nullable().optional(),
  /** Mandatory. An amendment with no explanation is what a disputed record looks like. */
  reason: z.string().min(3).max(500),
});

/**
 * Amends a single record after the register has locked. Admin only, reason required, and
 * the audit row is the whole point: "an admin can answer who changed my son's mark on 14
 * October and what was it before".
 */
export async function amendRecord(
  actor: Actor,
  recordId: string,
  input: z.infer<typeof amendSchema>,
) {
  if (!hasRole(actor, 'ADMIN')) {
    throw new ForbiddenError('Only a coordinator can amend a locked register');
  }

  const record = await prisma.attendanceRecord.findFirst({
    where: { id: recordId },
    select: {
      id: true,
      status: true,
      minutesLate: true,
      studentId: true,
      session: { select: { id: true, date: true, periodIndex: true, sectionId: true } },
    },
  });
  if (!record) throw ApiError.notFound('Attendance record not found');

  const updated = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data: {
      status: input.status,
      minutesLate: input.minutesLate ?? null,
      amendedByStaffId: actor.staffId ?? null,
      amendedAt: new Date(),
      amendReason: input.reason,
    },
  });

  await writeAudit(actor, {
    action: 'attendance.amend',
    entityType: 'AttendanceRecord',
    entityId: record.id,
    before: { status: record.status, minutesLate: record.minutesLate },
    after: { status: updated.status, minutesLate: updated.minutesLate },
    reason: input.reason,
  });

  return {
    id: updated.id,
    status: updated.status,
    date: dateOnly(record.session.date),
    periodIndex: record.session.periodIndex,
  };
}

export type TodayClass = {
  sectionId: string;
  sectionName: string;
  subjectName: string;
  subjectCode: string;
  periodIndex: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  roomName: string | null;
  studentCount: number;
  isMarked: boolean;
  /** Set when someone else is covering this period today. */
  coveringForName: string | null;
  isCurrent: boolean;
};

/**
 * "Open app → today's classes are already on the dashboard."
 *
 * One query for the timetable, one for what is already marked — the teacher's first screen
 * must not fan out into a query per class.
 */
export async function getTodaysClasses(
  actor: Actor,
  options: { date?: string; staffId?: string } = {},
): Promise<TodayClass[]> {
  const settings = await getSchoolSettings();
  const now = new Date();
  const date = options.date ?? zonedDateString(now, settings.timezone);
  const dayOfWeek = zonedDayOfWeek(new Date(`${date}T12:00:00Z`), settings.timezone);
  const staffId = options.staffId ?? actor.staffId;

  if (!staffId) return [];
  if (options.staffId && options.staffId !== actor.staffId && !hasRole(actor, 'ADMIN')) {
    throw new ForbiddenError('You can only see your own timetable');
  }

  const substitutions = await prisma.substitution.findMany({
    where: { date: toDateOnly(date), coverStaffId: staffId },
    select: {
      sectionId: true,
      timetableSlotId: true,
      original: { select: { user: { select: { name: true } } } },
    },
  });
  const coveringSlotIds = new Set(substitutions.map((entry) => entry.timetableSlotId));

  // Periods the teacher is handing over today are not on their own list.
  const handedOver = await prisma.substitution.findMany({
    where: { date: toDateOnly(date), originalStaffId: staffId },
    select: { timetableSlotId: true },
  });
  const handedOverSlotIds = new Set(handedOver.map((entry) => entry.timetableSlotId));

  const slots = await prisma.timetableSlot.findMany({
    where: {
      dayOfWeek,
      OR: [{ section: { teacherId: staffId } }, { id: { in: [...coveringSlotIds] } }],
    },
    select: {
      id: true,
      periodIndex: true,
      startTime: true,
      endTime: true,
      sectionId: true,
      room: { select: { name: true } },
      section: {
        select: {
          name: true,
          subject: { select: { name: true, code: true } },
          _count: { select: { enrolments: { where: { droppedAt: null } } } },
        },
      },
    },
    orderBy: { periodIndex: 'asc' },
  });

  const visible = slots.filter((slot) => !handedOverSlotIds.has(slot.id));

  const marked = await prisma.attendanceSession.findMany({
    where: {
      date: toDateOnly(date),
      sectionId: { in: visible.map((slot) => slot.sectionId) },
    },
    select: { sectionId: true, periodIndex: true },
  });
  const markedKeys = new Set(marked.map((entry) => `${entry.sectionId}:${entry.periodIndex}`));

  const periods = await prisma.period.findMany({ orderBy: { index: 'asc' } });
  const periodLabels = new Map(periods.map((period) => [period.index, period.label]));
  const clock = zonedTimeString(now, settings.timezone);
  const isToday = date === zonedDateString(now, settings.timezone);

  const coveringBySlot = new Map(
    substitutions.map((entry) => [entry.timetableSlotId, entry.original?.user.name ?? null]),
  );

  return visible.map((slot) => ({
    sectionId: slot.sectionId,
    sectionName: slot.section.name,
    subjectName: slot.section.subject.name,
    subjectCode: slot.section.subject.code,
    periodIndex: slot.periodIndex,
    periodLabel: periodLabels.get(slot.periodIndex) ?? `Period ${slot.periodIndex}`,
    startTime: slot.startTime,
    endTime: slot.endTime,
    roomName: slot.room?.name ?? null,
    studentCount: slot.section._count.enrolments,
    isMarked: markedKeys.has(`${slot.sectionId}:${slot.periodIndex}`),
    coveringForName: coveringSlotIds.has(slot.id) ? (coveringBySlot.get(slot.id) ?? null) : null,
    isCurrent: isToday && clock >= slot.startTime && clock < slot.endTime,
  }));
}
