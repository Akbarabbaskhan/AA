'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AttemptResult, Sitting, SittingQuestion } from '@/lib/services/quizzes/quiz';

/**
 * Sitting a quiz.
 *
 * One question at a time on a phone, because a scrolling list of thirty questions on a
 * 360px screen is how a student skips one by accident. Every answer is saved the moment it
 * changes rather than on Next, so a dropped connection costs one answer instead of all of
 * them — and the save state is shown, because silent failure here loses a student's work.
 */

type Answer = string | string[] | number | null;

async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof json === 'object' && json !== null && 'error' in json
        ? String((json as { error: { message?: string } }).error.message ?? 'Request failed')
        : 'Request failed';
    throw new Error(message);
  }
  return json as T;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export function QuizPlayer({ sitting, onSubmitted }: { sitting: Sitting; onSubmitted: (result: AttemptResult) => void }) {
  const t = useTranslations('quizzes');

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, Answer>>(
    () => new Map(sitting.questions.map((question) => [question.id, (question.saved ?? null) as Answer])),
  );
  const [saveState, setSaveState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'FAILED'>('IDLE');
  const [remaining, setRemaining] = useState<number | null>(sitting.secondsRemaining);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const question = sitting.questions[index];

  // The clock is read from the wall clock each tick — a backgrounded tab does not
  // slow a decrementing counter down, it just stops it.
  useEffect(() => {
    if (!sitting.endsAt) return;
    const endsAt = new Date(sitting.endsAt).getTime();
    const tick = () => setRemaining(Math.round((endsAt - Date.now()) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sitting.endsAt]);

  /*
   * Proportionate anti-cheating: a count the teacher can see, nothing else. No webcam, no
   * lockdown, no auto-submit — the spec is explicit that a school wants a reason to ask a
   * question, not a surveillance product.
   */
  const reported = useRef(0);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      reported.current += 1;
      void fetch(`/api/quiz-attempts/${sitting.attemptId}/tab-switch`, { method: 'POST' }).catch(() => {});
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [sitting.attemptId]);

  const save = useCallback(
    async (questionId: string, answer: Answer) => {
      setSaveState('SAVING');
      try {
        await request(`/api/quiz-attempts/${sitting.attemptId}/answers`, 'PUT', { questionId, answer });
        setSaveState('SAVED');
      } catch {
        setSaveState('FAILED');
      }
    },
    [sitting.attemptId],
  );

  const setAnswer = useCallback(
    (questionId: string, answer: Answer) => {
      setAnswers((previous) => new Map(previous).set(questionId, answer));
      void save(questionId, answer);
    },
    [save],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await request<AttemptResult>(
        `/api/quiz-attempts/${sitting.attemptId}/submit`,
        'POST',
      );
      onSubmitted(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit');
      setBusy(false);
    }
  }, [sitting.attemptId, onSubmitted]);

  if (!question) return null;

  const answered = sitting.questions.filter(
    (entry) => {
      const value = answers.get(entry.id);
      return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
    },
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-small text-[var(--text-tertiary)]">
          {t('question', { number: index + 1, total: sitting.questions.length })}
        </p>
        {remaining !== null ? (
          <span
            className="tabular-nums text-h3 text-[var(--text-primary)]"
            role="timer"
            aria-live="off"
            data-testid="quiz-clock"
          >
            {formatClock(remaining)}
          </span>
        ) : null}
      </div>

      {/* Progress as a bar of the questions themselves: it doubles as the jump control. */}
      <ol className="flex flex-wrap gap-1" aria-label={t('question', { number: index + 1, total: sitting.questions.length })}>
        {sitting.questions.map((entry, position) => {
          const value = answers.get(entry.id);
          const isAnswered =
            value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setIndex(position)}
                aria-current={position === index ? 'step' : undefined}
                className={[
                  'h-8 w-8 rounded-button border text-small focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                  position === index
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]'
                    : isAnswered
                      ? 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)]'
                      : 'border-[var(--border-subtle)] text-[var(--text-tertiary)]',
                ].join(' ')}
              >
                {position + 1}
              </button>
            </li>
          );
        })}
      </ol>

      <QuestionBody
        question={question}
        value={answers.get(question.id) ?? null}
        onChange={(answer) => setAnswer(question.id, answer)}
      />

      <p
        className={
          saveState === 'FAILED'
            ? 'text-small text-[var(--danger)]'
            : 'text-small text-[var(--text-tertiary)]'
        }
        role="status"
        data-testid="quiz-save-state"
      >
        {saveState === 'FAILED' ? t('savingFailed') : saveState === 'SAVED' ? t('saved') : ' '}
      </p>

      <div
        className="sticky bottom-[calc(var(--bottom-nav-height)+0.5rem)] flex gap-2 desktop:static"
        data-testid="quiz-actions"
      >
        <Button
          variant="secondary"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0}
        >
          {t('previous')}
        </Button>
        {index < sitting.questions.length - 1 ? (
          <Button full onClick={() => setIndex((current) => current + 1)}>
            {t('next')}
          </Button>
        ) : (
          <Button full onClick={() => setConfirming(true)} data-testid="finish-quiz">
            {t('submitQuiz')}
          </Button>
        )}
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded-card border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3">
          <p className="text-body text-[var(--text-primary)]">{t('submitWarning')}</p>
          <p className="text-small text-[var(--text-tertiary)]">
            {answered} / {sitting.questions.length}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('previous')}
            </Button>
            <Button full onClick={submit} disabled={busy} data-testid="confirm-submit-quiz">
              {t('submitQuiz')}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

function QuestionBody({
  question,
  value,
  onChange,
}: {
  question: SittingQuestion;
  value: Answer;
  onChange: (answer: Answer) => void;
}) {
  const t = useTranslations('quizzes');
  const selected = Array.isArray(value) ? value : [];

  return (
    <fieldset className="flex flex-col gap-3 border-0 p-0">
      <legend className="text-body text-[var(--text-primary)]">{question.body}</legend>
      <p className="text-small text-[var(--text-tertiary)]">
        {question.type === 'MCQ'
          ? t('selectOne')
          : question.type === 'MULTI'
            ? t('selectMany')
            : question.type === 'NUMERIC'
              ? t('typeNumber')
              : t('typeAnswer')}
      </p>

      {question.type === 'MCQ' || question.type === 'MULTI' ? (
        <ul className="flex flex-col gap-2">
          {question.options.map((option) => {
            const isChecked =
              question.type === 'MCQ' ? value === option.id : selected.includes(option.id);
            return (
              <li key={option.id}>
                <label className="flex min-h-tap cursor-pointer items-start gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3 hover:border-[var(--border-strong)] has-[:checked]:border-[var(--accent)]">
                  <input
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--accent)]"
                    type={question.type === 'MCQ' ? 'radio' : 'checkbox'}
                    name={question.id}
                    checked={isChecked}
                    onChange={(event) => {
                      if (question.type === 'MCQ') {
                        onChange(option.id);
                        return;
                      }
                      onChange(
                        event.target.checked
                          ? [...selected, option.id]
                          : selected.filter((entry) => entry !== option.id),
                      );
                    }}
                  />
                  <span className="text-body text-[var(--text-primary)]">{option.text}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <Input
          type={question.type === 'NUMERIC' ? 'number' : 'text'}
          inputMode={question.type === 'NUMERIC' ? 'decimal' : 'text'}
          value={value === null || Array.isArray(value) ? '' : String(value)}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
          data-testid="quiz-text-answer"
        />
      )}
    </fieldset>
  );
}
