import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getTimetable } from '@/lib/services/timetable';
import { cn } from '@/lib/utils/cn';

export const dynamic = 'force-dynamic';

/**
 * "Today by default, with a week toggle, and the current period highlighted live."
 *
 * Read-only on every surface: building a timetable is desktop work and lands with the
 * builder; looking one up is what a student does on a phone between periods.
 */
export default async function TimetablePage() {
  const actor = await requireSessionActor();
  const [t, tDays] = await Promise.all([
    getTranslations('timetable'),
    getTranslations('timetable.days'),
  ]);

  const view = await withActor(actor, () => getTimetable(actor));

  const byDay = new Map<number, typeof view.entries>();
  for (const entry of view.entries) {
    byDay.set(entry.dayOfWeek, [...(byDay.get(entry.dayOfWeek) ?? []), entry]);
  }

  const todayEntries = (byDay.get(view.currentDayOfWeek) ?? []).sort(
    (a, b) => a.periodIndex - b.periodIndex,
  );
  const days = [1, 2, 3, 4, 5, 6].filter((day) => (byDay.get(day) ?? []).length > 0);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-h1">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('today')}</CardTitle>
        </CardHeader>
        <CardContent>
          {todayEntries.length === 0 ? (
            <EmptyState title={t('noSlots')} body={t('noSlotsBody')} />
          ) : (
            <ul className="flex flex-col gap-1">
              {todayEntries.map((entry) => (
                <li
                  key={entry.slotId}
                  className={cn(
                    'flex items-center gap-2 rounded-card border p-2',
                    entry.isCurrent
                      ? 'border-[var(--accent)] bg-[var(--surface)]'
                      : 'border-[var(--border-subtle)]',
                  )}
                >
                  <span data-numeric className="w-16 shrink-0 text-body text-[var(--text-secondary)]">
                    {entry.startTime}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-medium">{entry.subjectName}</span>
                    <span className="truncate text-small text-[var(--text-secondary)]">
                      {entry.roomName ?? '—'}
                      {entry.teacherName ? ` · ${entry.teacherName}` : ''}
                    </span>
                    {entry.substituteName ? (
                      <span className="truncate text-small text-[var(--warning)]">
                        {t('substitute', { name: entry.substituteName })}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* The week, stacked by day on a phone rather than a grid that scrolls sideways. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-h2">{t('week')}</h2>
        {days.map((day) => (
          <Card key={day}>
            <CardHeader>
              <CardTitle>{tDays(String(day))}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1">
                {(byDay.get(day) ?? [])
                  .sort((a, b) => a.periodIndex - b.periodIndex)
                  .map((entry) => (
                    <li
                      key={entry.slotId}
                      className="flex items-center gap-2 border-b border-[var(--border-subtle)] py-1 last:border-0"
                    >
                      <span data-numeric className="w-16 shrink-0 text-small text-[var(--text-tertiary)]">
                        {entry.startTime}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-body">{entry.subjectName}</span>
                      <span className="shrink-0 text-small text-[var(--text-secondary)]">
                        {entry.roomName ?? ''}
                      </span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
