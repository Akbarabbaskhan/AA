'use client';

import { useState } from 'react';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';

/**
 * The language toggle.
 *
 * Two words, both written in their own script, so somebody who cannot read the current
 * interface can still find the other one. A dropdown labelled "Language" in English is
 * exactly the control an Urdu-speaking parent cannot use.
 *
 * The choice is saved to the account rather than only to this browser, because it also
 * decides which language the school's WhatsApp messages arrive in.
 */
export function LanguageToggle({ current }: { current: Locale }) {
  const [locale, setLocale] = useState<Locale>(current);
  const [busy, setBusy] = useState(false);

  async function choose(next: Locale): Promise<void> {
    if (next === locale || busy) return;
    setBusy(true);
    setLocale(next);
    try {
      await fetch('/api/locale', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      });
      /*
       * A full reload, not `router.refresh()`.
       *
       * The `lang` and `dir` attributes live on the root <html> element, which a soft
       * refresh does not repaint — so a refresh would leave Urdu text laid out left to
       * right, which is worse than not switching at all.
       */
      window.location.reload();
    } catch {
      setLocale(locale);
      setBusy(false);
    }
  }

  return (
    <div
      className="flex gap-1 rounded-pill border border-[var(--border-subtle)] p-0.5"
      role="group"
      aria-label={LOCALES.map((entry) => LOCALE_LABELS[entry]).join(' / ')}
      aria-busy={busy}
      data-testid="language-toggle"
    >
      {LOCALES.map((entry) => (
        <button
          key={entry}
          type="button"
          lang={entry}
          onClick={() => void choose(entry)}
          disabled={busy}
          aria-pressed={locale === entry}
          className={[
            'min-h-tap rounded-pill px-3 text-small transition-colors',
            locale === entry
              ? 'bg-[var(--accent)] text-[var(--accent-on)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
          ].join(' ')}
          data-testid={`locale-${entry}`}
        >
          {LOCALE_LABELS[entry]}
        </button>
      ))}
    </div>
  );
}
