import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getFoundationSummary } from '@/lib/services/foundation';
import { primaryRole } from '@/components/layouts/nav-config';

export const dynamic = 'force-dynamic';

/**
 * M0 ships the shell, not the role dashboards — those are M1 (attendance) and M5 (student
 * life). What this screen shows is real: live counts from the seeded tenant, so the shell,
 * the tenancy guard, the permission layer and the theme are provably wired together.
 */
export default async function DashboardPage() {
  const actor = await requireSessionActor();
  const [summary, t, tNav, tRoles] = await Promise.all([
    withActor(actor, () => getFoundationSummary()),
    getTranslations('dashboard'),
    getTranslations('nav'),
    getTranslations('roles'),
  ]);

  const role = primaryRole(actor.roles);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-small text-[var(--text-tertiary)]">{tRoles(role)}</p>
        <h1 className="text-h1">{tNav('dashboard')}</h1>
      </header>

      <section
        aria-label={t('glanceLabel')}
        className="grid gap-2 tablet:grid-cols-2 desktop:grid-cols-4"
      >
        <Stat label={t('students')} value={summary.students} />
        <Stat label={t('staff')} value={summary.staff} />
        <Stat label={t('sections')} value={summary.sections} />
        <Stat label={t('timetabledPeriods')} value={summary.timetableSlots} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{summary.academicYearLabel ?? t('noAcademicYear')}</CardTitle>
          <CardDescription>
            {t('structure', {
              subjects: summary.subjects,
              programmes: summary.programmes,
              departments: summary.departments,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState title={t('foundationTitle')} body={t('foundationBody')} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        {/* Tabular figures so the number does not reflow as it changes. */}
        <p data-numeric className="text-h1 text-[var(--text-primary)]">
          {value.toLocaleString('en-PK')}
        </p>
      </CardHeader>
    </Card>
  );
}
