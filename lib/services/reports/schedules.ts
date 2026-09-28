import { z } from 'zod';
import type { ReportCadence, ReportFormat, RoleName } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { resolveActor } from '@/lib/permissions/resolve';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { getStorage } from '@/lib/storage';
import { notify } from '@/lib/services/notifications/notify';
import { writeAudit } from '@/lib/services/audit';
import { timezoneOffsetMs } from '@/lib/utils/tz';
import { buildReport, reportToSheets } from './index';
import { REPORT_KEYS, type ReportKey } from './definitions';
import { buildXlsx } from '@/lib/reports/xlsx';
import { renderReportPdf } from '@/lib/pdf/report';

/**
 * Scheduled reports.
 *
 * "Every report is schedulable as a recurring email. A principal who gets a Monday morning
 * summary in their inbox stops asking whether the system is being used."
 *
 * The email carries the headline figures and a short-lived link to the file rather than the
 * file itself: a 400-row spreadsheet attached to every principal's inbox every Monday is how a
 * school's mail server starts bouncing, and a link that expires is one that cannot be
 * forwarded to a WhatsApp group a year later.
 *
 * A schedule runs as the person who set it up. If their capability is taken away, the run
 * fails and says so rather than quietly sending a report nobody is entitled to.
 */

export const scheduleInputSchema = z.object({
  reportKey: z.enum(REPORT_KEYS),
  cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  /** In the school's own timezone, which is the only one anybody here thinks in. */
  hourLocal: z.number().int().min(0).max(23).default(7),
  format: z.enum(['XLSX', 'PDF']).default('XLSX'),
  /** Named users, or every holder of a role. */
  recipients: z
    .object({
      userIds: z.array(z.string().uuid()).max(50).default([]),
      roles: z
        .array(z.enum(['ADMIN', 'BURSAR', 'HOD', 'TEACHER', 'SUPERADMIN']))
        .max(7)
        .default([]),
    })
    .refine(
      (value) => value.userIds.length + value.roles.length > 0,
      'Name at least one recipient or role.',
    ),
});

export type ScheduleRow = {
  id: string;
  reportKey: ReportKey;
  cadence: ReportCadence;
  hourLocal: number;
  format: ReportFormat;
  recipients: { userIds: string[]; roles: RoleName[] };
  isActive: boolean;
  lastRunAt: string | null;
};

function toRow(schedule: {
  id: string;
  reportKey: string;
  cadence: ReportCadence;
  hourLocal: number;
  format: ReportFormat;
  recipientsJson: unknown;
  isActive: boolean;
  lastRunAt: Date | null;
}): ScheduleRow {
  const recipients = (schedule.recipientsJson ?? {}) as { userIds?: string[]; roles?: RoleName[] };
  return {
    id: schedule.id,
    reportKey: schedule.reportKey as ReportKey,
    cadence: schedule.cadence,
    hourLocal: schedule.hourLocal,
    format: schedule.format,
    recipients: { userIds: recipients.userIds ?? [], roles: recipients.roles ?? [] },
    isActive: schedule.isActive,
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
  };
}

export async function listReportSchedules(actor: Actor): Promise<ScheduleRow[]> {
  requireCapability(actor, 'school.settings.read');
  const schedules = await prisma.reportSchedule.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      reportKey: true,
      cadence: true,
      hourLocal: true,
      format: true,
      recipientsJson: true,
      isActive: true,
      lastRunAt: true,
    },
  });
  return schedules.map(toRow);
}

export async function createReportSchedule(
  actor: Actor,
  raw: z.input<typeof scheduleInputSchema>,
): Promise<ScheduleRow> {
  requireCapability(actor, 'school.settings.manage');
  const input = scheduleInputSchema.parse(raw);

  const schedule = await prisma.reportSchedule.create({
    data: {
      schoolId: actor.schoolId,
      reportKey: input.reportKey,
      cadence: input.cadence,
      hourLocal: input.hourLocal,
      format: input.format,
      recipientsJson: input.recipients,
      createdById: actor.userId,
    },
    select: {
      id: true,
      reportKey: true,
      cadence: true,
      hourLocal: true,
      format: true,
      recipientsJson: true,
      isActive: true,
      lastRunAt: true,
    },
  });

  await writeAudit(actor, {
    action: 'report.schedule.create',
    entityType: 'School',
    entityId: actor.schoolId,
    after: { reportKey: input.reportKey, cadence: input.cadence, hourLocal: input.hourLocal },
  });

  return toRow(schedule);
}

export async function setReportScheduleActive(
  actor: Actor,
  id: string,
  isActive: boolean,
): Promise<ScheduleRow> {
  requireCapability(actor, 'school.settings.manage');
  const existing = await prisma.reportSchedule.findFirst({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Schedule not found');

  const schedule = await prisma.reportSchedule.update({
    where: { id },
    data: { isActive },
    select: {
      id: true,
      reportKey: true,
      cadence: true,
      hourLocal: true,
      format: true,
      recipientsJson: true,
      isActive: true,
      lastRunAt: true,
    },
  });

  await writeAudit(actor, {
    action: isActive ? 'report.schedule.enable' : 'report.schedule.disable',
    entityType: 'School',
    entityId: actor.schoolId,
    after: { scheduleId: id, isActive },
  });

  return toRow(schedule);
}

/**
 * Whether a schedule is due.
 *
 * Compared in the school's local time, and guarded by `lastRunAt` rather than by a cron-like
 * window: a worker that was down for two hours must still send Monday's report when it comes
 * back, and must not send it twice.
 */
export function isDue(
  schedule: { cadence: ReportCadence; hourLocal: number; lastRunAt: Date | null },
  now: Date,
  offsetMinutes: number,
  /** The school's working days, ISO 1–7. A daily report does not fire on a day off. */
  workingDays?: readonly number[],
): boolean {
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  if (local.getUTCHours() < schedule.hourLocal) return false;

  /*
   * A daily attendance summary on a Sunday says "—", and a school that gets one learns to
   * ignore the whole thing. `lastRunAt` is left alone, so Monday's still goes out.
   */
  if (schedule.cadence === 'DAILY' && workingDays && workingDays.length > 0) {
    const isoDay = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
    if (!workingDays.includes(isoDay)) return false;
  }

  if (!schedule.lastRunAt) return true;
  const lastLocal = new Date(schedule.lastRunAt.getTime() + offsetMinutes * 60_000);

  const sameDay = local.toISOString().slice(0, 10) === lastLocal.toISOString().slice(0, 10);
  if (sameDay) return false;

  if (schedule.cadence === 'DAILY') return true;
  if (schedule.cadence === 'WEEKLY') {
    // Monday, and not already sent this week.
    if (local.getUTCDay() !== 1) return false;
    return local.getTime() - lastLocal.getTime() >= 6 * 86_400_000;
  }
  // Monthly: the first of the month, or the first run after it was missed.
  return (
    local.getUTCMonth() !== lastLocal.getUTCMonth() ||
    local.getUTCFullYear() !== lastLocal.getUTCFullYear()
  );
}

export type ScheduleRunResult = {
  ran: number;
  skipped: number;
  failures: { scheduleId: string; reason: string }[];
  /** Recipients notified, across every schedule that ran. */
  notified: number;
};

async function recipientUserIds(recipients: {
  userIds: string[];
  roles: RoleName[];
}): Promise<string[]> {
  const byRole =
    recipients.roles.length > 0
      ? await prisma.user.findMany({
          where: { isActive: true, roles: { some: { role: { in: recipients.roles } } } },
          select: { id: true },
        })
      : [];
  return [...new Set([...recipients.userIds, ...byRole.map((user) => user.id)])];
}

/** The most recent date at or before the run that has registers on it. */
async function lastMarkedDay(now: Date, offsetMinutes: number): Promise<{ date?: string }> {
  const localDate = new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
  const session = await prisma.attendanceSession.findFirst({
    where: { date: { lte: new Date(`${localDate}T23:59:59.999Z`) } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  return session ? { date: session.date.toISOString().slice(0, 10) } : {};
}

export async function runDueReportSchedules(
  schoolId: string,
  options: { now?: Date } = {},
): Promise<ScheduleRunResult> {
  const now = options.now ?? new Date();
  const settings = await getSchoolSettings();
  const offsetMinutes = timezoneOffsetMs(now, settings.timezone) / 60_000;

  const schedules = await prisma.reportSchedule.findMany({
    where: { isActive: true },
    select: {
      id: true,
      reportKey: true,
      cadence: true,
      hourLocal: true,
      format: true,
      recipientsJson: true,
      isActive: true,
      lastRunAt: true,
      createdById: true,
    },
  });

  const result: ScheduleRunResult = { ran: 0, skipped: 0, failures: [], notified: 0 };
  const storage = getStorage();

  for (const schedule of schedules) {
    if (!isDue(schedule, now, offsetMinutes, settings.academic.workingDays)) {
      result.skipped += 1;
      continue;
    }

    try {
      if (!schedule.createdById) throw new Error('The person who set this schedule up is gone');
      const owner = await resolveActor(schedule.createdById);
      if (!owner) throw new Error('The person who set this schedule up no longer has an account');

      /*
       * A daily attendance summary sent at 07:00 cannot be about today: nobody has marked a
       * register yet. So a scheduled attendance report covers the last day the school was
       * actually open, which is what a principal reading it over breakfast wants.
       */
      const query =
        schedule.reportKey === 'daily-attendance' ? await lastMarkedDay(now, offsetMinutes) : {};

      const report = await buildReport(owner, schedule.reportKey as ReportKey, query);

      const stamp = now.toISOString().slice(0, 10);
      const key =
        schedule.format === 'XLSX'
          ? `${schoolId}/reports/${schedule.reportKey}-${stamp}.xlsx`
          : `${schoolId}/reports/${schedule.reportKey}-${stamp}.pdf`;

      const bytes =
        schedule.format === 'XLSX'
          ? buildXlsx(reportToSheets(report))
          : await renderReportPdf(report, {
              schoolName: settings.branding.displayName || 'Volt',
              generatedBy: schedule.createdById,
            });

      await storage.put(
        key,
        bytes,
        schedule.format === 'XLSX'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf',
      );

      const link = await storage.createDownloadUrl(key, {
        // A working week: long enough to read on Friday, short enough that a forwarded link
        // stops working before the figures are out of date.
        expiresInSeconds: 7 * 24 * 3_600,
        download: true,
      });

      const recipients = await recipientUserIds(
        (schedule.recipientsJson ?? {}) as { userIds: string[]; roles: RoleName[] },
      );

      for (const userId of recipients) {
        await notify(schoolId, userId, 'report.ready', {
          title: report.title,
          // The figures in the message itself: a principal reading on a phone at 07:05 should
          // not have to open a spreadsheet to learn attendance was 91%.
          body: [
            report.subtitle,
            ...report.headline.map((entry) => `${entry.label}: ${entry.value}`),
          ].join(' · '),
          link,
        });
        result.notified += 1;
      }

      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now },
      });
      result.ran += 1;
    } catch (cause) {
      /*
       * A failed schedule is recorded and the loop continues: one broken report must not stop
       * the others, and a silent failure is how a principal stops trusting the whole system.
       */
      result.failures.push({
        scheduleId: schedule.id,
        reason: cause instanceof Error ? cause.message : 'Unknown failure',
      });
    }
  }

  return result;
}
