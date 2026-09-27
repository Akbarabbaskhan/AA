'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Writing a merit or a demerit.
 *
 * "Tell the family" is off by default and is a deliberate tick, not a side effect of writing
 * a note. A teacher's working note about a child is a working note; a portal that published
 * every one of them would teach teachers to stop writing anything useful.
 */
export function RemarkForm({
  students,
}: {
  students: { id: string; name: string; rollNumber: string }[];
}) {
  const t = useTranslations('remarks');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [type, setType] = useState<'MERIT' | 'DEMERIT'>('MERIT');
  const [severity, setSeverity] = useState(1);
  const [body, setBody] = useState('');
  const [tellParent, setTellParent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="write-remark">
        {t('write')}
      </Button>
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/remarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId, type, severity, body, isVisibleToParent: tellParent }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save';
        throw new Error(message);
      }
      setOpen(false);
      setBody('');
      setTellParent(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const select =
    'min-h-tap rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 ' +
    'text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 ' +
    'focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

  return (
    <div
      className="flex w-full max-w-[32rem] flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
      data-testid="remark-form"
    >
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('student')}</span>
        <select
          value={studentId}
          onChange={(event) => setStudentId(event.target.value)}
          className={select}
          data-testid="remark-student"
        >
          {students.map((student) => (
            <option key={student.id} value={student.id}>
              {student.name} ({student.rollNumber})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('type')}</span>
        <select
          value={type}
          onChange={(event) => setType(event.target.value as 'MERIT' | 'DEMERIT')}
          className={select}
          data-testid="remark-type"
        >
          <option value="MERIT">{t('merit')}</option>
          <option value="DEMERIT">{t('demerit')}</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('severity')}</span>
        <Input
          type="number"
          min={1}
          max={5}
          value={severity}
          onChange={(event) => setSeverity(Number(event.target.value))}
          data-testid="remark-severity"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('body')}</span>
        <textarea
          className="min-h-[5rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          data-testid="remark-body"
        />
      </label>

      <label className="flex min-h-tap items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 accent-[var(--accent)]"
          checked={tellParent}
          onChange={(event) => setTellParent(event.target.checked)}
          data-testid="remark-visible"
        />
        <span className="flex flex-col">
          <span className="text-body text-[var(--text-primary)]">{t('tellParent')}</span>
          <span className="text-small text-[var(--text-tertiary)]">{t('tellParentHint')}</span>
        </span>
      </label>

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
        <Button
          onClick={submit}
          disabled={busy || body.trim().length < 3 || studentId === ''}
          data-testid="save-remark"
        >
          {busy ? t('saving') : t('save')}
        </Button>
      </div>

      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="remark-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
