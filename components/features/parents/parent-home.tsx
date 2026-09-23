import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { ChildSwitcher } from '@/components/features/parents/child-switcher';
import { Money } from '@/components/features/fees/money';
import type { Child, ParentHome } from '@/lib/services/parents';

/**
 * The parent home screen.
 *
 * "Today's attendance, fee status, latest result, unread announcements. Nothing else."
 * Four cards, each one a single fact with a single place to go next. A parent opens this
 * on a phone while doing something else; anything that needs interpreting does not belong.
 */
export async function ParentHomeScreen({
  home,
  students,
}: {
  home: ParentHome;
  students: Child[];
}) {
  const t = await getTranslations('parents');
  const tf = await getTranslations('fees');

  const attendanceTone =
    home.attendance.percent === null
      ? 'text-[var(--text-tertiary)]'
      : home.attendance.percent < 75
        ? 'text-[var(--danger)]'
        : home.attendance.percent < 85
          ? 'text-[var(--warning)]'
          : 'text-[var(--success)]';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">{home.child.name}</h1>
        <p className="text-small text-[var(--text-tertiary)]">
          {home.child.rollNumber}
          {home.child.yearGroupName ? ` · ${home.child.yearGroupName}` : ''}
        </p>
        <ChildSwitcher students={students} activeId={home.child.id} />
      </header>

      <Link href="/attendance" className="block focus-visible:outline-none">
        <Card>
          <CardContent className="flex items-baseline justify-between gap-3 pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('todayAttendance')}</span>
              <span className="text-h2 text-[var(--text-primary)]" data-testid="today-attendance">
                {home.attendance.todayStatus ?? t('notMarkedYet')}
              </span>
            </div>
            <span className={`text-h3 tabular-nums ${attendanceTone}`} data-numeric>
              {home.attendance.percent === null
                ? '—'
                : t('attendancePercent', {
                    percent: home.attendance.percent.toFixed(0),
                    days: home.attendance.windowDays,
                  })}
            </span>
          </CardContent>
        </Card>
      </Link>

      <Link
        href={home.fees.invoiceId ? `/fees/${home.fees.invoiceId}` : '/fees'}
        className="block focus-visible:outline-none"
      >
        <Card>
          <CardContent className="flex items-baseline justify-between gap-3 pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('feeStatus')}</span>
              <span className="text-h2" data-testid="fee-status">
                {home.fees.outstanding === 0 ? (
                  <span className="text-[var(--success)]">{t('allPaid')}</span>
                ) : (
                  <Money paisa={home.fees.outstanding} />
                )}
              </span>
            </div>
            {home.fees.outstanding > 0 && home.fees.nextDueDate ? (
              <span
                className={
                  home.fees.overdueDays > 0
                    ? 'text-small text-[var(--danger)]'
                    : 'text-small text-[var(--text-tertiary)]'
                }
              >
                {home.fees.overdueDays > 0
                  ? tf('daysOverdue', { days: home.fees.overdueDays })
                  : `${tf('due')} ${home.fees.nextDueDate}`}
              </span>
            ) : null}
          </CardContent>
        </Card>
      </Link>

      <Card>
        <CardContent className="flex flex-col gap-1 pt-4">
          <span className="text-small text-[var(--text-tertiary)]">{t('latestResult')}</span>
          {home.latestResult === null ? (
            <span className="text-body text-[var(--text-tertiary)]">{t('noResult')}</span>
          ) : home.latestResult.isGated ? (
            /*
             * The fee gate, where the school has switched it on. It says why and what
             * would clear it — a family told only "unavailable" rings the office, and a
             * child told nothing learns that the school is arbitrary.
             */
            <span className="flex flex-col gap-1" data-testid="result-gated">
              <span className="text-body text-[var(--warning)]">{tf('gated')}</span>
              <span className="text-small text-[var(--text-tertiary)]">
                {tf('gatedBody', { days: home.fees.overdueDays })}
              </span>
            </span>
          ) : (
            <Link href="/results" className="text-body text-[var(--text-primary)] underline">
              {home.latestResult.seriesName}
            </Link>
          )}
        </CardContent>
      </Card>

      <Link href="/announcements" className="block focus-visible:outline-none">
        <Card>
          <CardContent className="flex items-baseline justify-between gap-3 pt-4">
            <span className="text-small text-[var(--text-tertiary)]">{t('leave')}</span>
            <span className="text-body text-[var(--text-primary)]">
              {t('announcements', { count: home.unreadAnnouncements })}
            </span>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
