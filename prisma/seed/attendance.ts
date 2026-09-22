import { randomUUID } from 'node:crypto';
import type { AttendanceStatus, PrismaClient } from '@prisma/client';
import type { Rng } from './random';

/**
 * Attendance history for the demo tenant.
 *
 * "180 days of attendance history with believable patterns: a 92% average, a few chronic
 * absentees, higher absence on Mondays and before holidays."
 *
 * The patterns matter as much as the volume. A flat 92% everywhere produces a defaulters
 * list that is empty and a heatmap that is one solid colour, which tells a coordinator
 * nothing and sells nothing.
 */

export type SeedSection = {
  id: string;
  teacherStaffId: string;
  studentIds: string[];
};

export type SeedSlot = {
  sectionId: string;
  dayOfWeek: number;
  periodIndex: number;
  endTime: string;
};

export type AttendanceSeedOptions = {
  schoolId: string;
  academicYearId: string;
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive, `YYYY-MM-DD`. */
  to: string;
  holidays: ReadonlySet<string>;
  sections: readonly SeedSection[];
  slots: readonly SeedSlot[];
  lockWindowHours: number;
};

export type AttendanceSeedResult = {
  schoolDays: number;
  sessions: number;
  records: number;
  attendedPercent: number;
  chronicAbsentees: number;
};

const CHRONIC_ABSENTEE_SHARE = 0.03;

function addDays(date: string, days: number): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday, matching TimetableSlot.dayOfWeek. */
function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
}

export async function seedAttendance(
  prisma: PrismaClient,
  rng: Rng,
  options: AttendanceSeedOptions,
): Promise<AttendanceSeedResult> {
  const slotsByDay = new Map<number, SeedSlot[]>();
  for (const slot of options.slots) {
    slotsByDay.set(slot.dayOfWeek, [...(slotsByDay.get(slot.dayOfWeek) ?? []), slot]);
  }

  const sectionById = new Map(options.sections.map((section) => [section.id, section]));

  /**
   * Each student gets a personal attendance propensity, so the same handful of names keep
   * appearing on the defaulters list across the term — which is what makes the list look
   * like a real school rather than random noise.
   */
  const propensity = new Map<string, number>();
  let chronicAbsentees = 0;
  for (const section of options.sections) {
    for (const studentId of section.studentIds) {
      if (propensity.has(studentId)) continue;
      if (rng.bool(CHRONIC_ABSENTEE_SHARE)) {
        propensity.set(studentId, rng.normal(0.66, 0.06, 0.45, 0.8));
        chronicAbsentees += 1;
      } else {
        /*
         * Tuned so the headline figure lands on the spec's 92%. Note the arithmetic:
         * authorised absence is excluded from the denominator, so the reported percentage
         * is higher than the raw attend-probability. p / (p + 0.8·(1−p)) = 0.92 needs
         * p ≈ 0.90 across the cohort, not 0.92.
         */
        propensity.set(studentId, rng.normal(0.917, 0.035, 0.8, 1));
      }
    }
  }

  const pendingSessions: SessionRow[] = [];
  const pendingRecords: RecordRow[] = [];

  let schoolDays = 0;
  let sessions = 0;
  let records = 0;
  let attended = 0;
  let counted = 0;

  const now = Date.now();

  for (let date = options.from; date <= options.to; date = addDays(date, 1)) {
    if (options.holidays.has(date)) continue;
    const day = dayOfWeek(date);
    // Sunday is not a teaching day on a 6-day week.
    if (day === 7) continue;

    const daySlots = slotsByDay.get(day) ?? [];
    if (daySlots.length === 0) continue;
    schoolDays += 1;

    // Mondays run higher absence, and so does the day before a holiday — the two patterns
    // every head of school will recognise on sight.
    const isMonday = day === 1;
    const beforeHoliday = options.holidays.has(addDays(date, 1));
    const dayPenalty = (isMonday ? 0.035 : 0) + (beforeHoliday ? 0.06 : 0);

    const sessionRows: SessionRow[] = [];
    const recordRows: RecordRow[] = [];

    for (const slot of daySlots) {
      const section = sectionById.get(slot.sectionId);
      if (!section || section.studentIds.length === 0) continue;

      // A few registers go unmarked, which is the whole point of the teacher-compliance
      // list — with 100% marking it would always be empty.
      if (rng.bool(0.04)) continue;

      const sessionId = randomUUID();
      const periodEnd = new Date(`${date}T${slot.endTime}:00.000Z`);
      // Registers are usually submitted during or just after the period.
      const markedAt = new Date(periodEnd.getTime() - rng.int(0, 20) * 60_000);
      const locksAt = new Date(periodEnd.getTime() + options.lockWindowHours * 3_600_000);

      sessionRows.push({
        id: sessionId,
        sectionId: slot.sectionId,
        date,
        periodIndex: slot.periodIndex,
        markedByStaffId: section.teacherStaffId,
        markedAt,
        lockedAt: locksAt.getTime() <= now ? locksAt : null,
      });
      sessions += 1;

      for (const studentId of section.studentIds) {
        const base = propensity.get(studentId) ?? 0.95;
        const attends = rng.bool(Math.max(0, base - dayPenalty));

        let status: AttendanceStatus;
        if (attends) {
          status = rng.bool(0.05) ? 'LATE' : 'PRESENT';
        } else {
          const roll = rng.next();
          status = roll < 0.8 ? 'ABSENT' : roll < 0.9 ? 'LEAVE' : 'EXCUSED';
        }

        if (status === 'PRESENT' || status === 'LATE') {
          attended += 1;
          counted += 1;
        } else if (status === 'ABSENT') {
          counted += 1;
        }

        recordRows.push({
          sessionId,
          studentId,
          status,
          minutesLate: status === 'LATE' ? rng.int(3, 25) : null,
        });
        records += 1;
      }
    }

    pendingSessions.push(...sessionRows);
    pendingRecords.push(...recordRows);

    // Flushed on a row budget rather than per day, so the number of round trips is driven
    // by data volume instead of by how long the history happens to be.
    if (pendingRecords.length >= FLUSH_EVERY_ROWS) {
      await flushSessions(prisma, options, pendingSessions);
      await flushRecords(prisma, options, pendingRecords);
      pendingSessions.length = 0;
      pendingRecords.length = 0;
    }
  }

  await flushSessions(prisma, options, pendingSessions);
  await flushRecords(prisma, options, pendingRecords);

  return {
    schoolDays,
    sessions,
    records,
    attendedPercent: counted === 0 ? 0 : (attended / counted) * 100,
    chronicAbsentees,
  };
}


type SessionRow = {
  id: string;
  sectionId: string;
  date: string;
  periodIndex: number;
  markedByStaffId: string;
  markedAt: Date;
  lockedAt: Date | null;
};

type RecordRow = {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  minutesLate: number | null;
};

/**
 * Half a million attendance records is a real volume, and `createMany` sends every column
 * of every row as a bind parameter — which is what pushed the seed past its 60-second
 * budget. These two writers send one statement per batch with a handful of array
 * parameters and let Postgres expand them, which is roughly an order of magnitude faster.
 *
 * `id` and `updated_at` are supplied explicitly because Prisma generates both client-side:
 * neither column carries a database default.
 */
const FLUSH_EVERY_ROWS = 100_000;

async function flushSessions(
  prisma: PrismaClient,
  options: AttendanceSeedOptions,
  rows: readonly SessionRow[],
): Promise<void> {
  if (rows.length === 0) return;

  await prisma.$executeRaw`
    INSERT INTO attendance_sessions
      (id, school_id, academic_year_id, section_id, date, period_index,
       marked_by_staff_id, marked_at, synced_at, locked_at, created_at, updated_at)
    SELECT
      t.id, ${options.schoolId}, ${options.academicYearId}, t.section_id, t.date::date,
      t.period_index, t.marked_by, t.marked_at, t.marked_at, t.locked_at, now(), now()
    FROM unnest(
      ${rows.map((row) => row.id)}::text[],
      ${rows.map((row) => row.sectionId)}::text[],
      ${rows.map((row) => row.date)}::text[],
      ${rows.map((row) => row.periodIndex)}::int[],
      ${rows.map((row) => row.markedByStaffId)}::text[],
      ${rows.map((row) => row.markedAt)}::timestamp[],
      ${rows.map((row) => row.lockedAt)}::timestamp[]
    ) AS t(id, section_id, date, period_index, marked_by, marked_at, locked_at)
  `;
}

async function flushRecords(
  prisma: PrismaClient,
  options: AttendanceSeedOptions,
  rows: readonly RecordRow[],
): Promise<void> {
  if (rows.length === 0) return;

  for (let index = 0; index < rows.length; index += FLUSH_EVERY_ROWS) {
    const batch = rows.slice(index, index + FLUSH_EVERY_ROWS);
    await prisma.$executeRaw`
      INSERT INTO attendance_records
        (id, school_id, academic_year_id, session_id, student_id, status,
         minutes_late, created_at, updated_at)
      SELECT
        gen_random_uuid()::text, ${options.schoolId}, ${options.academicYearId},
        t.session_id, t.student_id, t.status::text::"AttendanceStatus", t.minutes_late,
        now(), now()
      FROM unnest(
        ${batch.map((row) => row.sessionId)}::text[],
        ${batch.map((row) => row.studentId)}::text[],
        ${batch.map((row) => String(row.status))}::text[],
        ${batch.map((row) => row.minutesLate)}::int[]
      ) AS t(session_id, student_id, status, minutes_late)
    `;
  }
}
