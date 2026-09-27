import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { RequestForm } from '@/components/features/careers/request-form';
import { DecideRequest } from '@/components/features/careers/decide-request';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { listDocumentRequests, requestQuerySchema } from '@/lib/services/careers';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  REQUESTED: 'text-[var(--text-tertiary)]',
  IN_PROGRESS: 'text-[var(--warning)]',
  READY: 'text-[var(--success)]',
  DECLINED: 'text-[var(--danger)]',
};

/**
 * Transcript and reference requests.
 *
 * "Routed to the relevant teacher and tracked to completion." So the status is on every row
 * for both sides: a student can see that somebody has started their letter, and a teacher
 * can see what is still owed and by when.
 */
export default async function DocumentRequestsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  await requireModule(actor, 'careers');
  const t = await getTranslations('careers');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const query = requestQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const isStudent = Boolean(actor.studentId);
  const canFulfil = can(actor, 'transcript.fulfil');

  const { requests, teachers } = await withActor(actor, async () => ({
    requests: await listDocumentRequests(actor, query).catch(() => []),
    // A student asks the teachers who actually teach them.
    teachers: isStudent
      ? await prisma.section
          .findMany({
            where: { id: { in: [...actor.enrolledSectionIds] }, teacherId: { not: null } },
            select: { teacher: { select: { id: true, user: { select: { name: true } } } } },
          })
          .then((sections) => {
            const unique = new Map<string, string>();
            for (const section of sections) {
              if (section.teacher) unique.set(section.teacher.id, section.teacher.user.name);
            }
            return [...unique.entries()].map(([id, name]) => ({ id, name }));
          })
      : [],
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-h1">{t('requests')}</h1>
        {isStudent && teachers.length > 0 ? <RequestForm teachers={teachers} /> : null}
      </header>

      {requests.length === 0 ? (
        <EmptyState title={t('noRequests')} body={t('noRequestsBody')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="request-list">
          {requests.map((request) => (
            <li key={request.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-4" data-testid="request-row">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-body font-medium text-[var(--text-primary)]">
                      {t(`requestType${request.type}`)} — {request.destination}
                    </span>
                    <span className={`text-small ${STATUS_TONE[request.status] ?? ''}`}>
                      {t(`status${request.status}`)}
                    </span>
                  </span>

                  <span className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                    {canFulfil ? (
                      <span>
                        {request.rollNumber} · {request.studentName}
                      </span>
                    ) : null}
                    {request.assignedToName ? <span>{request.assignedToName}</span> : null}
                    {request.deadline ? (
                      <span>
                        {t('needBy')}:{' '}
                        {formatDate(new Date(`${request.deadline}T00:00:00.000Z`), locale)}
                      </span>
                    ) : null}
                  </span>

                  {request.note ? (
                    <span className="text-small text-[var(--text-secondary)]">{request.note}</span>
                  ) : null}

                  {request.declineReason ? (
                    <span className="text-small text-[var(--danger)]" data-testid="decline-note">
                      {request.declineReason}
                    </span>
                  ) : null}

                  {request.status === 'READY' && isStudent ? (
                    <a
                      href="/documents"
                      className="text-small text-[var(--accent)] underline"
                      data-testid="request-download"
                    >
                      {t('download')}
                    </a>
                  ) : null}

                  {canFulfil && request.status !== 'READY' && request.status !== 'DECLINED' ? (
                    <DecideRequest requestId={request.id} />
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
