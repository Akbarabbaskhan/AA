import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { availableReports } from '@/lib/services/reports';
import { listReportSchedules } from '@/lib/services/reports/schedules';
import { ScheduleForm } from '@/components/features/reports/schedule-form';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * The report index.
 *
 * Each card says who the report is for, because "academic performance" means something
 * different to a principal and to a head of department, and a list of six titles with no
 * audience is a list nobody reads twice.
 */
export default async function ReportsPage() {
  const actor = await requireSessionActor();
  await requireModule(actor, 'reports');
  const t = await getTranslations('reports');

  const { keys, schedules } = await withActor(actor, async () => ({
    keys: availableReports(actor),
    schedules: can(actor, 'school.settings.read') ? await listReportSchedules(actor) : [],
  }));

  if (keys.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={t('noneBody')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      <ul className="grid gap-2 tablet:grid-cols-2" data-testid="report-list">
        {keys.map((key) => (
          <li key={key}>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4">
                <h2 className="text-h3">
                  <Link
                    href={`/reports/${key}`}
                    className="underline-offset-4 hover:underline"
                    data-testid={`report-link-${key}`}
                  >
                    {t(`report.${key}.title`)}
                  </Link>
                </h2>
                <p className="text-small text-[var(--text-secondary)]">{t(`report.${key}.body`)}</p>
                <p className="text-small text-[var(--text-tertiary)]">
                  {t('audience')}: {t(`report.${key}.audience`)}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      {can(actor, 'school.settings.manage') ? (
        <ScheduleForm reportKeys={keys} schedules={schedules} />
      ) : null}
    </div>
  );
}
