import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MembershipButton } from '@/components/features/societies/membership-button';
import { AdmitButton } from '@/components/features/societies/admit-button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { ApiError } from '@/lib/api/errors';
import { can } from '@/lib/permissions';
import { getSociety } from '@/lib/services/societies';
import { formatDate, formatTime } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * One society.
 *
 * Officers see the applications queue; everybody sees the members and the events. A student
 * head has real admin rights here — which is how these clubs actually run, and the reason
 * the officer roles exist at all.
 */
export default async function SocietyPage({ params }: { params: { id: string } }) {
  const actor = await requireSessionActor();
  await requireModule(actor, 'societies');
  const t = await getTranslations('societies');
  const te = await getTranslations('events');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  try {
    const society = await withActor(actor, () => getSociety(actor, params.id));

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1">{society.name}</h1>
            <p className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
              <span>{society.isOpen ? t('open') : t('selective')}</span>
              <span>{t('members', { count: society.memberCount })}</span>
              {society.staffAdvisorName ? (
                <span>{t('advisor', { name: society.staffAdvisorName })}</span>
              ) : null}
            </p>
          </div>

          {can(actor, 'society.join') ? (
            <MembershipButton
              societyId={society.id}
              isOpen={society.isOpen}
              isMember={society.isMember}
              isOfficer={society.myRole !== null && society.myRole !== 'MEMBER'}
            />
          ) : null}
        </header>

        {society.description ? (
          <p className="text-body text-[var(--text-secondary)]">{society.description}</p>
        ) : null}

        {society.canManage && society.applications.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('applications')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2" data-testid="application-list">
                {society.applications.map((application) => (
                  <li
                    key={application.studentId}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-body text-[var(--text-primary)]">
                      <span className="font-mono text-small text-[var(--text-tertiary)]">
                        {application.rollNumber}
                      </span>{' '}
                      {application.name}
                    </span>
                    <AdmitButton societyId={society.id} studentId={application.studentId} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {society.events.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{te('title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {society.events.map((event) => (
                  <li key={event.id} className="flex flex-wrap justify-between gap-2">
                    <span className="text-body text-[var(--text-primary)]">{event.title}</span>
                    <span className="text-small text-[var(--text-tertiary)]">
                      {formatDate(new Date(event.startsAt), locale)} ·{' '}
                      {formatTime(new Date(event.startsAt), locale)}
                      {event.capacity !== null ? ` · ${te('going', { count: event.going })}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t('memberList')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1" data-testid="member-list">
              {society.members.map((member) => (
                <li key={member.studentId} className="flex flex-wrap justify-between gap-2 text-body">
                  <span className="text-[var(--text-primary)]">
                    <span className="font-mono text-small text-[var(--text-tertiary)]">
                      {member.rollNumber}
                    </span>{' '}
                    {member.name}
                  </span>
                  {member.role !== 'MEMBER' ? (
                    <span className="text-small text-[var(--accent)]">{t(`role${member.role}`)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
