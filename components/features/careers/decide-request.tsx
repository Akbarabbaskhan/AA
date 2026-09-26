'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Moving a request along.
 *
 * Declining requires a reason and the form enforces it, because the student sees that reason
 * and "declined" with no explanation leaves them unable to ask anybody else in time.
 * Marking it ready requires the document, because a request that says ready with nothing to
 * download is worse than one still in progress.
 */
export function DecideRequest({ requestId }: { requestId: string }) {
  const t = useTranslations('careers');
  const router = useRouter();

  const [mode, setMode] = useState<'NONE' | 'READY' | 'DECLINED'>('NONE');
  const [fileUrl, setFileUrl] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(status: 'IN_PROGRESS' | 'READY' | 'DECLINED'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/careers/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status,
          fileUrl: status === 'READY' ? fileUrl : null,
          declineReason: status === 'DECLINED' ? reason : null,
        }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save';
        throw new Error(message);
      }
      setMode('NONE');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'READY') {
    return (
      <div className="flex flex-col gap-2" data-testid="mark-ready-form">
        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('fileUrl')}</span>
          <Input
            value={fileUrl}
            onChange={(event) => setFileUrl(event.target.value)}
            data-testid="request-file-url"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMode('NONE')}>
            {t('requests')}
          </Button>
          <Button onClick={() => send('READY')} disabled={busy || fileUrl.trim() === ''} data-testid="confirm-ready">
            {t('markReady')}
          </Button>
        </div>
        {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  if (mode === 'DECLINED') {
    return (
      <div className="flex flex-col gap-2" data-testid="decline-form">
        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('declineReason')}</span>
          <textarea
            className="min-h-[4rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)]"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-testid="decline-reason"
          />
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setMode('NONE')}>
            {t('requests')}
          </Button>
          <Button
            variant="danger"
            onClick={() => send('DECLINED')}
            disabled={busy || reason.trim().length < 3}
            data-testid="confirm-decline"
          >
            {t('decline')}
          </Button>
        </div>
        {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => send('IN_PROGRESS')} disabled={busy} data-testid="start-request">
        {t('markInProgress')}
      </Button>
      <Button onClick={() => setMode('READY')} data-testid="open-mark-ready">
        {t('markReady')}
      </Button>
      <Button variant="ghost" onClick={() => setMode('DECLINED')} data-testid="open-decline">
        {t('decline')}
      </Button>
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
