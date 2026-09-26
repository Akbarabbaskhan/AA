import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { calendarQuerySchema, getCalendar, type CalendarKind } from '@/lib/services/calendar';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * The campus calendar.
 *
 * Grouped by date rather than laid out as a month grid. A twelve-subject A Level calendar in
 * a grid is five items crammed into a 40px cell on a phone; a list tells you what is
 * happening and when, which is the actual question.
 *
 * Kind is carried by a text label rather than only by colour — the five kinds are a
 * categorical set, and colour alone would fail anyone who cannot distinguish two of them.
 */
const KIND_TONE: Record<CalendarKind, string> = {
  HOLIDAY: 'border-[var(--success)] text-[var(--success)]',
  EXAM: 'border-[var(--danger)] text-[var(--danger)]',
  ASSIGNMENT: 'border-[var(--warning)] text-[var(--warning)]',
  EVENT: 'border-[var(--accent)] text-[var(--accent)]',
  FEE: 'border-[var(--border-strong)] text-[var(--text-secondary)]',
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('calendar');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const query = calendarQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const entries = await withActor(actor, () => getCalendar(actor, query));
  const today = new Date().toISOString().slice(0, 10);

  const byDate = new Map<string, typeof entries>();
  for (const entry of entries) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      {/* The personal filter, as a link so it survives a reload and can be shared. */}
      <nav className="flex flex-wrap items-center gap-2" aria-label={t('mineOnly')}>
        <Link
          href={query.mineOnly ? '/calendar' : '/calendar?mineOnly=true'}
          aria-current={query.mineOnly ? 'page' : undefined}
          className={[
            'min-h-tap rounded-pill border px-3 py-2 text-small',
            query.mineOnly
              ? 'border-[var(--accent)] text-[var(--text-primary)]'
              : 'border-[var(--border-subtle)] text-[var(--text-tertiary)]',
          ].join(' ')}
          data-testid="calendar-mine-only"
        >
          {t('mineOnly')}
        </Link>
        <span className="text-small text-[var(--text-tertiary)]">{t('mineOnlyHint')}</span>
      </nav>

      {entries.length === 0 ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <ol className="flex flex-col gap-4" data-testid="calendar-list">
          {[...byDate.entries()].map(([date, items]) => (
            <li key={date} className="flex flex-col gap-2">
              <h2 className="text-h3 text-[var(--text-primary)]">
                {formatDate(new Date(`${date}T00:00:00.000Z`), locale)}
                {date === today ? (
                  <span className="ms-2 text-small text-[var(--accent)]">{t('today')}</span>
                ) : null}
              </h2>

              <ul className="flex flex-col gap-2">
                {items.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
                    data-testid="calendar-entry"
                  >
                    <span className={`rounded-pill border px-2 py-0.5 text-small ${KIND_TONE[entry.kind]}`}>
                      {t(`kind${entry.kind}`)}
                    </span>

                    <span className="flex-1 text-body text-[var(--text-primary)]">
                      {entry.link ? (
                        <Link href={entry.link} className="underline-offset-4 hover:underline">
                          {entry.title}
                        </Link>
                      ) : (
                        entry.title
                      )}
                    </span>

                    {entry.detail ? (
                      <span className="text-small text-[var(--text-tertiary)]">{entry.detail}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
