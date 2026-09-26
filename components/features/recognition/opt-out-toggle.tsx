'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * The student's own opt-out.
 *
 * Placed on the leaderboard itself rather than buried in settings: the moment a student
 * wonders whether they want to be on a public list is the moment they are looking at one.
 */
export function OptOutToggle({ optedOut }: { optedOut: boolean }) {
  const t = useTranslations('recognition');
  const router = useRouter();
  const [value, setValue] = useState(optedOut);
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean): Promise<void> {
    setValue(next);
    setBusy(true);
    try {
      const response = await fetch('/api/leaderboard/opt-out', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ optOut: next }),
      });
      if (!response.ok) throw new Error('Could not save');
      router.refresh();
    } catch {
      setValue(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex min-h-tap items-start gap-2" data-testid="opt-out-toggle">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 accent-[var(--accent)]"
        checked={value}
        disabled={busy}
        onChange={(event) => void toggle(event.target.checked)}
        data-testid="opt-out-checkbox"
      />
      <span className="flex flex-col">
        <span className="text-body text-[var(--text-primary)]">{t('optOut')}</span>
        <span className="text-small text-[var(--text-tertiary)]">{t('optOutHint')}</span>
      </span>
    </label>
  );
}
