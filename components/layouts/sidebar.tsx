'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { NavItem } from './nav-config';
import { cn } from '@/lib/utils/cn';

/** Left sidebar on desktop at ≥1024px. Hidden below that, where the tab bar takes over. */
export function Sidebar({ items, schoolName }: { items: readonly NavItem[]; schoolName: string }) {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <nav
      aria-label={schoolName}
      className="hidden w-60 shrink-0 flex-col gap-1 border-e border-[var(--border-subtle)] bg-[var(--surface)] p-2 desktop:flex"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-tap items-center rounded-button px-2 text-body transition-colors duration-base ease-out',
              active
                ? 'bg-[var(--surface-raised)] font-medium text-[var(--text-primary)] shadow-raised'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
