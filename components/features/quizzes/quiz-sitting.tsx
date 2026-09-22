'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { QuizPlayer } from './quiz-player';
import type { AttemptResult, Sitting } from '@/lib/services/quizzes/quiz';

/**
 * The student's whole quiz journey on one route: start, sit, see the result.
 *
 * A separate results page would mean a navigation away from a submit the student has just
 * made, and a back button that lands on a dead attempt. Keeping it here means the result
 * replaces the paper in place, which is also what makes "Review" work later.
 */
export function QuizSitting({
  quizId,
  title,
  initialResult,
}: {
  quizId: string;
  title: string;
  initialResult: AttemptResult | null;
}) {
  const t = useTranslations('quizzes');
  const [sitting, setSitting] = useState<Sitting | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/quizzes/${quizId}/attempts`, { method: 'POST' });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not start')
            : 'Could not start';
        throw new Error(message);
      }
      setSitting(json as Sitting);
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start');
    } finally {
      setBusy(false);
    }
  }, [quizId]);

  if (result) return <QuizResult result={result} />;
  if (sitting) return <QuizPlayer sitting={sitting} onSubmitted={setResult} />;

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={start} disabled={busy} data-testid="start-quiz">
        {t('start')}
      </Button>
      <p className="sr-only">{title}</p>
      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="quiz-start-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The result.
 *
 * Score first, then question by question — and where the machine could not mark an answer,
 * it says so rather than showing a silent zero. A student who sees 6/10 with no explanation
 * of the missing four is the student who stops trusting the quiz.
 */
export function QuizResult({ result }: { result: AttemptResult }) {
  const t = useTranslations('quizzes');

  return (
    <div className="flex flex-col gap-4" data-testid="quiz-result">
      <div className="flex flex-col gap-1">
        <p className="text-small text-[var(--text-tertiary)]">{t('result')}</p>
        <p className="text-h1" data-numeric data-testid="quiz-score">
          {t('yourScore', { score: result.score, total: result.total })}
        </p>
        {result.pendingManualMarking > 0 ? (
          <p className="text-small text-[var(--warning)]">
            {t('pendingMarking', { count: result.pendingManualMarking })} · {t('awaitingMarking')}
          </p>
        ) : null}
      </div>

      {result.questions ? (
        <ol className="flex flex-col gap-3">
          {result.questions.map((question, index) => {
            const correctIds = Array.isArray(question.correct)
              ? question.correct
              : typeof question.correct === 'string'
                ? [question.correct]
                : [];
            const yourIds = Array.isArray(question.yourAnswer)
              ? question.yourAnswer
              : typeof question.yourAnswer === 'string'
                ? [question.yourAnswer]
                : [];
            const textOf = (id: string) =>
              question.options.find((option) => option.id === id)?.text ?? id;

            return (
              <li
                key={question.id}
                className="flex flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-small text-[var(--text-tertiary)]">
                    {index + 1}. {question.topicTag ?? ''}
                  </span>
                  <span
                    className={
                      question.isCorrect === null
                        ? 'text-small text-[var(--text-tertiary)]'
                        : question.isCorrect
                          ? 'text-small text-[var(--success)]'
                          : 'text-small text-[var(--danger)]'
                    }
                  >
                    {question.isCorrect === null
                      ? t('awaitingMarking')
                      : question.isCorrect
                        ? t('correct')
                        : t('incorrect')}
                  </span>
                </span>

                <span className="text-body text-[var(--text-primary)]">{question.body}</span>

                <span className="text-small text-[var(--text-secondary)]">
                  {t('yourAnswer')}:{' '}
                  {question.options.length > 0
                    ? yourIds.map(textOf).join(', ') || '—'
                    : String(question.yourAnswer ?? '—')}
                </span>

                {question.isCorrect === false ? (
                  <span className="text-small text-[var(--text-secondary)]">
                    {t('correctAnswer')}:{' '}
                    {question.options.length > 0
                      ? correctIds.map(textOf).join(', ')
                      : String(question.correct ?? '')}
                  </span>
                ) : null}

                {question.explanation ? (
                  <span className="text-small text-[var(--text-tertiary)]">
                    {t('explanation')}: {question.explanation}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
