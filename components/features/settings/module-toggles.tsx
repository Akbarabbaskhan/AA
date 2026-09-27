'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

/**
 * The per-module kill switches.
 *
 * Saved one at a time and immediately, because this is the control a head teacher reaches for
 * when something is going wrong in a live school — burying it behind a Save button at the
 * bottom of a long form is how it gets clicked twice in a panic.
 */
export function ModuleToggles({ flags }: { flags: Record<string, boolean> }) {
  const t = useTranslations('settings');
  const router = useRouter();
  const [state, setState] = useState(flags);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(module: string, enabled: boolean): Promise<void> {
    setBusy(module);
    setState((current) => ({ ...current, [module]: enabled }));
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ module, enabled }),
      });
      if (!response.ok) throw new Error('Could not save');
      router.refresh();
    } catch {
      setState((current) => ({ ...current, [module]: !enabled }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="grid gap-2 tablet:grid-cols-2 desktop:grid-cols-3" data-testid="module-toggles">
      {Object.entries(state).map(([module, enabled]) => (
        <li key={module}>
          <label className="flex min-h-tap items-center gap-2">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--accent)]"
              checked={enabled}
              disabled={busy === module}
              onChange={(event) => void toggle(module, event.target.checked)}
              data-testid={`module-${module}`}
            />
            <span className="text-body text-[var(--text-primary)]">{t(`module.${module}`)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}
