'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatPaisa } from '@/lib/services/fees/money';

/**
 * Recording a payment at the counter.
 *
 * Pre-filled with the outstanding amount, because that is what a family pays nine times in
 * ten and retyping it is where a digit gets dropped. The reference field appears and
 * becomes required the moment the method is anything but cash — a bank transfer with no
 * reference cannot be reconciled later, which is the accounts office's own problem in
 * three weeks' time.
 */
const METHODS = ['CASH', 'BANK', 'CHEQUE', 'JAZZCASH', 'EASYPAISA', 'CARD'] as const;

export function RecordPayment({
  invoiceId,
  outstandingPaisa,
}: {
  invoiceId: string;
  outstandingPaisa: number;
}) {
  const t = useTranslations('fees');
  const router = useRouter();

  const [amount, setAmount] = useState(String(Math.round(outstandingPaisa / 100)));
  const [method, setMethod] = useState<(typeof METHODS)[number]>('BANK');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outstanding: number; overpaidBy: number } | null>(null);

  const needsReference = method !== 'CASH';

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/fees/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          invoiceId,
          amount: Math.round(Number(amount) * 100),
          method,
          reference: reference.trim() || null,
        }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not record')
            : 'Could not record';
        throw new Error(message);
      }
      setResult(json as { outstanding: number; overpaidBy: number });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="flex flex-col gap-2" data-testid="payment-recorded">
        <p className="text-body text-[var(--success)]">{t('recorded')}</p>
        <p className="text-small text-[var(--text-tertiary)]">
          {t('outstanding')}: {formatPaisa(result.outstanding)}
        </p>
        {result.overpaidBy > 0 ? (
          <p className="text-small text-[var(--warning)]" data-testid="overpaid-notice">
            {t('overpaid', { amount: formatPaisa(result.overpaidBy) })}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="record-payment">
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('amount')}</span>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          data-testid="payment-amount"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('method')}</span>
        <select
          className="min-h-tap rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={method}
          onChange={(event) => setMethod(event.target.value as (typeof METHODS)[number])}
          data-testid="payment-method"
        >
          {METHODS.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </label>

      {needsReference ? (
        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('reference')}</span>
          <Input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            data-testid="payment-reference"
          />
          <span className="text-small text-[var(--text-tertiary)]">{t('referenceHint')}</span>
        </label>
      ) : null}

      <Button
        onClick={submit}
        disabled={busy || amount === '' || (needsReference && reference.trim() === '')}
        data-testid="save-payment"
      >
        {busy ? t('saving') : t('save')}
      </Button>

      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="payment-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
