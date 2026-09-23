'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PreferenceRow } from '@/lib/services/notifications/inbox';

/**
 * The preference matrix.
 *
 * One row per notification type, one switch per channel. In-app is shown and locked on —
 * it is the record of what the school sent, and a recipient who turns it off leaves both
 * sides with nothing to point at when there is a disagreement.
 */
export function NotificationPreferences({ rows }: { rows: PreferenceRow[] }) {
  const t = useTranslations('notifications');
  const [state, setState] = useState(rows);
  const [error, setError] = useState<string | null>(null);

  async function toggle(type: string, channel: string, enabled: boolean): Promise<void> {
    // Optimistic: a switch that waits for a round trip before moving feels broken.
    setState((previous) =>
      previous.map((row) =>
        row.type === type
          ? {
              ...row,
              channels: row.channels.map((entry) =>
                entry.channel === channel ? { ...entry, enabled, isDefault: false } : entry,
              ),
            }
          : row,
      ),
    );
    setError(null);

    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, channel, enabled }),
      });
      if (!response.ok) throw new Error('Could not save');
    } catch {
      setError('Could not save');
      setState(rows);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="notification-preferences">
      {state.map((row) => (
        <div
          key={row.type}
          className="flex flex-col gap-2 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
        >
          <span className="flex items-baseline gap-2">
            <span className="text-body text-[var(--text-primary)]">{row.type}</span>
            {row.isUrgent ? (
              <span className="rounded-pill border border-[var(--warning)] px-2 text-small text-[var(--warning)]">
                {t('urgent')}
              </span>
            ) : null}
          </span>

          <div className="flex flex-wrap gap-3">
            {row.channels.map((entry) => {
              const locked = entry.channel === 'IN_APP';
              return (
                <label
                  key={entry.channel}
                  className="flex min-h-tap items-center gap-2"
                  title={locked ? t('inAppLocked') : undefined}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--accent)]"
                    checked={entry.enabled}
                    disabled={locked}
                    onChange={(event) => void toggle(row.type, entry.channel, event.target.checked)}
                  />
                  <span
                    className={
                      locked
                        ? 'text-small text-[var(--text-tertiary)]'
                        : 'text-small text-[var(--text-secondary)]'
                    }
                  >
                    {t(`channel${entry.channel}`)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
