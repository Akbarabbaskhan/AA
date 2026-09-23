'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** The coordinator's approve or decline, which notifies the guardian either way. */
export function LeaveDecision({ requestId }: { requestId: string }) {
  const t = useTranslations('parents');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: 'APPROVED' | 'REJECTED'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/leave/${requestId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error('Could not save');
      router.refresh();
    } catch {
      setError('Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button onClick={() => decide('APPROVED')} disabled={busy} data-testid="approve-leave">
          {t('leaveStatusAPPROVED')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => decide('REJECTED')}
          disabled={busy}
          data-testid="reject-leave"
        >
          {t('leaveStatusREJECTED')}
        </Button>
      </div>
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
