'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * Join, apply, or leave.
 *
 * An open society you join and are in. A selective one takes an application, and the button
 * says "apply" rather than "join" so nobody is surprised when they are not immediately a
 * member — the distinction is the society's, and pretending otherwise is how a student
 * turns up to a rehearsal they were never admitted to.
 */
export function MembershipButton({
  societyId,
  isOpen,
  isMember,
  isOfficer,
}: {
  societyId: string;
  isOpen: boolean;
  isMember: boolean;
  isOfficer: boolean;
}) {
  const t = useTranslations('societies');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(method: 'POST' | 'DELETE'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/societies/${societyId}/membership`, { method });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not do that')
            : 'Could not do that';
        throw new Error(message);
      }
      if (method === 'POST' && (json as { status?: string }).status === 'APPLIED') {
        setApplied(true);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not do that');
    } finally {
      setBusy(false);
    }
  }

  if (applied) {
    return (
      <span className="text-small text-[var(--success)]" data-testid="society-applied">
        {t('applied')}
      </span>
    );
  }

  if (isMember) {
    return (
      <span className="flex flex-col items-end gap-1">
        <span className="text-small text-[var(--success)]">{t('joined')}</span>
        {isOfficer ? (
          <span className="text-small text-[var(--text-tertiary)]">{t('officerCannotLeave')}</span>
        ) : (
          <Button variant="ghost" onClick={() => act('DELETE')} disabled={busy} data-testid="leave-society">
            {t('leave')}
          </Button>
        )}
        {error ? <span className="text-small text-[var(--danger)]">{error}</span> : null}
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button onClick={() => act('POST')} disabled={busy} data-testid="join-society">
        {isOpen ? t('join') : t('apply')}
      </Button>
      {error ? <span className="text-small text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}
