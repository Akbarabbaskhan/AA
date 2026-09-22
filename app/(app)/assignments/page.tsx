import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { listAssignments } from '@/lib/services/assignments';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * Assignments.
 *
 * Sorted by due date, newest first, with the student's own status on each row — "not
 * submitted" on an overdue piece is the one thing a student needs to see without opening
 * anything.
 */
export default async function AssignmentsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('assignments');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const isStaff = can(actor, 'assignment.manage');
  const assignments = await withActor(actor, () => listAssignments(actor, { scope: 'ALL' }));

  if (assignments.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={isStaff ? t('noneStaffBody') : t('noneBody')} />
      </div>
    );
  }

  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1">{t('title')}</h1>

      <ul className="flex flex-col gap-2">
        {assignments.map((assignment) => {
          const dueMs = new Date(assignment.dueAt).getTime();
          const days = Math.round(Math.abs(dueMs - now) / 86_400_000);
          const overdue = dueMs < now;
          const mine = assignment.mySubmission;

          return (
            <li key={assignment.id}>
              <Link
                href={`/assignments/${assignment.id}`}
                className="flex min-h-tap flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                data-testid="assignment-row"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body font-medium text-[var(--text-primary)]">
                    {assignment.title}
                  </span>
                  <span className="text-small text-[var(--text-tertiary)]">
                    {t('due', { date: formatDate(new Date(assignment.dueAt), locale) })}
                  </span>
                </span>

                <span className="text-small text-[var(--text-tertiary)]">
                  {assignment.subjectName} · {assignment.sectionName}
                  {!assignment.isPublished ? ' · Draft' : ''}
                </span>

                <span className="flex flex-wrap items-center gap-3 text-small">
                  <span className={overdue ? 'text-[var(--warning)]' : 'text-[var(--text-tertiary)]'}>
                    {overdue ? t('overdue', { days }) : t('dueIn', { days })}
                  </span>

                  {isStaff ? (
                    <>
                      <span className="text-[var(--text-tertiary)]">
                        {t('progress', {
                          submitted: assignment.submittedCount ?? 0,
                          expected: assignment.expectedCount ?? 0,
                        })}
                      </span>
                      {assignment.ungradedCount && assignment.ungradedCount > 0 ? (
                        <span className="text-[var(--warning)]">
                          {t('ungraded', { count: assignment.ungradedCount })}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span
                      className={
                        mine?.marks !== null && mine?.marks !== undefined
                          ? 'text-[var(--text-secondary)]'
                          : mine?.submittedAt
                            ? 'text-[var(--success)]'
                            : 'text-[var(--danger)]'
                      }
                      data-testid="assignment-status"
                    >
                      {mine?.marks !== null && mine?.marks !== undefined
                        ? t('graded', { marks: mine.marks, total: assignment.totalMarks })
                        : mine?.submittedAt
                          ? mine.isLate
                            ? t('submittedLate')
                            : t('submitted')
                          : t('notSubmitted')}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
