'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * A leave application.
 *
 * One of the three things a parent may write. It is a request, not a fact: it lands
 * PENDING and the class coordinator decides, which is why the button says "send the
 * request" rather than anything that sounds like marking the child absent.
 */
export function LeaveForm({ studentId }: { studentId?: string }) {
  const t = useTranslations('parents');
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [open, setOpen] = useState(false);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="apply-leave">
        {t('applyLeave')}
      </Button>
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(studentId ? { studentId } : {}),
          fromDate,
          toDate,
          reason,
          documentUrl: null,
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
      setReason('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
      data-testid="leave-form"
    >
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('from')}</span>
          <Input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            data-testid="leave-from"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('to')}</span>
          <Input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            data-testid="leave-to"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('reason')}</span>
        <textarea
          className="min-h-[5rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          data-testid="leave-reason"
        />
      </label>

      <Button onClick={submit} disabled={busy || reason.trim().length < 3} data-testid="submit-leave">
        {busy ? t('submitting') : t('submit')}
      </Button>

      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="leave-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
