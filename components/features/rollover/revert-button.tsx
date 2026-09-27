'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Undoing a year end, inside the 24-hour window, with a reason on the record. */
export function RevertButton({ runId }: { runId: string }) {
  const t = useTranslations('rollover');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} data-testid="rollover-open-revert">
        {t('revertAction')}
      </Button>
    );
  }

  async function revert(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rollover/${runId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revert', reason }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not undo')
            : 'Could not undo';
        throw new Error(message);
      }
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not undo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="rollover-revert-form">
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-secondary)]">{t('revertReason')}</span>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} data-testid="rollover-revert-reason" />
      </label>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
        <Button
          variant="danger"
          onClick={revert}
          disabled={busy || reason.trim().length < 5}
          data-testid="rollover-confirm-revert"
        >
          {busy ? t('working') : t('revertAction')}
        </Button>
      </div>
      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="rollover-revert-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
