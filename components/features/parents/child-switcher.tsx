'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { Child } from '@/lib/services/parents';

/**
 * The child switcher.
 *
 * Chips rather than a dropdown: a parent with two children switches constantly, and a
 * two-tap select for a two-item list is friction on the screen they open most. The choice
 * lives in the URL so the back button behaves and a bookmark keeps the child.
 *
 * Hidden entirely for a single child — a switcher with one option is noise.
 */
/*
 * The prop is `students`, not `children`: `children` is React's own, and a component that
 * takes a list under that name behaves in ways nobody reading the call site expects.
 */
export function ChildSwitcher({ students, activeId }: { students: Child[]; activeId: string }) {
  const t = useTranslations('parents');
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (students.length < 2) return null;

  function select(studentId: string): void {
    const next = new URLSearchParams(params.toString());
    next.set('studentId', studentId);
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <nav aria-label={t('switchChild')} className="flex flex-wrap gap-2" aria-busy={isPending}>
      {students.map((child) => {
        const isActive = child.id === activeId;
        return (
          <button
            key={child.id}
            type="button"
            onClick={() => select(child.id)}
            aria-current={isActive ? 'true' : undefined}
            className={[
              'min-h-tap rounded-pill border px-3 py-2 text-body transition-colors',
              isActive
                ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-on)]'
                : 'border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
            ].join(' ')}
            data-testid="child-chip"
          >
            {child.name.split(/\s+/)[0]}
          </button>
        );
      })}
    </nav>
  );
}
