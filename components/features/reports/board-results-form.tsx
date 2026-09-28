'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Pasting in a board session's results.
 *
 * The board sends a list, so this takes a list: roll number, subject, grade, one per line.
 * Rows it cannot read come back named — a silently skipped line is a student who looks
 * unpredicted for ever.
 */
export function BoardResultsForm() {
  const t = useTranslations('reports');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [session, setSession] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    recorded: number;
    updated: number;
    problems: { line: number; reason: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="board-results-open">
        {t('enterBoardResults')}
      </Button>
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/board-results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session, text }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save';
        throw new Error(message);
      }
      setResult(
        json as { recorded: number; updated: number; problems: { line: number; reason: string }[] },
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex w-full max-w-[40rem] flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
      data-testid="board-results-form"
    >
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('session')}</span>
        <Input
          value={session}
          onChange={(event) => setSession(event.target.value)}
          placeholder="June 2026"
          data-testid="board-session"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('boardPasteHint')}</span>
        <textarea
          className="min-h-[8rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 font-mono text-small text-[var(--text-primary)]"
          value={text}
          onChange={(event) => setText(event.target.value)}
          data-testid="board-paste"
        />
      </label>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
        <Button
          onClick={submit}
          disabled={busy || session.trim().length < 4 || text.trim().length < 3}
          data-testid="board-save"
        >
          {busy ? t('saving') : t('save')}
        </Button>
      </div>

      {result ? (
        <div className="flex flex-col gap-1" data-testid="board-result">
          <p className="text-body text-[var(--success)]">
            {t('boardSaved', { recorded: result.recorded, updated: result.updated })}
          </p>
          {result.problems.length > 0 ? (
            <ul className="flex flex-col gap-1" data-testid="board-problems">
              {result.problems.map((problem) => (
                <li key={problem.line} className="text-small text-[var(--warning)]">
                  {t('boardProblem', { line: problem.line, reason: problem.reason })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="board-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
