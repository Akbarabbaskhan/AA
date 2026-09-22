'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { NavItem } from './nav-config';
import { cn } from '@/lib/utils/cn';

/**
 * Bottom tab bar on mobile, five items at most.
 *
 * Bottom-anchored so the primary destinations are reachable with a thumb — never top-right,
 * which is where a teacher's hand is not when they are holding a phone in a lab.
 */
export function BottomTabBar({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] pb-[env(safe-area-inset-bottom)] desktop:hidden"
    >
      <ul className="flex">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-tap flex-col items-center justify-center gap-1 px-1 py-1 text-small transition-colors duration-base ease-out',
                  active
                    ? 'font-medium text-[var(--accent)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                <span className="truncate">{t(item.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
