import { z } from 'zod';
import { route } from '@/lib/api/handler';
import {
  createReportSchedule,
  listReportSchedules,
  runDueReportSchedules,
  scheduleInputSchema,
  setReportScheduleActive,
} from '@/lib/services/reports/schedules';

export const dynamic = 'force-dynamic';

export const GET = route(
  { capability: 'school.settings.read', module: 'reports' },
  async ({ actor }) => ({
    schedules: await listReportSchedules(actor),
  }),
);

export const POST = route(
  { capability: 'school.settings.manage', module: 'reports' },
  async ({ actor, request }) =>
    createReportSchedule(actor, scheduleInputSchema.parse(await request.json())),
);

const patchSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() });

export const PATCH = route(
  { capability: 'school.settings.manage', module: 'reports' },
  async ({ actor, request }) => {
    const input = patchSchema.parse(await request.json());
    return setReportScheduleActive(actor, input.id, input.isActive);
  },
);

/**
 * The runner, triggered by whatever schedules jobs in this deployment — a cron container, a
 * platform scheduler, or a person pressing the button. Idempotent by `lastRunAt`, so calling
 * it twice in an hour sends one report.
 */
export const PUT = route(
  { capability: 'school.settings.manage', module: 'reports' },
  async ({ actor }) => runDueReportSchedules(actor.schoolId),
);
