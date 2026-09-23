'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * The one-click reminder.
 *
 * Confirmed first, and the confirmation names the number of families — a button that
 * WhatsApps four hundred parents on a single tap is one somebody presses by accident
 * exactly once, and WhatsApp is charged per message.
 */
export function RemindButton({ families }: { families: number }) {
  const t = useTranslations('defaulters');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ notified: number; unreachable: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/fees/defaulters/remind', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minDaysOverdue: 1 }),
      });
      const json: unknown = await response.json();
      if (!response.ok) throw new Error('Could not send');
      setResult(json as { notified: number; unreachable: number });
      setConfirming(false);
      router.refresh();
    } catch {
      setError('Could not send');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <p className="text-small text-[var(--success)]" data-testid="remind-result">
        {t('reminded', { notified: result.notified, unreachable: result.unreachable })}
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)} data-testid="remind-defaulters">
        {t('remind')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-[var(--border-strong)] bg-[var(--surface-raised)] p-3">
      <p className="text-body text-[var(--text-primary)]">{t('families', { count: families })}</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          {t('bucket')}
        </Button>
        <Button onClick={send} disabled={busy} data-testid="confirm-remind">
          {busy ? t('reminding') : t('remind')}
        </Button>
      </div>
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
