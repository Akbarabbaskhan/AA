import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import type { StudentAttendance } from '@/lib/services/attendance/reports';
import { StatCard } from './todays-classes';
import { cn } from '@/lib/utils/cn';

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/**
 * "Student sees a monthly calendar heatmap and a percentage per subject."
 *
 * The heatmap is one accent at varying opacity rather than a rainbow: colour here means
 * how much was missed, and a legend of five hues would mean nothing at a glance.
 */
export async function StudentAttendanceView({
  data,
  thresholdPercent,
}: {
  data: StudentAttendance;
  thresholdPercent: number;
}) {
  const t = await getTranslations('attendance');

  if (data.calendar.length === 0) {
    return <EmptyState title={t('noRecords')} body={t('noRecordsBody')} />;
  }

  const months = new Map<string, typeof data.calendar>();
  for (const cell of data.calendar) {
    const month = cell.date.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), cell]);
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="grid gap-2 tablet:grid-cols-3">
        <StatCard
          label={t('overall')}
          value={formatPercent(data.overall.percent)}
          tone={
            data.overall.percent !== null && data.overall.percent < thresholdPercent
              ? 'warning'
              : 'default'
          }
        />
        <StatCard
          label={t('last30Days')}
          value={formatPercent(data.rolling.percent)}
          tone={data.rolling.belowThreshold ? 'danger' : 'success'}
        />
        <StatCard
          label={t('absenceStreak')}
          value={String(data.consecutiveAbsences)}
          tone={data.consecutiveAbsences >= 3 ? 'danger' : 'default'}
        />
      </section>

      {data.rolling.belowThreshold ? (
        <p role="status" className="text-body text-[var(--danger)]">
          {t('belowThreshold', { percent: thresholdPercent })}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('bySubject')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {data.bySubject.map((subject) => {
              const percent = subject.percent ?? 0;
              return (
                <li key={subject.sectionId} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-body text-[var(--text-primary)]">
                      {subject.subjectName}
                    </span>
                    <span
                      data-numeric
                      className={cn(
                        'shrink-0 text-body font-medium',
                        percent < thresholdPercent
                          ? 'text-[var(--danger)]'
                          : 'text-[var(--text-primary)]',
                      )}
                    >
                      {formatPercent(subject.percent)}
                    </span>
                  </div>
                  {/* A bar rather than a number alone: the comparison is the point. */}
                  <div
                    role="img"
                    aria-label={`${subject.subjectName}: ${formatPercent(subject.percent)}`}
                    className="h-2 w-full overflow-hidden rounded-pill bg-[var(--surface)]"
                  >
                    <div
                      className={cn(
                        'h-full rounded-pill',
                        percent < thresholdPercent ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]',
                      )}
                      style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {[...months.entries()].reverse().map(([month, cells]) => (
        <Card key={month}>
          <CardHeader>
            <CardTitle>
              {new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
                new Date(`${month}-01T00:00:00Z`),
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-wrap gap-1">
              {cells.map((cell) => {
                const percent = cell.percent;
                // Opacity carries the value; a missing day is a gap, not a zero.
                const intensity =
                  percent === null ? 0 : Math.max(0.15, Math.min(1, (100 - percent) / 100 + 0.15));
                return (
                  <li key={cell.date}>
                    <span
                      title={`${cell.date}: ${formatPercent(percent)}`}
                      className="flex h-8 w-8 items-center justify-center rounded-input border border-[var(--border-subtle)] text-small"
                      style={{
                        backgroundColor:
                          percent === null
                            ? 'var(--surface)'
                            : `color-mix(in srgb, var(--danger) ${Math.round(intensity * 100)}%, var(--surface))`,
                      }}
                    >
                      <span data-numeric className="text-[var(--text-primary)]">
                        {Number(cell.date.slice(8, 10))}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
