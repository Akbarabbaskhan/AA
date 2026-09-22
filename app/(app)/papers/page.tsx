import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { VaultFilters } from '@/components/features/papers/vault-filters';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { getVaultFacets, listPapers, vaultQuerySchema } from '@/lib/services/papers/vault';
import { getPracticeGoal } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

const SESSION_LABEL: Record<string, string> = {
  MAY_JUNE: 'May / June',
  OCT_NOV: 'Oct / Nov',
  FEB_MARCH: 'Feb / March',
};

/**
 * The past paper vault.
 *
 * Ordered newest first, because "this year's paper" is what a student in September wants.
 * The goal card sits above the list rather than on a separate page: the thing that makes a
 * student open the vault a second time is seeing that they are two papers short this week.
 */
export default async function PapersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('papers');
  const tp = await getTranslations('practice');

  const query = vaultQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const isStudent = Boolean(actor.studentId) && can(actor, 'attempt.create');

  const [facets, page, goal] = await withActor(actor, async () => {
    return Promise.all([
      getVaultFacets(actor),
      listPapers(actor, query),
      isStudent ? getPracticeGoal(actor) : Promise.resolve(null),
    ]);
  });

  const hasFilters = Object.keys(searchParams).some((key) => key !== 'limit' && key !== 'cursor');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      {goal ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
            <div className="flex flex-col gap-1">
              <p className="text-small text-[var(--text-tertiary)]">{tp('goal')}</p>
              <p className="text-h2" data-testid="goal-progress">
                {tp('goalSet', { done: goal.thisWeek, goal: goal.goalPerWeek })}
              </p>
              <p className="text-small text-[var(--text-tertiary)]">
                {goal.streakWeeks > 0 ? tp('streak', { weeks: goal.streakWeeks }) : tp('streakNone')}
              </p>
            </div>
            <p className="max-w-[22rem] text-small text-[var(--text-tertiary)]">{tp('effortNote')}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <VaultFilters facets={facets} isStudent={isStudent} />
        </CardContent>
      </Card>

      {page.items.length === 0 ? (
        <EmptyState
          title={hasFilters ? t('noneFiltered') : t('none')}
          body={hasFilters ? t('noneFilteredBody') : t('noneBody')}
        />
      ) : (
        <section className="flex flex-col gap-2" aria-label={t('title')}>
          <p className="text-small text-[var(--text-tertiary)]" data-testid="paper-count">
            {t('resultsCount', { count: page.items.length })}
          </p>
          <ul className="flex flex-col gap-2">
            {page.items.map((paper) => (
              <li key={paper.id}>
                <Link
                  href={`/papers/${paper.id}`}
                  className="flex min-h-tap flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-body font-medium text-[var(--text-primary)]">
                      {paper.subjectName} {paper.componentCode ?? ''}
                    </span>
                    <span className="text-small text-[var(--text-tertiary)]">
                      {SESSION_LABEL[paper.session] ?? paper.session} {paper.year} · {t('variant')}{' '}
                      {paper.variant}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-small text-[var(--text-tertiary)]">
                    {paper.durationMinutes ? <span>{t('duration', { minutes: paper.durationMinutes })}</span> : null}
                    {paper.totalMarks ? <span>{t('totalMarks', { marks: paper.totalMarks })}</span> : null}
                    {paper.attemptCount !== null && paper.attemptCount > 0 ? (
                      <span className="text-[var(--text-secondary)]">
                        {t('attempted', { count: paper.attemptCount })}
                        {paper.bestPercent !== null
                          ? ` · ${t('bestScore', { percent: Math.round(paper.bestPercent) })}`
                          : ''}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
