'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function ReplyForm({ threadId }: { threadId: string }) {
  const t = useTranslations('doubts');
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/doubts/${threadId}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!response.ok) throw new Error('Could not post');
      setBody('');
      router.refresh();
    } catch {
      setError('Could not post');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="reply-form">
      <label className="flex flex-col gap-1">
        <span className="sr-only">{t('reply')}</span>
        <textarea
          className="min-h-[5rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </label>
      <Button onClick={send} disabled={busy || body.trim() === ''}>
        {t('reply')}
      </Button>
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
