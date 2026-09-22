'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * A student's submission.
 *
 * Text or files, and the form says plainly whether late work will be accepted — a student
 * deciding at 11:50pm whether it is worth finishing needs that answer on the screen, not in
 * a rejection after they press Submit.
 */
export function SubmitForm({
  assignmentId,
  allowLate,
  isOverdue,
  existing,
}: {
  assignmentId: string;
  allowLate: boolean;
  isOverdue: boolean;
  existing: { submittedAt: string | null; isLate: boolean; marks: number | null } | null;
}) {
  const t = useTranslations('assignments');
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const locked = existing?.marks !== null && existing?.marks !== undefined;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/assignments/${assignmentId}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: [], textBody: text }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not submit')
            : 'Could not submit';
        throw new Error(message);
      }
      setDone(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <p className="text-body text-[var(--text-primary)]" data-testid="submission-locked">
        {t('graded', { marks: existing?.marks ?? 0, total: 0 })}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="submit-form">
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('writeAnswer')}</span>
        <textarea
          className="min-h-[7rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={text}
          onChange={(event) => setText(event.target.value)}
          data-testid="submission-text"
        />
      </label>

      <p className="text-small text-[var(--text-tertiary)]">
        {allowLate ? t('lateAllowed') : t('lateClosed')}
      </p>

      <Button onClick={submit} disabled={busy || text.trim() === '' || (isOverdue && !allowLate)} data-testid="submit-assignment">
        {busy ? t('submitting') : existing?.submittedAt ? t('resubmit') : t('submit')}
      </Button>

      {done ? (
        <p className="text-small text-[var(--success)]" data-testid="submission-done">
          {isOverdue ? t('submittedLate') : t('submitted')}
        </p>
      ) : null}
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
