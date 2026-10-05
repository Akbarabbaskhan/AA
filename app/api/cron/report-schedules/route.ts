import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma, withTenant, withoutTenantScope } from '@/lib/db';
import { runDueReportSchedules } from '@/lib/services/reports/schedules';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The scheduled-report runner, for a platform scheduler rather than a person.
 *
 * The `PUT /api/reports/schedules` form needs a signed-in coordinator, which a cron has no
 * way of being. This one authenticates with a shared secret instead and runs every tenant,
 * because a scheduler fires once for the deployment, not once per school.
 *
 * It is safe to call more often than the schedules need: `runDueReportSchedules` is
 * idempotent by `lastRunAt`, so two calls in the same hour send one report.
 */
function authorised(request: Request): boolean {
  const expected = process.env['CRON_SECRET'];
  // No secret configured means the endpoint is shut, not open. An unauthenticated job runner
  // that mails every principal a report is not a feature.
  if (!expected) return false;

  const header = request.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorised(request)) {
    return NextResponse.json({ error: { message: 'Not authorised' } }, { status: 401 });
  }

  const schools = await withoutTenantScope(() =>
    prisma.school.findMany({ where: { isActive: true }, select: { id: true, slug: true } }),
  );

  const results: { school: string; ran: number; skipped: number; failures: number }[] = [];

  for (const school of schools) {
    try {
      const outcome = await withTenant({ schoolId: school.id }, () =>
        runDueReportSchedules(school.id),
      );
      results.push({
        school: school.slug,
        ran: outcome.ran,
        skipped: outcome.skipped,
        failures: outcome.failures.length,
      });
    } catch (cause) {
      // One tenant's bad schedule must not stop the rest of them running.
      results.push({ school: school.slug, ran: 0, skipped: 0, failures: 1 });
      console.error(`report schedules failed for ${school.slug}`, cause);
    }
  }

  return NextResponse.json({ schools: results.length, results });
}
