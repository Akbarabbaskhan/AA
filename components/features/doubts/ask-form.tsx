'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Asking a question.
 *
 * The subject is chosen from the student's own enrolments — a doubt with no subject cannot
 * reach a teacher, and a free-text subject field is how that happens.
 */
export function AskForm({ subjects }: { subjects: { id: string; name: string }[] }) {
  const t = useTranslations('doubts');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="ask-doubt">
        {t('ask')}
      </Button>
    );
  }

  async function post(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/doubts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId, title, body, resourceId: null }),
      });
      if (!response.ok) throw new Error('Could not post');
      setOpen(false);
      setTitle('');
      setBody('');
      router.refresh();
    } catch {
      setError('Could not post');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('askTitle')}</span>
        <Input value={title} onChange={(event) => setTitle(event.target.value)} data-testid="doubt-title" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('askBody')}</span>
        <textarea
          className="min-h-[5rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          data-testid="doubt-body"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="sr-only">{t('title')}</span>
        <select
          className="min-h-tap rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 text-body text-[var(--text-primary)]"
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
        >
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
      </label>

      <Button onClick={post} disabled={busy || title.trim() === '' || body.trim() === ''} data-testid="post-doubt">
        {t('post')}
      </Button>
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
