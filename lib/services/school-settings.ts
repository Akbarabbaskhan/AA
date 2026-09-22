import { z } from 'zod';
import { prisma } from '@/lib/db';
import {
  CONSECUTIVE_ABSENCE_ALERT_DAYS,
  DEFAULT_ATTENDANCE_THRESHOLD_PERCENT,
  DEFAULT_LOCK_WINDOW_HOURS,
} from './attendance/policy';

/**
 * "Everything that differs between schools is a setting, never a code change. This is what
 * makes school #2 a week of work instead of a fork."
 *
 * Settings are stored as JSON on the tenant and parsed through this schema, so a school
 * with an older or partial settings blob still gets working defaults rather than a crash.
 */
export const schoolSettingsSchema = z.object({
  attendance: z
    .object({
      lockWindowHours: z.number().int().min(1).max(720).default(DEFAULT_LOCK_WINDOW_HOURS),
      minimumPercent: z.number().min(0).max(100).default(DEFAULT_ATTENDANCE_THRESHOLD_PERCENT),
      rollingWindowDays: z.number().int().min(7).max(365).default(30),
      consecutiveAbsenceAlertDays: z
        .number()
        .int()
        .min(2)
        .max(30)
        .default(CONSECUTIVE_ABSENCE_ALERT_DAYS),
      /** Period-wise, not just daily — the default, because selective absence is the problem. */
      periodWise: z.boolean().default(true),
      /** Daily reminder to teachers who have not marked their first period. */
      unmarkedReminderTime: z.string().regex(/^\d{2}:\d{2}$/).default('08:30'),
    })
    .default({}),
  notifications: z
    .object({
      quietHours: z
        .object({
          from: z.string().regex(/^\d{2}:\d{2}$/).default('21:00'),
          to: z.string().regex(/^\d{2}:\d{2}$/).default('07:00'),
        })
        .default({}),
      /** Absence alerts are batched into one message per guardian per day. */
      absenceBatchMinutes: z.number().int().min(5).max(180).default(30),
    })
    .default({}),
  fees: z
    .object({
      /** "Schools ask for this. Make it a setting, default off." */
      gateResultsOnOverdue: z.boolean().default(false),
      gateOverdueDays: z.number().int().min(1).max(365).default(60),
    })
    .default({}),
  engagement: z
    .object({
      effortLeaderboards: z.boolean().default(true),
    })
    .default({}),
});

export type SchoolSettings = z.infer<typeof schoolSettingsSchema>;

export function parseSchoolSettings(raw: unknown): SchoolSettings {
  const result = schoolSettingsSchema.safeParse(raw ?? {});
  // A malformed settings blob must not take the school offline; fall back to defaults.
  return result.success ? result.data : schoolSettingsSchema.parse({});
}

export async function getSchoolSettings(): Promise<SchoolSettings & { timezone: string }> {
  const school = await prisma.school.findFirstOrThrow({
    select: { settingsJson: true, timezone: true },
  });
  return { ...parseSchoolSettings(school.settingsJson), timezone: school.timezone };
}
