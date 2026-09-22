import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { QuizSitting } from '@/components/features/quizzes/quiz-sitting';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { getAttemptResult } from '@/lib/services/quizzes/quiz';

export const dynamic = 'force-dynamic';

/**
 * Sitting a quiz.
 *
 * The server sends the shell and the result of a finished attempt — never the questions.
 * Questions arrive from the start call, which is the same boundary the answer key sits
 * behind: nothing a student has not yet earned is ever in the page source.
 */
export default async function TakeQuizPage({ params }: { params: { id: string } }) {
  const actor = await requireSessionActor();
  const t = await getTranslations('quizzes');

  if (!can(actor, 'quiz.take') || !actor.studentId) notFound();

  try {
    const { quiz, result } = await withActor(actor, async () => {
      const found = await prisma.quiz.findFirst({
        where: { id: params.id },
        select: {
          id: true,
          title: true,
          sectionId: true,
          timeLimitSeconds: true,
          attemptsAllowed: true,
          section: { select: { name: true, subject: { select: { name: true } } } },
          attempts: {
            where: { studentId: actor.studentId ?? '' },
            orderBy: { startedAt: 'desc' },
            select: { id: true, submittedAt: true },
          },
        },
      });
      if (!found || !actor.enrolledSectionIds.includes(found.sectionId)) {
        throw ApiError.notFound('Quiz not found');
      }

      const finished = found.attempts.find((attempt) => attempt.submittedAt !== null);
      const attemptResult =
        finished && found.attempts.every((attempt) => attempt.submittedAt !== null)
          ? await getAttemptResult(actor, finished.id)
          : null;

      return { quiz: found, result: attemptResult };
    });

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-small text-[var(--text-tertiary)]">
            {quiz.section.subject.name} · {quiz.section.name}
          </p>
          <h1 className="text-h1">{quiz.title}</h1>
          <p className="text-small text-[var(--text-tertiary)]">{t('tabSwitchNote')}</p>
        </header>

        <Card>
          <CardContent className="pt-4">
            <QuizSitting quizId={quiz.id} title={quiz.title} initialResult={result} />
          </CardContent>
        </Card>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
