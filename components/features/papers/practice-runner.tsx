'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * A timed practice attempt.
 *
 * The clock is derived from the server's `endsAt` and recomputed from the wall clock on
 * every tick, not counted down from a number. A counter that decrements once a second is
 * wrong the moment the tab is backgrounded — which on a phone is most of the time.
 *
 * Running out of time does not auto-submit. A student on a train with no signal at minute
 * 89 should not lose the paper; the deadline is recorded, the submission is not seized.
 */
type Stage = 'IDLE' | 'RUNNING' | 'SUBMITTED';

export type PracticeState = {
  attemptId: string;
  endsAt: string;
  paperUrl: string;
  totalMarks: number;
};

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
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

export function PracticeRunner({
  pastPaperId,
  totalMarks,
  resume,
}: {
  pastPaperId: string;
  totalMarks: number;
  resume: PracticeState | null;
}) {
  const t = useTranslations('practice');
  const tp = useTranslations('papers');
  const router = useRouter();

  const [stage, setStage] = useState<Stage>(resume ? 'RUNNING' : 'IDLE');
  const [state, setState] = useState<PracticeState | null>(resume);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [markScheme, setMarkScheme] = useState<{ markSchemeUrl: string | null; total: number | null } | null>(null);
  const [score, setScore] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ percent: number; grade: string | null } | null>(null);

  useEffect(() => {
    if (stage !== 'RUNNING' || !state) return;
    const endsAt = new Date(state.endsAt).getTime();
    const tick = () => setRemaining(Math.round((endsAt - Date.now()) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [stage, state]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const attempt = await post<PracticeState & { secondsRemaining: number }>('/api/practice/attempts', {
        pastPaperId,
      });
      setState(attempt);
      setStage('RUNNING');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start');
    } finally {
      setBusy(false);
    }
  }, [pastPaperId]);

  const submit = useCallback(async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ markSchemeUrl: string | null; total: number | null }>(
        `/api/practice/attempts/${state.attemptId}/submit`,
      );
      setMarkScheme(result);
      setStage('SUBMITTED');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  }, [state]);

  const saveMark = useCallback(async () => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post<{ percent: number; grade: string | null }>(
        `/api/practice/attempts/${state.attemptId}/mark`,
        {
          score: Number(score),
          total: markScheme?.total ?? totalMarks,
          ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
        },
      );
      setSaved(result);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }, [state, score, notes, markScheme, totalMarks, router]);

  if (stage === 'IDLE' || !state) {
    return (
      <div className="flex flex-col gap-2">
        <Button onClick={start} disabled={busy} data-testid="start-attempt">
          {tp('startTimed')}
        </Button>
        <p className="text-small text-[var(--text-tertiary)]">{tp('markSchemeLocked')}</p>
        {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  if (stage === 'RUNNING') {
    const overdue = remaining !== null && remaining <= 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-small text-[var(--text-tertiary)]">{t('timeRemaining')}</span>
          <span
            className="tabular-nums text-h2 text-[var(--text-primary)]"
            role="timer"
            aria-live="off"
            data-testid="practice-clock"
          >
            {remaining === null ? '—' : formatClock(remaining)}
          </span>
        </div>
        {overdue ? <p className="text-small text-[var(--warning)]">{t('timeUp')}</p> : null}

        <a
          href={state.paperUrl}
          target="_blank"
          rel="noreferrer"
          className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-center text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
        >
          {tp('openPaper')}
        </a>

        <Button onClick={submit} disabled={busy} data-testid="submit-attempt">
          {busy ? t('submitting') : t('submit')}
        </Button>
        <p className="text-small text-[var(--text-tertiary)]">{tp('markSchemeLocked')}</p>
        {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  const total = markScheme?.total ?? totalMarks;
  return (
    <div className="flex flex-col gap-3" data-testid="self-mark">
      <p className="text-body text-[var(--text-primary)]">{t('submitted')}</p>

      {markScheme?.markSchemeUrl ? (
        <a
          href={markScheme.markSchemeUrl}
          target="_blank"
          rel="noreferrer"
          className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-center text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          data-testid="mark-scheme-link"
        >
          {tp('markScheme')}
        </a>
      ) : null}

      <p className="text-small text-[var(--text-tertiary)]">{t('selfMarkHint')}</p>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">
          {t('yourScore')} — {t('outOf', { total })}
        </span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={total}
          value={score}
          onChange={(event) => setScore(event.target.value)}
          data-testid="self-mark-score"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('notes')}</span>
        <textarea
          className="min-h-[5rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={notes}
          placeholder={t('notesHint')}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      <Button onClick={saveMark} disabled={busy || score === ''} data-testid="save-self-mark">
        {t('saveMark')}
      </Button>

      {saved ? (
        <p className="text-body text-[var(--text-primary)]" data-testid="self-mark-result">
          {Math.round(saved.percent)}% {saved.grade ? `· ${saved.grade}` : ''}
        </p>
      ) : null}
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
