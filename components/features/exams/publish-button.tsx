'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Publishes a whole series at once.
 *
 * The warning is not decoration: publication makes every mark visible to every family
 * simultaneously and freezes a result card each. It is the least reversible thing a
 * coordinator does in the app, so it asks first.
 */
export function PublishButton({
  examSeriesId,
  isPublished,
}: {
  examSeriesId: string;
  isPublished: boolean;
}) {
  const t = useTranslations('exams');
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function publish() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/exam-series/${examSeriesId}/publish`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Server responded ${response.status}`);
      }
      const result = (await response.json()) as { resultCards: number };
      setMessage(t('publishedResult', { cards: result.resultCards }));
      // The server component re-renders and the card flips to "Published". This component
      // stays mounted either way — see below — so the confirmation survives the refresh
      // instead of vanishing at the moment it is needed.
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not publish');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (message) {
    return (
      <p role="status" className="text-body text-[var(--success)]">
        {message}
      </p>
    );
  }

  /*
   * Rendered for anyone who may publish, whether or not the series is a draft. Rendering it
   * only for drafts unmounts it the instant the publish succeeds, taking the confirmation
   * with it — the coordinator presses the button and sees nothing happen.
   */
  if (isPublished) return null;

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
        {t('publish')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-[var(--border-subtle)] p-2">
      <p className="text-body text-[var(--text-secondary)]">{t('publishWarning')}</p>
      <div className="flex gap-1">
        {/* Distinct labels from the trigger above: two buttons with the same accessible
            name in one view is ambiguous for a screen reader and for anyone scanning it. */}
        <Button type="button" onClick={() => void publish()} disabled={busy}>
          {busy ? t('publishing') : t('publishNow')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
          {t('keepDraft')}
        </Button>
      </div>
    </div>
  );
}
