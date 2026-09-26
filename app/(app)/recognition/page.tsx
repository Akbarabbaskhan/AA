import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HouseTable } from '@/components/features/recognition/house-table';
import { OptOutToggle } from '@/components/features/recognition/opt-out-toggle';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import {
  EFFORT_METRICS,
  getBadges,
  getHouseStandings,
  getLeaderboard,
  leaderboardQuerySchema,
} from '@/lib/services/recognition';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * Recognition.
 *
 * The spec's warning is the design brief: "Leaderboards are the obvious idea and the easy
 * way to cause harm." So the rule is stated on the page, in plain words, above the list —
 * not buried in a policy document. A student looking at this should be able to see that
 * nobody is being ranked on marks.
 */
export default async function RecognitionPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('recognition');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const query = leaderboardQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const { board, houses, badges } = await withActor(actor, async () => ({
    board: await getLeaderboard(actor, query),
    houses: await getHouseStandings(actor),
    badges: actor.studentId || actor.childStudentIds.length > 0 ? await getBadges(actor) : [],
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1">{t('title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('leaderboard')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Stated on the page, not in a policy nobody reads. */}
          <p className="text-small text-[var(--text-tertiary)]" data-testid="effort-notice">
            {t('effortOnly')}
          </p>

          <nav className="flex flex-wrap gap-2" aria-label={t('leaderboard')}>
            {EFFORT_METRICS.map((metric) => (
              <Link
                key={metric}
                href={`/recognition?metric=${metric}`}
                aria-current={board.metric === metric ? 'page' : undefined}
                className={[
                  'min-h-tap rounded-pill border px-3 py-2 text-small',
                  board.metric === metric
                    ? 'border-[var(--accent)] text-[var(--text-primary)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-tertiary)]',
                ].join(' ')}
              >
                {t(`metric${metric}`)}
              </Link>
            ))}
          </nav>

          {!board.isEnabled ? (
            <p className="text-body text-[var(--text-tertiary)]">{t('disabled')}</p>
          ) : board.amOptedOut ? (
            <p className="text-body text-[var(--text-secondary)]" data-testid="opted-out-notice">
              {t('optedOut')} — {board.myCount}
            </p>
          ) : (
            <>
              <ol className="flex flex-col gap-1" data-testid="leaderboard">
                {board.rows.map((row) => (
                  <li
                    key={row.studentId}
                    className={[
                      'flex items-center gap-3 rounded-button px-2 py-1.5',
                      row.isMe ? 'bg-[var(--surface)]' : '',
                    ].join(' ')}
                  >
                    <span data-numeric className="w-6 shrink-0 tabular-nums text-small text-[var(--text-tertiary)]">
                      {row.rank}
                    </span>
                    <span className="flex-1 text-body text-[var(--text-primary)]">
                      {row.displayName}
                      {row.house ? (
                        <span className="ms-2 text-small text-[var(--text-tertiary)]">{row.house}</span>
                      ) : null}
                    </span>
                    <span data-numeric className="tabular-nums text-body">
                      {row.count}
                    </span>
                  </li>
                ))}
              </ol>

              <p className="text-small text-[var(--text-secondary)]" data-testid="my-position">
                {board.myRank
                  ? t('yourPosition', { rank: board.myRank, count: board.myCount })
                  : t('notRanked')}
              </p>
            </>
          )}

          {actor.studentId ? <OptOutToggle optedOut={board.amOptedOut} /> : null}
        </CardContent>
      </Card>

      {houses.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('houses')}</CardTitle>
          </CardHeader>
          <CardContent>
            <HouseTable standings={houses} />
          </CardContent>
        </Card>
      ) : null}

      {badges.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('badges')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 desktop:grid-cols-2" data-testid="badge-list">
              {badges.map((badge) => (
                <li
                  key={badge.code}
                  className={[
                    'flex flex-col gap-1 rounded-card border p-3',
                    badge.awardedAt
                      ? 'border-[var(--accent)] bg-[var(--surface)]'
                      : 'border-[var(--border-subtle)] opacity-60',
                  ].join(' ')}
                  data-testid={badge.awardedAt ? 'badge-earned' : 'badge-locked'}
                >
                  <span className="text-body font-medium text-[var(--text-primary)]">
                    {badge.title}
                  </span>
                  <span className="text-small text-[var(--text-secondary)]">{badge.description}</span>
                  <span className="text-small text-[var(--text-tertiary)]">
                    {badge.awardedAt
                      ? t('earned', { date: formatDate(new Date(badge.awardedAt), locale) })
                      : t('notEarned')}
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
