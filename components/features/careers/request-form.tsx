'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Asking for a transcript or a reference.
 *
 * The teacher field appears only for a reference, because a transcript comes from the office
 * and asking a student to nominate somebody for it invites the request going to the wrong
 * place and sitting there.
 */
const TYPES = ['TRANSCRIPT', 'RECOMMENDATION', 'CHARACTER_CERTIFICATE'] as const;

export function RequestForm({ teachers }: { teachers: { id: string; name: string }[] }) {
  const t = useTranslations('careers');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>('TRANSCRIPT');
  const [assignedToId, setAssignedToId] = useState(teachers[0]?.id ?? '');
  const [destination, setDestination] = useState('');
  const [deadline, setDeadline] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="request-document">
        {t('requestDocument')}
      </Button>
    );
  }

  const needsTeacher = type === 'RECOMMENDATION';

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/careers/requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type,
          assignedToId: needsTeacher ? assignedToId : null,
          destination,
          note: note.trim() || null,
          deadline: deadline || null,
        }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not send')
            : 'Could not send';
        throw new Error(message);
      }
      setOpen(false);
      setDestination('');
      setNote('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  const selectClass =
    'min-h-tap rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 ' +
    'text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 ' +
    'focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

  return (
    <div
      className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
      data-testid="request-form"
    >
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('requestDocument')}</span>
        <select
          className={selectClass}
          value={type}
          onChange={(event) => setType(event.target.value as (typeof TYPES)[number])}
          data-testid="request-type"
        >
          {TYPES.map((entry) => (
            <option key={entry} value={entry}>
              {t(`requestType${entry}`)}
            </option>
          ))}
        </select>
      </label>

      {needsTeacher ? (
        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('askingWhom')}</span>
          <select
            className={selectClass}
            value={assignedToId}
            onChange={(event) => setAssignedToId(event.target.value)}
            data-testid="request-teacher"
          >
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('destination')}</span>
        <Input
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          data-testid="request-destination"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('needBy')}</span>
        <Input
          type="date"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
          data-testid="request-deadline"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('yourNote')}</span>
        <textarea
          className="min-h-[4rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <Button
        onClick={submit}
        disabled={busy || destination.trim() === '' || (needsTeacher && !assignedToId)}
        data-testid="send-request"
      >
        {busy ? t('sending') : t('send')}
      </Button>

      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="request-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
