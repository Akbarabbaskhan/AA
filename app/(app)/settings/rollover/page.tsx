import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { RolloverWizard } from '@/components/features/rollover/rollover-wizard';
import { RevertButton } from '@/components/features/rollover/revert-button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { listRolloverRuns } from '@/lib/services/rollover';
import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * The year-end rollover.
 *
 * Desktop-first and deliberately unhurried: the only screen in Volt that asks you to type the
 * name of the thing you are about to create before it will let you create it.
 */
export default async function RolloverPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('rollover');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const { runs, current } = await withActor(actor, async () => ({
    runs: await listRolloverRuns(actor, 10),
    current: await prisma.academicYear.findFirst({
      where: { isCurrent: true },
      select: { label: true, startDate: true, endDate: true },
    }),
  }));

  /*
   * The suggestion is the next academic year on the current one's pattern — "2026–27" becomes
   * "2027–28", and the dates shift by a year. A coordinator can change all three; most will
   * not have to.
   */
  const startYear = current ? current.startDate.getUTCFullYear() + 1 : new Date().getUTCFullYear();
  const suggested = {
    label: `${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`,
    startDate: current
      ? new Date(current.startDate.getTime()).toISOString().slice(0, 10).replace(/^\d{4}/, String(startYear))
      : `${startYear}-04-01`,
    endDate: current
      ? new Date(current.endDate.getTime())
          .toISOString()
          .slice(0, 10)
          .replace(/^\d{4}/, String(startYear + 1))
      : `${startYear + 1}-03-31`,
  };

  const committed = runs.find((run) => run.status === 'COMMITTED');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">
          {t('subtitle', { label: current?.label ?? '—' })}
        </p>
      </header>

      {committed && committed.revertibleUntil && new Date(committed.revertibleUntil) > new Date() ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4" data-testid="rollover-revertible">
            <p className="text-body text-[var(--text-primary)]">
              {t('revertible', {
                label: committed.newYearLabel,
                until: formatDateTime(new Date(committed.revertibleUntil), locale),
              })}
            </p>
            <RevertButton runId={committed.id} />
          </CardContent>
        </Card>
      ) : null}

      <RolloverWizard suggested={suggested} />

      {runs.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <h2 className="text-h3">{t('history')}</h2>
            <ul className="flex flex-col gap-1" data-testid="rollover-history">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-baseline justify-between gap-2 text-small">
                  <span className="text-[var(--text-primary)]">
                    {run.fromYearLabel} → {run.newYearLabel}
                  </span>
                  <span className="text-[var(--text-tertiary)]">
                    {t(`status.${run.status}`)} · {formatDateTime(new Date(run.createdAt), locale)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
