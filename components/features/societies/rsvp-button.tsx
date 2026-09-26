'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * Saying yes to an event.
 *
 * The waitlist is shown honestly: a student who taps a full event is told they are fourth
 * in line, not given a confirmation they will have to un-learn at the door. And the button
 * that gives a place up says "can't make it" rather than "cancel", because the difference
 * matters to whoever is next on the list.
 */
export function RsvpButton({
  eventId,
  status,
  waitlistPosition,
  placesLeft,
}: {
  eventId: string;
  status: string | null;
  waitlistPosition: number | null;
  placesLeft: number | null;
}) {
  const t = useTranslations('events');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; waitlistPosition: number | null } | null>(
    null,
  );

  const current = result?.status ?? status;
  const position = result?.waitlistPosition ?? waitlistPosition;

  async function act(method: 'POST' | 'DELETE'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/events/${eventId}/rsvp`, { method });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not reply')
            : 'Could not reply';
        throw new Error(message);
      }
      if (method === 'POST') {
        setResult(json as { status: string; waitlistPosition: number | null });
      } else {
        setResult({ status: 'NOT_GOING', waitlistPosition: null });
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reply');
    } finally {
      setBusy(false);
    }
  }

  if (current === 'GOING') {
    return (
      <span className="flex flex-col items-end gap-1">
        <span className="text-small text-[var(--success)]" data-testid="rsvp-going">
          {t('youAreGoing')}
        </span>
        <Button variant="ghost" onClick={() => act('DELETE')} disabled={busy} data-testid="cancel-rsvp">
          {t('cancelRsvp')}
        </Button>
        {error ? <span className="text-small text-[var(--danger)]">{error}</span> : null}
      </span>
    );
  }

  if (current === 'WAITLIST') {
    return (
      <span className="flex flex-col items-end gap-1">
        <span className="text-small text-[var(--warning)]" data-testid="rsvp-waitlisted">
          {position ? t('yourPosition', { position }) : t('waitlist')}
        </span>
        {/* Same action, same hook as the going state: leaving a waitlist is cancelling. */}
        <Button
          variant="ghost"
          onClick={() => act('DELETE')}
          disabled={busy}
          data-testid="cancel-rsvp"
        >
          {t('cancelRsvp')}
        </Button>
        {error ? <span className="text-small text-[var(--danger)]">{error}</span> : null}
      </span>
    );
  }

  const isFull = placesLeft === 0;

  return (
    <span className="flex flex-col items-end gap-1">
      <Button onClick={() => act('POST')} disabled={busy} data-testid="rsvp">
        {isFull ? t('waitlist') : t('rsvp')}
      </Button>
      {isFull ? <span className="text-small text-[var(--text-tertiary)]">{t('full')}</span> : null}
      {error ? <span className="text-small text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}
