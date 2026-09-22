'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { VaultFacets } from '@/lib/services/papers/vault';

/**
 * The vault's filters.
 *
 * Every filter is a URL parameter rather than component state: a student who finds "9701 P4,
 * never attempted" can send that link to a friend, and the back button behaves.
 *
 * Selecting a filter navigates immediately — no Apply button. A filter bar with an Apply
 * step is one that people set wrong and never notice.
 */
export function VaultFilters({
  facets,
  isStudent,
}: {
  facets: VaultFacets;
  isStudent: boolean;
}) {
  const t = useTranslations('papers');
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /*
   * The "never attempted" switch is held locally as well as in the URL.
   *
   * A controlled checkbox reading straight from the search params snaps back to its old
   * state for as long as the navigation takes, so on a slow connection a student taps it
   * and watches nothing happen. Showing their intent immediately and reconciling when the
   * URL catches up is the honest behaviour; the URL stays the source of truth.
   */
  const urlUnattempted = params.get('onlyUnattempted') === 'true';
  const [onlyUnattempted, setOnlyUnattempted] = useState(urlUnattempted);
  useEffect(() => setOnlyUnattempted(urlUnattempted), [urlUnattempted]);

  function set(key: string, value: string | null): void {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    // A new filter always starts at the first page.
    next.delete('cursor');
    startTransition(() => router.replace(`/papers?${next.toString()}`));
  }

  const selectClass =
    'min-h-tap w-full rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] ' +
    'px-3 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 ' +
    'focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

  return (
    <div
      className="flex flex-col gap-3"
      aria-busy={isPending}
      data-testid="vault-filters"
    >
      <div className="grid grid-cols-2 gap-2 desktop:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('subject')}</span>
          <select
            className={selectClass}
            value={params.get('subjectId') ?? ''}
            onChange={(event) => set('subjectId', event.target.value)}
          >
            <option value="">{t('all')}</option>
            {facets.subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name} ({subject.papers})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('year')}</span>
          <select
            className={selectClass}
            value={params.get('yearFrom') ?? ''}
            onChange={(event) => {
              const year = event.target.value;
              set('yearFrom', year);
              set('yearTo', year);
            }}
          >
            <option value="">{t('all')}</option>
            {facets.years.map((year) => (
              <option key={year} value={String(year)}>
                {year}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('session')}</span>
          <select
            className={selectClass}
            value={params.get('session') ?? ''}
            onChange={(event) => set('session', event.target.value)}
          >
            <option value="">{t('all')}</option>
            <option value="MAY_JUNE">May / June</option>
            <option value="OCT_NOV">Oct / Nov</option>
            <option value="FEB_MARCH">Feb / March</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('variant')}</span>
          <select
            className={selectClass}
            value={params.get('variant') ?? ''}
            onChange={(event) => set('variant', event.target.value)}
          >
            <option value="">{t('all')}</option>
            {[1, 2, 3].map((variant) => (
              <option key={variant} value={String(variant)}>
                {variant}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isStudent ? (
        <label className="flex min-h-tap items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={onlyUnattempted}
            onChange={(event) => {
              setOnlyUnattempted(event.target.checked);
              set('onlyUnattempted', event.target.checked ? 'true' : null);
            }}
            data-testid="only-unattempted"
          />
          <span className="text-body text-[var(--text-primary)]">{t('neverAttempted')}</span>
          <span className="text-small text-[var(--text-tertiary)]">{t('neverAttemptedHint')}</span>
        </label>
      ) : null}
    </div>
  );
}
