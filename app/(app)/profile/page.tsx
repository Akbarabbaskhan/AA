import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { getProfile } from '@/lib/services/identity';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * The student's profile.
 *
 * Subject combination, house, societies and achievements — and deliberately no marks. This is
 * the page a student would screenshot, and a profile that leads with a grade makes the app
 * feel like a gradebook again, which is the thing M5 exists to stop.
 */
export default async function ProfilePage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('identity');
  const tr = await getTranslations('recognition');
  const ts = await getTranslations('societies');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  try {
    const profile = await withActor(actor, () => getProfile(actor));

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center gap-4">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL.
            <img
              src={profile.photoUrl}
              alt=""
              width={72}
              height={72}
              className="h-18 w-18 rounded-pill object-cover"
            />
          ) : null}
          <div className="flex flex-col gap-1">
            <h1 className="text-h1">{profile.name}</h1>
            <p className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
              <span className="font-mono">{profile.rollNumber}</span>
              {profile.yearGroupName ? <span>{profile.yearGroupName}</span> : null}
              {profile.house ? (
                <span>
                  {t('house')}: {profile.house}
                </span>
              ) : null}
              {profile.housePoints !== 0 ? (
                <span>{tr('housePoints', { points: profile.housePoints })}</span>
              ) : null}
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{t('subjects')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2" data-testid="profile-subjects">
              {profile.subjects.map((subject) => (
                <li
                  key={subject.code}
                  className="rounded-pill border border-[var(--border-subtle)] px-3 py-1 text-small text-[var(--text-secondary)]"
                >
                  {subject.name}
                  <span className="ms-2 font-mono text-[var(--text-tertiary)]">{subject.code}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {profile.societies.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('societies')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1" data-testid="profile-societies">
                {profile.societies.map((society) => (
                  <li key={society.id} className="flex justify-between gap-2 text-body">
                    <Link
                      href={`/societies/${society.id}`}
                      className="text-[var(--text-primary)] underline-offset-4 hover:underline"
                    >
                      {society.name}
                    </Link>
                    {society.role !== 'MEMBER' ? (
                      <span className="text-small text-[var(--accent)]">
                        {ts(`role${society.role}`)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t('achievements')}</CardTitle>
          </CardHeader>
          <CardContent>
            {profile.badges.length === 0 ? (
              <p className="text-body text-[var(--text-tertiary)]">{tr('noBadgesBody')}</p>
            ) : (
              <ul className="flex flex-col gap-1" data-testid="profile-badges">
                {profile.badges.map((badge) => (
                  <li key={badge.code} className="flex justify-between gap-2 text-body">
                    <span className="text-[var(--text-primary)]">{badge.title}</span>
                    <span className="text-small text-[var(--text-tertiary)]">
                      {formatDate(new Date(badge.awardedAt), locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <p className="text-small text-[var(--text-tertiary)]">
          {profile.optOutLeaderboards ? tr('optedOut') : tr('effortOnly')}{' '}
          <Link href="/recognition" className="underline">
            {tr('title')}
          </Link>
        </p>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
