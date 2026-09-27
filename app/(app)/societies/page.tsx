import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { MembershipButton } from '@/components/features/societies/membership-button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { can } from '@/lib/permissions';
import { listSocieties } from '@/lib/services/societies';

export const dynamic = 'force-dynamic';

/**
 * The society directory.
 *
 * The ones you are already in come first — that is what you open this page to check — then
 * the rest alphabetically. Member counts are on every card because a society's size is how
 * a student decides whether to bother.
 */
export default async function SocietiesPage() {
  const actor = await requireSessionActor();
  await requireModule(actor, 'societies');
  const t = await getTranslations('societies');

  const societies = await withActor(actor, () => listSocieties(actor));
  const canJoin = can(actor, 'society.join');

  if (societies.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={t('noneBody')} />
      </div>
    );
  }

  const ordered = [...societies].sort((a, b) => {
    if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      <ul className="flex flex-col gap-2">
        {ordered.map((society) => (
          <li key={society.id} data-testid="society-row">
            <Card>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-4">
                <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
                  <Link
                    href={`/societies/${society.id}`}
                    className="text-h3 text-[var(--text-primary)] underline-offset-4 hover:underline"
                    data-testid="society-link"
                  >
                    {society.name}
                  </Link>

                  {society.description ? (
                    <p className="text-small text-[var(--text-secondary)]">{society.description}</p>
                  ) : null}

                  <p className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                    <span>{society.isOpen ? t('open') : t('selective')}</span>
                    <span>{t('members', { count: society.memberCount })}</span>
                    {society.staffAdvisorName ? (
                      <span>{t('advisor', { name: society.staffAdvisorName })}</span>
                    ) : null}
                    {society.upcomingEvents > 0 ? (
                      <span className="text-[var(--text-secondary)]">
                        {t('upcoming', { count: society.upcomingEvents })}
                      </span>
                    ) : null}
                  </p>

                  {society.myRole && society.myRole !== 'MEMBER' ? (
                    <p className="text-small text-[var(--accent)]">{t(`role${society.myRole}`)}</p>
                  ) : null}
                </div>

                {canJoin ? (
                  <MembershipButton
                    societyId={society.id}
                    isOpen={society.isOpen}
                    isMember={society.isMember}
                    isOfficer={society.myRole !== null && society.myRole !== 'MEMBER'}
                  />
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
