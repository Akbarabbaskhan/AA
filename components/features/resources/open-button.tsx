'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * Opens a resource.
 *
 * Deliberately a POST rather than a link to the file: the download count is what tells a
 * teacher whether anyone actually opened the revision pack, and the server hands back a
 * short-lived URL rather than exposing the storage key in the page.
 */
export function OpenResourceButton({ resourceId, isVideo }: { resourceId: string; isVideo: boolean }) {
  const t = useTranslations('resources');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/resources/${resourceId}/open`, { method: 'POST' });
      const json: unknown = await response.json();
      if (!response.ok) throw new Error('Could not open');
      const url = (json as { url?: string }).url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('open'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex flex-col gap-1">
      <Button variant="secondary" onClick={open} disabled={busy} data-testid="open-resource">
        {isVideo ? t('watch') : t('download')}
      </Button>
      {error ? <span className="text-small text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}
