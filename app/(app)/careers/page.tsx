import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { CAREER_TYPES, careerQuerySchema, listCareerItems } from '@/lib/services/careers';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * The career and university corner.
 *
 * Deadlines first, soonest first, with the countdown spelled out — because the thing an A
 * Level student is anxious about is not "when is the LUMS deadline" but "how long have I
 * got". A date alone makes them do the arithmetic.
 */
export default async function CareersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('careers');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const query = careerQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const items = await withActor(actor, () => listCareerItems(actor, query));

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={t('noneBody')} />
      </div>
    );
  }

  const grouped = new Map<string, typeof items>();
  for (const item of items) {
    grouped.set(item.type, [...(grouped.get(item.type) ?? []), item]);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">{t('title')}</h1>
          <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
        </div>
        <Link
          href="/careers/requests"
          className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
        >
          {t('requests')}
        </Link>
      </header>

      {CAREER_TYPES.filter((type) => grouped.has(type)).map((type) => (
        <section key={type} className="flex flex-col gap-2">
          <h2 className="text-h2">{t(`type${type}`)}</h2>

          <ul className="flex flex-col gap-2">
            {(grouped.get(type) ?? []).map((item) => {
              const days = item.daysUntilDeadline;
              const isPast = days !== null && days < 0;

              return (
                <li key={item.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-baseline justify-between gap-3 pt-4">
                      <span className="flex min-w-[14rem] flex-1 flex-col gap-1">
                        <span className="text-body font-medium text-[var(--text-primary)]">
                          {item.title}
                        </span>
                        {item.institution ? (
                          <span className="text-small text-[var(--text-tertiary)]">
                            {item.institution}
                          </span>
                        ) : null}
                        {item.body ? (
                          <span className="text-small text-[var(--text-secondary)]">{item.body}</span>
                        ) : null}
                      </span>

                      <span className="flex flex-col items-end gap-1">
                        {item.deadline ? (
                          <>
                            <span className="text-small text-[var(--text-secondary)]">
                              {formatDate(new Date(`${item.deadline}T00:00:00.000Z`), locale)}
                            </span>
                            <span
                              className={
                                isPast
                                  ? 'text-small text-[var(--text-tertiary)]'
                                  : days !== null && days <= 14
                                    ? 'text-small text-[var(--danger)]'
                                    : 'text-small text-[var(--text-secondary)]'
                              }
                              data-testid="career-countdown"
                            >
                              {isPast
                                ? t('closedDaysAgo', { days: Math.abs(days) })
                                : t('daysLeft', { days: days ?? 0 })}
                            </span>
                          </>
                        ) : null}

                        {item.link ? (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-small text-[var(--accent)] underline"
                          >
                            {t('openLink')}
                          </a>
                        ) : null}
                      </span>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
