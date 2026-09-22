import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { listQuizzes } from '@/lib/services/quizzes/quiz';
import { getLocale } from 'next-intl/server';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * Quizzes, from both sides of the desk.
 *
 * A student sees status and their own score; a teacher sees how many have sat it and how
 * many answers are still waiting to be marked — the number that decides whether they open
 * it tonight.
 */
export default async function QuizzesPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('quizzes');
  const locale = await getLocale();

  const isStaff = can(actor, 'quiz.manage');
  const quizzes = await withActor(actor, () => listQuizzes(actor));

  if (quizzes.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={isStaff ? t('noneStaffBody') : t('noneBody')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1">{t('title')}</h1>

      <ul className="flex flex-col gap-2">
        {quizzes.map((quiz) => {
          const href = isStaff
            ? `/quizzes/${quiz.id}/analysis`
            : quiz.attemptsUsed && quiz.attemptsUsed > 0 && quiz.status !== 'OPEN'
              ? `/quizzes/${quiz.id}/take`
              : `/quizzes/${quiz.id}/take`;

          return (
            <li key={quiz.id}>
              <Link
                href={href}
                className="flex min-h-tap flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                data-testid="quiz-row"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body font-medium text-[var(--text-primary)]">{quiz.title}</span>
                  <span className="text-small text-[var(--text-tertiary)]">
                    {quiz.status === 'OPEN'
                      ? t('open')
                      : quiz.status === 'CLOSED'
                        ? t('closed')
                        : t('upcoming', {
                          date: formatDate(new Date(quiz.availableFrom ?? Date.now()), locale === 'ur' ? 'ur' : 'en'),
                        })}
                  </span>
                </span>

                <span className="text-small text-[var(--text-tertiary)]">
                  {quiz.subjectName} · {quiz.sectionName}
                </span>

                <span className="flex flex-wrap items-center gap-3 text-small text-[var(--text-tertiary)]">
                  <span>{t('questions', { count: quiz.questionCount })}</span>
                  <span>
                    {quiz.timeLimitSeconds
                      ? t('timeLimit', { minutes: Math.round(quiz.timeLimitSeconds / 60) })
                      : t('noTimeLimit')}
                  </span>

                  {isStaff ? (
                    <>
                      <span>{t('submitted', { count: quiz.submissionCount ?? 0 })}</span>
                      {quiz.pendingManualMarking && quiz.pendingManualMarking > 0 ? (
                        <span className="text-[var(--warning)]">
                          {t('pendingMarking', { count: quiz.pendingManualMarking })}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span>
                        {t('attemptsUsed', {
                          used: quiz.attemptsUsed ?? 0,
                          allowed: quiz.attemptsAllowed,
                        })}
                      </span>
                      {quiz.bestScore !== null ? (
                        <span className="text-[var(--text-secondary)]" data-numeric>
                          {t('yourScore', { score: quiz.bestScore, total: quiz.totalMarks })}
                        </span>
                      ) : null}
                    </>
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
