import { describe, expect, it } from 'vitest';
import type { AttendanceStatus } from '@prisma/client';
import {
  CONSECUTIVE_ABSENCE_ALERT_DAYS,
  consecutiveAbsentDays,
  currentAbsenceStreak,
  isBelowThreshold,
  isLocked,
  lockDeadline,
  shouldOverwrite,
  tally,
  withinRollingWindow,
} from '@/lib/services/attendance/policy';

const S = (date: string, status: AttendanceStatus) => ({ date, status });

describe('attendance tally', () => {
  it('counts present and late as attended', () => {
    const result = tally(['PRESENT', 'PRESENT', 'LATE']);
    expect(result.attended).toBe(3);
    expect(result.absent).toBe(0);
    expect(result.percent).toBe(100);
  });

  it('counts absence against the student', () => {
    const result = tally(['PRESENT', 'PRESENT', 'PRESENT', 'ABSENT']);
    expect(result.counted).toBe(4);
    expect(result.percent).toBe(75);
  });

  it('excludes excused and approved leave from both sides', () => {
    // A student on approved leave for two of five periods is 100%, not 60% —
    // authorised absence must not punish them.
    const result = tally(['PRESENT', 'PRESENT', 'PRESENT', 'EXCUSED', 'LEAVE']);
    expect(result.attended).toBe(3);
    expect(result.absent).toBe(0);
    expect(result.excluded).toBe(2);
    expect(result.counted).toBe(3);
    expect(result.percent).toBe(100);
  });

  it('returns null rather than zero when nothing counts yet', () => {
    // Zero would flag every newly enrolled student as a defaulter on their first day.
    expect(tally([]).percent).toBeNull();
    expect(tally(['EXCUSED', 'LEAVE']).percent).toBeNull();
  });

  it('returns zero when the student was genuinely absent throughout', () => {
    expect(tally(['ABSENT', 'ABSENT']).percent).toBe(0);
  });

  it('is exact on the arithmetic, not approximate', () => {
    expect(tally(['PRESENT', 'ABSENT']).percent).toBe(50);
    expect(tally(['PRESENT', 'PRESENT', 'ABSENT']).percent).toBeCloseTo(66.6667, 3);
  });
});

describe('rolling window', () => {
  it('includes both ends of a 30-day window', () => {
    const records = [
      S('2026-09-01', 'PRESENT'),
      S('2026-09-14', 'PRESENT'),
      S('2026-09-30', 'PRESENT'),
      S('2026-08-31', 'PRESENT'),
    ];
    const window = withinRollingWindow(records, '2026-09-30', 30);
    // 30 days ending 30 Sept starts on 1 Sept inclusive.
    expect(window.map((r) => r.date)).toEqual(['2026-09-01', '2026-09-14', '2026-09-30']);
  });

  it('flags a student below the threshold', () => {
    const records = [
      ...Array.from({ length: 8 }, (_, i) => S(`2026-09-${String(i + 1).padStart(2, '0')}`, 'PRESENT' as const)),
      ...Array.from({ length: 2 }, (_, i) => S(`2026-09-${String(i + 9).padStart(2, '0')}`, 'ABSENT' as const)),
    ];
    // 8 of 10 is 80%, under the 85% threshold.
    expect(isBelowThreshold(records, '2026-09-30', 85)).toBe(true);
  });

  it('does not flag a student at or above the threshold', () => {
    const records = [
      ...Array.from({ length: 9 }, (_, i) => S(`2026-09-${String(i + 1).padStart(2, '0')}`, 'PRESENT' as const)),
      S('2026-09-10', 'ABSENT'),
    ];
    expect(isBelowThreshold(records, '2026-09-30', 85)).toBe(false);
  });

  it('does not flag a student with no data in the window', () => {
    expect(isBelowThreshold([S('2026-01-05', 'ABSENT')], '2026-09-30', 85)).toBe(false);
    expect(isBelowThreshold([], '2026-09-30', 85)).toBe(false);
  });

  it('ignores records outside the window when deciding', () => {
    const records = [
      S('2026-05-01', 'ABSENT'),
      S('2026-05-02', 'ABSENT'),
      S('2026-09-29', 'PRESENT'),
      S('2026-09-30', 'PRESENT'),
    ];
    expect(isBelowThreshold(records, '2026-09-30', 85)).toBe(false);
  });
});

describe('consecutive absences', () => {
  it('raises the alert at three consecutive full days', () => {
    const records = [
      S('2026-09-14', 'ABSENT'),
      S('2026-09-15', 'ABSENT'),
      S('2026-09-16', 'ABSENT'),
    ];
    expect(consecutiveAbsentDays(records)).toBe(3);
    expect(consecutiveAbsentDays(records)).toBeGreaterThanOrEqual(CONSECUTIVE_ABSENCE_ALERT_DAYS);
  });

  it('does not count a day where the student attended any period', () => {
    // Period-wise attendance means a partial day is not an absence.
    const records = [
      S('2026-09-14', 'ABSENT'),
      S('2026-09-15', 'ABSENT'),
      S('2026-09-15', 'PRESENT'),
      S('2026-09-16', 'ABSENT'),
    ];
    expect(consecutiveAbsentDays(records)).toBe(1);
  });

  it('breaks the run on a day the student attended', () => {
    const records = [
      S('2026-09-14', 'ABSENT'),
      S('2026-09-15', 'PRESENT'),
      S('2026-09-16', 'ABSENT'),
      S('2026-09-17', 'ABSENT'),
    ];
    expect(consecutiveAbsentDays(records)).toBe(2);
  });

  it('bridges a weekend or holiday rather than resetting on it', () => {
    // Friday and the following Monday, with no sessions in between, is still a run — a
    // student who vanishes over a long weekend is exactly the case worth alerting on.
    const records = [
      S('2026-09-18', 'ABSENT'),
      S('2026-09-21', 'ABSENT'),
      S('2026-09-22', 'ABSENT'),
    ];
    expect(consecutiveAbsentDays(records)).toBe(3);
  });

  it('does not treat authorised absence as a run', () => {
    const records = [
      S('2026-09-14', 'LEAVE'),
      S('2026-09-15', 'LEAVE'),
      S('2026-09-16', 'EXCUSED'),
    ];
    expect(consecutiveAbsentDays(records)).toBe(0);
  });

  it('reports the trailing streak, which is what the alert fires on', () => {
    const records = [
      S('2026-09-01', 'ABSENT'),
      S('2026-09-02', 'ABSENT'),
      S('2026-09-03', 'ABSENT'),
      S('2026-09-04', 'PRESENT'),
      S('2026-09-07', 'ABSENT'),
    ];
    expect(consecutiveAbsentDays(records)).toBe(3);
    expect(currentAbsenceStreak(records)).toBe(1);
  });

  it('returns zero for a student with a clean record', () => {
    expect(consecutiveAbsentDays([S('2026-09-14', 'PRESENT')])).toBe(0);
    expect(currentAbsenceStreak([])).toBe(0);
  });
});

describe('register lock window', () => {
  // Period 1 on 14 October 2026 ends at 08:45 Pakistan time, which is 03:45 UTC.
  const date = '2026-10-14';
  const periodEnd = '08:45';

  it('locks exactly 24 hours after the period ends, in the school\'s timezone', () => {
    const deadline = lockDeadline(date, periodEnd);
    expect(deadline.toISOString()).toBe('2026-10-15T03:45:00.000Z');
  });

  it('is open before the deadline and locked after', () => {
    expect(isLocked(date, periodEnd, new Date('2026-10-15T03:44:59.000Z'))).toBe(false);
    expect(isLocked(date, periodEnd, new Date('2026-10-15T03:45:00.000Z'))).toBe(true);
    expect(isLocked(date, periodEnd, new Date('2026-10-16T00:00:00.000Z'))).toBe(true);
  });

  it('measures from the period, not from when the register was submitted', () => {
    // A teacher who submits three days late does not get a fresh 24 hours.
    expect(isLocked(date, periodEnd, new Date('2026-10-17T06:00:00.000Z'))).toBe(true);
  });

  it('honours a school that configures a different window', () => {
    expect(isLocked(date, periodEnd, new Date('2026-10-14T09:00:00.000Z'), 1)).toBe(true);
    expect(isLocked(date, periodEnd, new Date('2026-10-14T04:30:00.000Z'), 1)).toBe(false);
  });

  it('does not drift across a date boundary in Pakistan time', () => {
    // An 08:00 period is 03:00 UTC — a naive server-local calculation puts it on the
    // previous day and unlocks a register that should be shut.
    expect(lockDeadline('2026-01-01', '08:00').toISOString()).toBe('2026-01-02T03:00:00.000Z');
  });
});

describe('offline conflict resolution', () => {
  const earlier = new Date('2026-10-14T03:05:00.000Z');
  const later = new Date('2026-10-14T03:20:00.000Z');

  it('writes when nothing is there', () => {
    expect(shouldOverwrite(null, later)).toBe(true);
    expect(shouldOverwrite({ markedAt: null }, later)).toBe(true);
  });

  it('favours the earliest timestamp, not the last to sync', () => {
    // The teacher who marked in the lab at 08:05 wins over the one who marked at 08:20,
    // whichever device got signal back first.
    expect(shouldOverwrite({ markedAt: later }, earlier)).toBe(true);
    expect(shouldOverwrite({ markedAt: earlier }, later)).toBe(false);
  });

  it('does not overwrite on an exact tie', () => {
    expect(shouldOverwrite({ markedAt: earlier }, new Date(earlier))).toBe(false);
  });

  it('treats a re-submission from the same device as a correction, not a race', () => {
    /*
     * A teacher who re-marks their own register offline is fixing it. Applying
     * earliest-wins here silently discards their fix: they retype the register, are told
     * it saved, and the old marks stay.
     */
    expect(shouldOverwrite({ markedAt: earlier, deviceId: 'pixel-a' }, later, 'pixel-a')).toBe(true);
  });

  it('still favours the earliest mark when the other device is somebody else\'s', () => {
    expect(shouldOverwrite({ markedAt: earlier, deviceId: 'pixel-a' }, later, 'pixel-b')).toBe(false);
    expect(shouldOverwrite({ markedAt: later, deviceId: 'pixel-a' }, earlier, 'pixel-b')).toBe(true);
  });

  it('falls back to earliest-wins when either device is unknown', () => {
    expect(shouldOverwrite({ markedAt: earlier, deviceId: null }, later, 'pixel-a')).toBe(false);
    expect(shouldOverwrite({ markedAt: earlier, deviceId: 'pixel-a' }, later)).toBe(false);
  });
});

describe('school settings', () => {
  it('fills in every default from an empty object', async () => {
    const { parseSchoolSettings } = await import('@/lib/services/school-settings');
    const settings = parseSchoolSettings({});
    expect(settings.attendance.lockWindowHours).toBe(24);
    expect(settings.attendance.minimumPercent).toBe(85);
    expect(settings.attendance.periodWise).toBe(true);
    expect(settings.notifications.quietHours.from).toBe('21:00');
    // "Make it a setting, default off, and let the school own the decision."
    expect(settings.fees.gateResultsOnOverdue).toBe(false);
  });

  it('keeps a school\'s overrides', async () => {
    const { parseSchoolSettings } = await import('@/lib/services/school-settings');
    const settings = parseSchoolSettings({
      attendance: { lockWindowHours: 48, minimumPercent: 75 },
      fees: { gateResultsOnOverdue: true },
    });
    expect(settings.attendance.lockWindowHours).toBe(48);
    expect(settings.attendance.minimumPercent).toBe(75);
    expect(settings.fees.gateResultsOnOverdue).toBe(true);
    // Untouched keys still get defaults.
    expect(settings.attendance.rollingWindowDays).toBe(30);
  });

  it('falls back to defaults rather than crashing on a malformed blob', async () => {
    const { parseSchoolSettings } = await import('@/lib/services/school-settings');
    const settings = parseSchoolSettings({ attendance: { lockWindowHours: 'soon' } });
    expect(settings.attendance.lockWindowHours).toBe(24);
  });
});
