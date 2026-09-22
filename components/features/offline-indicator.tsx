'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { pendingCount } from '@/lib/offline/attendance-queue';
import { drainQueue } from '@/lib/offline/sync-client';
import { cn } from '@/lib/utils/cn';

/**
 * "Clear online/offline indicator and a pending-sync count."
 *
 * A teacher who has just marked a register in a lab with no signal needs to see, without
 * asking anyone, that their work is safe and what is still waiting.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

export function OfflineIndicator({ className }: { className?: string }) {
  const t = useTranslations('offline');
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [superseded, setSuperseded] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setPending(await pendingCount());
    } catch {
      // No IndexedDB (private window, or an old browser) — the app still works online.
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const outcome = await drainQueue();
      if (outcome.superseded > 0) setSuperseded((current) => current + outcome.superseded);
    } catch {
      // Still offline, or the request failed. The queue keeps everything.
    } finally {
      setSyncing(false);
      await refresh();
    }
  }, [refresh, syncing]);

  useEffect(() => {
    void refresh();
    // Other tabs and the register itself queue work; poll rather than wire a bus for it.
    const interval = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!online) return;
    // Back online: drain immediately. This is what makes the 60-second acceptance
    // criterion hold without the teacher doing anything.
    void sync();
  }, [online, sync]);

  if (online && pending === 0 && superseded === 0) return null;

  if (online && pending === 0 && superseded > 0) {
    return (
      <p
        role="alert"
        className={cn('rounded-card bg-[var(--warning)] px-2 py-1 text-small text-[var(--brand-on-primary)]', className)}
      >
        {t('superseded', { count: superseded })}
      </p>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center justify-between gap-2 rounded-card px-2 py-1 text-small',
        online
          ? 'bg-[var(--surface)] text-[var(--text-secondary)]'
          : 'bg-[var(--warning)] text-[var(--brand-on-primary)]',
        className,
      )}
    >
      <span className="flex items-center gap-1">
        <span
          aria-hidden
          className={cn(
            'inline-block h-2 w-2 rounded-pill',
            online ? 'bg-[var(--success)]' : 'bg-[var(--brand-on-primary)]',
          )}
        />
        {online ? t('online') : t('offline')}
        {pending > 0 ? <> · {t('pending', { count: pending })}</> : null}
      </span>

      {online && pending > 0 ? (
        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing}
          className="min-h-tap px-1 underline disabled:opacity-60"
        >
          {syncing ? t('syncing') : t('syncNow')}
        </button>
      ) : null}
    </div>
  );
}
