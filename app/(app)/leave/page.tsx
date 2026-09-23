import { getTranslations, getLocale } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { ChildSwitcher } from '@/components/features/parents/child-switcher';
import { LeaveForm } from '@/components/features/parents/leave-form';
import { LeaveDecision } from '@/components/features/parents/leave-decision';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { getChildren, listLeaveRequests } from '@/lib/services/parents';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

export default async function LeavePage({
  searchParams,
}: {
  searchParams: { studentId?: string };
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('parents');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const canApprove = can(actor, 'leave.approve');
  const canRequest = can(actor, 'leave.request');

  const { children, requests } = await withActor(actor, async () => ({
    children: canApprove ? [] : await getChildren(actor),
    requests: await listLeaveRequests(actor, {
      ...(searchParams.studentId ? { studentId: searchParams.studentId } : {}),
      ...(canApprove ? { status: 'PENDING' as const } : {}),
    }),
  }));

  const activeChild = searchParams.studentId ?? children[0]?.id;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-h1">{t('leave')}</h1>
        {canRequest ? <LeaveForm studentId={activeChild} /> : null}
      </header>

      {children.length > 1 && activeChild ? (
        <ChildSwitcher students={children} activeId={activeChild} />
      ) : null}

      {requests.length === 0 ? (
        <EmptyState title={t('noLeave')} body={t('applyLeave')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="leave-list">
          {requests.map((request) => (
            <li key={request.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-4" data-testid="leave-row">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-body text-[var(--text-primary)]">
                      {canApprove ? request.studentName : t('leave')}
                    </span>
                    <span
                      className={
                        request.status === 'APPROVED'
                          ? 'text-small text-[var(--success)]'
                          : request.status === 'REJECTED'
                            ? 'text-small text-[var(--danger)]'
                            : 'text-small text-[var(--text-tertiary)]'
                      }
                    >
                      {t(`leaveStatus${request.status}`)}
                    </span>
                  </span>

                  <span className="text-small text-[var(--text-tertiary)]">
                    {formatDate(new Date(request.fromDate), locale)} —{' '}
                    {formatDate(new Date(request.toDate), locale)}
                  </span>

                  <span className="text-body text-[var(--text-secondary)]">{request.reason}</span>

                  {canApprove && request.status === 'PENDING' ? (
                    <LeaveDecision requestId={request.id} />
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
