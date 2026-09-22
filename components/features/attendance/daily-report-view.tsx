import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import type { DailyAttendanceReport } from '@/lib/services/attendance/reports';
import { StatCard } from './todays-classes';

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/**
 * The coordinator's screen: campus percentage, year-group comparison, today's absentees,
 * and the list of registers nobody has marked. The last one is what principals lean
 * forward for.
 */
export async function DailyReportView({ report }: { report: DailyAttendanceReport }) {
  const t = await getTranslations('attendance');

  return (
    <div className="flex flex-col gap-3">
      <section className="grid gap-2 tablet:grid-cols-3">
        <StatCard label={t('campusToday')} value={formatPercent(report.campus.percent)} />
        <StatCard
          label={t('absentToday')}
          value={String(report.absentees.length)}
          tone={report.absentees.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label={t('notYetMarked')}
          value={String(report.unmarked.length)}
          tone={report.unmarked.length > 0 ? 'danger' : 'success'}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('byYearGroup')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {report.byYearGroup.map((group) => (
              <li key={group.yearGroupId} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-body text-[var(--text-primary)]">{group.name}</span>
                  <span data-numeric className="text-body font-medium">
                    {formatPercent(group.percent)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-pill bg-[var(--surface)]">
                  <div
                    className="h-full rounded-pill bg-[var(--accent)]"
                    style={{ width: `${Math.max(2, Math.min(100, group.percent ?? 0))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('notYetMarked')}</CardTitle>
        </CardHeader>
        <CardContent>
          {report.unmarked.length === 0 ? (
            <EmptyState title={t('allMarked')} body={t('allMarkedBody')} />
          ) : (
            <ul className="flex flex-col gap-1">
              {report.unmarked.slice(0, 25).map((entry) => (
                <li
                  key={`${entry.sectionId}:${entry.periodIndex}`}
                  className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-1 last:border-0"
                >
                  <span className="min-w-0 truncate text-body text-[var(--text-primary)]">
                    {entry.sectionName}
                  </span>
                  <span className="shrink-0 text-small text-[var(--text-secondary)]">
                    {entry.teacherName ?? '—'} · P{entry.periodIndex}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('absentToday')}</CardTitle>
        </CardHeader>
        <CardContent>
          {report.absentees.length === 0 ? (
            <EmptyState title={t('noRecords')} body={t('noRecordsBody')} />
          ) : (
            <ul className="flex flex-col gap-1">
              {report.absentees.slice(0, 40).map((student) => (
                <li
                  key={student.studentId}
                  className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-1 last:border-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body text-[var(--text-primary)]">
                      {student.name}
                    </span>
                    <span data-numeric className="font-mono text-small text-[var(--text-tertiary)]">
                      {student.rollNumber} · {student.yearGroup}
                    </span>
                  </span>
                  <span className="shrink-0 text-small text-[var(--danger)]">
                    {t('periods', { count: student.periods.length })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
