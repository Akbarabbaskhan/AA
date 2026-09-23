'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * One slot in the grid.
 *
 * The race is real — two parents tap the same 4:10 at the same moment — so the server
 * claims it conditionally and this shows whichever answer comes back. A parent who loses
 * is told plainly and the grid refreshes, rather than being left believing they have a
 * booking the teacher has never heard of.
 */
export function BookSlot({
  slotId,
  label,
  status,
  isMine,
}: {
  slotId: string;
  label: string;
  status: string;
  isMine: boolean;
}) {
  const t = useTranslations('parents');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/slots/${slotId}`, {
        method: isMine ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: isMine ? undefined : JSON.stringify({ note: null }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not book')
            : 'Could not book';
        throw new Error(message);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not book');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const taken = status === 'BOOKED' && !isMine;

  return (
    <span className="flex flex-col gap-1">
      <button
        type="button"
        onClick={act}
        disabled={busy || taken}
        aria-label={`${label} ${isMine ? t('yourBooking') : taken ? t('booked') : t('book')}`}
        className={[
          'min-h-tap rounded-button border px-3 py-2 text-body transition-colors',
          isMine
            ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]'
            : taken
              ? 'cursor-not-allowed border-[var(--border-subtle)] text-[var(--text-tertiary)] line-through'
              : 'border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--border-strong)]',
        ].join(' ')}
        data-testid={isMine ? 'my-slot' : taken ? 'taken-slot' : 'open-slot'}
      >
        {label}
      </button>
      {error ? <span className="max-w-[10rem] text-small text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}
