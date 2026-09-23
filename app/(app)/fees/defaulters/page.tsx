import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Money } from '@/components/features/fees/money';
import { RemindButton } from '@/components/features/fees/remind-button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { defaulterQuerySchema, getDefaulters } from '@/lib/services/fees/reports';
import { AGING_BUCKETS } from '@/lib/services/fees/money';

export const dynamic = 'force-dynamic';

/**
 * The chase list.
 *
 * Aging buckets across the top as a filter, oldest debt first underneath. The guardian's
 * phone number is on every row because the next action after reading this screen is
 * picking up the telephone.
 */
export default async function DefaultersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('defaulters');
  const tf = await getTranslations('fees');

  const query = defaulterQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const { rows, totals } = await withActor(actor, () => getDefaulters(actor, query));
  const totalFamilies = Object.values(totals).reduce((sum, bucket) => sum + bucket.students, 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">{t('title')}</h1>
          <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/fees/defaulters?format=csv"
            className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
            data-testid="export-defaulters"
          >
            {t('export')}
          </a>
          {totalFamilies > 0 ? <RemindButton families={totalFamilies} /> : null}
        </div>
      </header>

      {/*
        The buckets, as both a summary and the filter.
        Deliberately not a chart: five numbers read faster as five numbers, and the bursar
        clicks one to narrow the list.
      */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-4 desktop:grid-cols-5">
          {AGING_BUCKETS.filter((bucket) => bucket !== 'CURRENT').map((bucket) => {
            const value = totals[bucket];
            const isActive = query.bucket === bucket;
            return (
              <Link
                key={bucket}
                href={isActive ? '/fees/defaulters' : `/fees/defaulters?bucket=${encodeURIComponent(bucket)}`}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'flex min-h-tap flex-col gap-1 rounded-card border p-3 transition-colors',
                  isActive
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]',
                ].join(' ')}
              >
                <span className="text-small text-[var(--text-tertiary)]">{t(`bucket${bucket}`)}</span>
                <span className="text-h3">
                  <Money paisa={value.outstanding} />
                </span>
                <span className="text-small text-[var(--text-tertiary)]">
                  {t('families', { count: value.students })}
                </span>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="defaulter-list">
          {rows.map((row) => (
            <li
              key={row.studentId}
              className="flex flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
              data-testid="defaulter-row"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body font-medium text-[var(--text-primary)]">
                  {row.rollNumber} · {row.studentName}
                </span>
                <span className="text-h3">
                  <Money paisa={row.outstanding} />
                </span>
              </span>

              <span className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                {row.yearGroupName ? <span>{row.yearGroupName}</span> : null}
                <span>{t('invoiceCount', { count: row.invoiceCount })}</span>
                <span className="text-[var(--danger)]">
                  {tf('daysOverdue', { days: row.daysOverdue })}
                </span>
              </span>

              {row.guardianName ? (
                <span className="text-small text-[var(--text-secondary)]">
                  {t('guardian')}: {row.guardianName}
                  {row.guardianPhone ? (
                    <a className="ms-2 underline" href={`tel:${row.guardianPhone}`}>
                      {row.guardianPhone}
                    </a>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
