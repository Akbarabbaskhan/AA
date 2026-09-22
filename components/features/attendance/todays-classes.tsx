import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import type { TodayClass } from '@/lib/services/attendance/register';
import { cn } from '@/lib/utils/cn';

/** "Today's classes are already on the dashboard" — one tap from here to a marked register. */
export async function TodaysClasses({ classes, date }: { classes: TodayClass[]; date: string }) {
  const t = await getTranslations('attendance');

  if (classes.length === 0) {
    return <EmptyState title={t('noClassesToday')} body={t('noClassesBody')} />;
  }

  return (
    <ul className="flex flex-col gap-1">
      {classes.map((entry) => (
        <li key={`${entry.sectionId}:${entry.periodIndex}`}>
          <Link
            href={`/attendance/${entry.sectionId}/${date}/${entry.periodIndex}`}
            className={cn(
              'flex min-h-tap items-center gap-2 rounded-card border p-2',
              'transition-colors duration-base ease-out',
              entry.isCurrent
                ? 'border-[var(--accent)] bg-[var(--surface-raised)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-raised)]',
            )}
          >
            <span className="flex w-16 shrink-0 flex-col">
              <span data-numeric className="text-body font-medium text-[var(--text-primary)]">
                {entry.startTime}
              </span>
              <span className="text-small text-[var(--text-tertiary)]">{entry.periodLabel}</span>
            </span>

            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body font-medium text-[var(--text-primary)]">
                {entry.subjectName}
              </span>
              <span className="truncate text-small text-[var(--text-secondary)]">
                {entry.sectionName}
                {entry.roomName ? ` · ${entry.roomName}` : ''} ·{' '}
                {t('students', { count: entry.studentCount })}
              </span>
              {entry.coveringForName ? (
                <span className="truncate text-small text-[var(--warning)]">
                  {t('coveringFor', { name: entry.coveringForName })}
                </span>
              ) : null}
            </span>

            <span className="flex shrink-0 flex-col items-end gap-1">
              {entry.isCurrent ? (
                <span className="rounded-pill bg-[var(--accent)] px-1 text-small font-medium text-[var(--accent-on)]">
                  {t('now')}
                </span>
              ) : null}
              <span
                className={cn(
                  'rounded-pill px-2 py-1 text-small font-medium',
                  entry.isMarked
                    ? 'bg-[var(--surface)] text-[var(--success)]'
                    : 'bg-[var(--accent)] text-[var(--accent-on)]',
                )}
              >
                {entry.isMarked ? t('marked') : t('markNow')}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TodaysClassesSkeleton() {
  return (
    <div className="flex flex-col gap-1" aria-busy="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="flex min-h-tap items-center gap-2 rounded-card border border-[var(--border-subtle)] p-2"
        >
          <div className="skeleton h-10 w-16" />
          <div className="flex w-full flex-col gap-1">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneClass = {
    default: 'text-[var(--text-primary)]',
    warning: 'text-[var(--warning)]',
    danger: 'text-[var(--danger)]',
    success: 'text-[var(--success)]',
  }[tone];

  return (
    <Card>
      <CardHeader>
        <p className="text-small text-[var(--text-secondary)]">{label}</p>
        <p data-numeric className={cn('text-h1', toneClass)}>
          {value}
        </p>
      </CardHeader>
    </Card>
  );
}
