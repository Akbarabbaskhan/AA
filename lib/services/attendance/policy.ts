import type { AttendanceStatus } from '@prisma/client';
import { addDays, zonedToUtc } from '@/lib/utils/tz';

/**
 * Attendance arithmetic. Pure functions, no database — the spec puts attendance
 * percentages among the four calculations that must be near 100% tested, "because they are
 * where wrong answers are invisible and expensive".
 *
 * The policy, stated once here rather than re-derived at each call site:
 *
 *   PRESENT  counts as attended — they were there
 *   LATE     counts as attended — they were there, late is a separate concern
 *   ABSENT   counts against attendance
 *   EXCUSED  excluded from both sides: an authorised absence must not punish the student
 *   LEAVE    excluded from both sides: approved leave, same reasoning
 *
 * Excluding authorised absence from the denominator rather than counting it as attended is
 * the conservative reading: a student who was away for a month on approved leave neither
 * gains nor loses a percentage they did not earn.
 */
export const ATTENDED_STATUSES: readonly AttendanceStatus[] = ['PRESENT', 'LATE'];
export const COUNTED_AGAINST_STATUSES: readonly AttendanceStatus[] = ['ABSENT'];
export const EXCLUDED_STATUSES: readonly AttendanceStatus[] = ['EXCUSED', 'LEAVE'];

export type AttendanceTally = {
  attended: number;
  absent: number;
  excluded: number;
  /** Sessions that count toward the percentage: attended + absent. */
  counted: number;
  /**
   * null when nothing counts yet. Returning 0 would flag every newly enrolled student as a
   * defaulter on their first day, which is how these dashboards lose a school's trust.
   */
  percent: number | null;
};

export function tally(statuses: readonly AttendanceStatus[]): AttendanceTally {
  let attended = 0;
  let absent = 0;
  let excluded = 0;

  for (const status of statuses) {
    if (ATTENDED_STATUSES.includes(status)) attended += 1;
    else if (COUNTED_AGAINST_STATUSES.includes(status)) absent += 1;
    else excluded += 1;
  }

  const counted = attended + absent;
  return {
    attended,
    absent,
    excluded,
    counted,
    percent: counted === 0 ? null : (attended / counted) * 100,
  };
}

export type DatedStatus = {
  /** `YYYY-MM-DD`. */
  date: string;
  status: AttendanceStatus;
};

/** Keeps the records inside a rolling window ending on `endDate` inclusive. */
export function withinRollingWindow<T extends { date: string }>(
  records: readonly T[],
  endDate: string,
  days: number,
): T[] {
  const start = addDays(endDate, -(days - 1));
  return records.filter((record) => record.date >= start && record.date <= endDate);
}

/**
 * "Attendance below 85% over a rolling 30 days flags the student on the coordinator
 * dashboard." A student with no counted sessions in the window is not a defaulter.
 */
export function isBelowThreshold(
  records: readonly DatedStatus[],
  endDate: string,
  thresholdPercent: number,
  windowDays = 30,
): boolean {
  const window = withinRollingWindow(records, endDate, windowDays);
  const result = tally(window.map((record) => record.status));
  if (result.percent === null) return false;
  return result.percent < thresholdPercent;
}

/**
 * The longest run of consecutive school days the student was fully absent, ending at the
 * most recent day with data.
 *
 * Counted by day, not by period: a student who missed one period of six has not been absent
 * for a day, and raising an alert for that would train coordinators to ignore the alerts.
 * Days with no sessions at all — weekends, holidays — break nothing and are skipped rather
 * than counted as present, so an absence either side of a holiday still forms a run.
 */
export function consecutiveAbsentDays(records: readonly DatedStatus[]): number {
  const byDate = new Map<string, AttendanceStatus[]>();
  for (const record of records) {
    byDate.set(record.date, [...(byDate.get(record.date) ?? []), record.status]);
  }

  const dates = [...byDate.keys()].sort();
  let run = 0;
  let best = 0;

  for (const date of dates) {
    const statuses = byDate.get(date) ?? [];
    const counted = statuses.filter((status) => !EXCLUDED_STATUSES.includes(status));
    // A day made up entirely of authorised absence is neither a presence nor a run-breaker.
    if (counted.length === 0) continue;

    const fullyAbsent = counted.every((status) => COUNTED_AGAINST_STATUSES.includes(status));
    run = fullyAbsent ? run + 1 : 0;
    best = Math.max(best, run);
  }

  return best;
}

/** The trailing run as of the last day with data — what the alert actually fires on. */
export function currentAbsenceStreak(records: readonly DatedStatus[]): number {
  const byDate = new Map<string, AttendanceStatus[]>();
  for (const record of records) {
    byDate.set(record.date, [...(byDate.get(record.date) ?? []), record.status]);
  }

  let run = 0;
  for (const date of [...byDate.keys()].sort().reverse()) {
    const counted = (byDate.get(date) ?? []).filter(
      (status) => !EXCLUDED_STATUSES.includes(status),
    );
    if (counted.length === 0) continue;
    if (counted.every((status) => COUNTED_AGAINST_STATUSES.includes(status))) run += 1;
    else break;
  }
  return run;
}

export const CONSECUTIVE_ABSENCE_ALERT_DAYS = 3;
export const DEFAULT_ATTENDANCE_THRESHOLD_PERCENT = 85;
export const DEFAULT_LOCK_WINDOW_HOURS = 24;

/**
 * "A register locks 24 hours after the period ends. After that, only an Admin can amend."
 *
 * The deadline is computed from the period's own end time on its own date, in the school's
 * timezone — not from when the register happened to be submitted, which would let a late
 * submission quietly extend its own editing window.
 */
export function lockDeadline(
  date: string,
  periodEndTime: string,
  lockWindowHours: number = DEFAULT_LOCK_WINDOW_HOURS,
  timeZone?: string,
): Date {
  const periodEnd = zonedToUtc(date, periodEndTime, timeZone);
  return new Date(periodEnd.getTime() + lockWindowHours * 60 * 60 * 1000);
}

export function isLocked(
  date: string,
  periodEndTime: string,
  now: Date = new Date(),
  lockWindowHours: number = DEFAULT_LOCK_WINDOW_HOURS,
  timeZone?: string,
): boolean {
  return now.getTime() >= lockDeadline(date, periodEndTime, lockWindowHours, timeZone).getTime();
}

/**
 * Offline conflict resolution, "favouring the earliest timestamp".
 *
 * Two teachers — or one teacher on two devices — can both mark the same period while
 * offline. The first person to actually stand in front of the class wins, which is the one
 * whose `markedAt` is earliest, regardless of which device reconnected first.
 */
export function shouldOverwrite(
  existing: { markedAt: Date | null } | null,
  incomingMarkedAt: Date,
): boolean {
  if (!existing) return true;
  if (!existing.markedAt) return true;
  return incomingMarkedAt.getTime() < existing.markedAt.getTime();
}
