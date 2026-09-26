'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** Admits an applicant to a selective society. Officers and the staff advisor only. */
export function AdmitButton({ societyId, studentId }: { societyId: string; studentId: string }) {
  const t = useTranslations('societies');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function admit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/societies/${societyId}/members`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId, role: 'MEMBER' }),
      });
      if (!response.ok) throw new Error('Could not admit');
      router.refresh();
    } catch {
      setError('Could not admit');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button onClick={admit} disabled={busy} data-testid="admit-applicant">
        {t('admit')}
      </Button>
      {error ? <span className="text-small text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}
