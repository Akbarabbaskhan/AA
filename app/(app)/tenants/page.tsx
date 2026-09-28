import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { ProvisionForm } from '@/components/features/tenants/provision-form';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getSystemHealth, listTenants } from '@/lib/services/tenants';
import { listThemes } from '@/lib/services/school-settings';

export const dynamic = 'force-dynamic';

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(0)} MB`;
}

/**
 * The Volt staff console: every tenant, what they are using, and whether anything is stuck.
 *
 * Usage is the renewal conversation — "your teachers marked four thousand registers last month"
 * is a different meeting from "we think you like it" — so the numbers here are deliberately the
 * ones that prove the product is in use rather than merely installed.
 */
export default async function TenantsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('tenants');

  const { tenants, health, themes } = await withActor(actor, async () => ({
    tenants: await listTenants(actor),
    health: await getSystemHealth(actor),
    themes: await listThemes(actor),
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      <section
        className="grid gap-2 tablet:grid-cols-3 desktop:grid-cols-6"
        data-testid="system-health"
      >
        {[
          [t('health.queue'), String(health.queueDepth)],
          [
            t('health.oldest'),
            health.oldestQueuedMinutes === null
              ? '—'
              : t('minutes', { count: health.oldestQueuedMinutes }),
          ],
          [t('health.failed'), String(health.failedLast24Hours)],
          [t('health.suppressed'), String(health.suppressedLast24Hours)],
          [t('health.audit'), String(health.auditRowsLast24Hours)],
          [t('health.database'), megabytes(health.database.sizeBytes)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="flex flex-col gap-1 pt-4">
              <span className="text-small text-[var(--text-tertiary)]">{label}</span>
              <span data-numeric className="text-h3 text-[var(--text-primary)]">
                {value}
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      <ProvisionForm themes={themes} />

      <Card>
        <CardContent className="p-0 pt-4">
          <h2 className="px-3 text-h3">{t('schools', { count: tenants.length })}</h2>
          <div className="overflow-x-auto pb-3">
            <table className="w-full min-w-[46rem] text-body" data-testid="tenant-table">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-small text-[var(--text-secondary)]">
                  <th scope="col" className="p-2 text-start font-medium">
                    {t('column.school')}
                  </th>
                  <th scope="col" className="p-2 text-end font-medium">
                    {t('column.students')}
                  </th>
                  <th scope="col" className="p-2 text-end font-medium">
                    {t('column.staff')}
                  </th>
                  <th scope="col" className="p-2 text-end font-medium">
                    {t('column.activeUsers')}
                  </th>
                  <th scope="col" className="p-2 text-end font-medium">
                    {t('column.registers')}
                  </th>
                  <th scope="col" className="p-2 text-end font-medium">
                    {t('column.papers')}
                  </th>
                  <th scope="col" className="p-2 text-start font-medium">
                    {t('column.modulesOff')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr
                    key={tenant.id}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                    data-testid="tenant-row"
                  >
                    <td className="p-2">
                      {tenant.name}{' '}
                      <span className="font-mono text-small text-[var(--text-tertiary)]">
                        {tenant.slug}
                      </span>
                      {!tenant.isActive ? (
                        <span className="ms-2 text-small text-[var(--warning)]">
                          {t('inactive')}
                        </span>
                      ) : null}
                    </td>
                    <td data-numeric className="p-2 text-end tabular-nums">
                      {tenant.usage.students}
                    </td>
                    <td data-numeric className="p-2 text-end tabular-nums">
                      {tenant.usage.staff}
                    </td>
                    <td data-numeric className="p-2 text-end tabular-nums">
                      {tenant.usage.activeUsersLast30Days}
                    </td>
                    <td data-numeric className="p-2 text-end tabular-nums">
                      {tenant.usage.attendanceMarkedLast30Days}
                    </td>
                    <td data-numeric className="p-2 text-end tabular-nums">
                      {tenant.usage.papersAttemptedLast30Days}
                    </td>
                    <td className="p-2 text-small text-[var(--text-secondary)]">
                      {tenant.disabledModules.length === 0
                        ? '—'
                        : tenant.disabledModules.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
