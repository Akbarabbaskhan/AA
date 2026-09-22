import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * The three states every list view must have, as components rather than as a convention
 * people remember. "Content first on load" — a skeleton that matches the final layout,
 * never a spinner covering the page.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton h-4 w-full', className)} />;
}

export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="status" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-2 rounded-card border border-[var(--border-subtle)] p-3"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-pill" />
          <div className="flex w-full flex-col gap-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** An empty state always names the next action — never just "No data". */
export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-dashed border-[var(--border-subtle)] px-3 py-8 text-center">
      {icon ? <div className="text-[var(--text-tertiary)]">{icon}</div> : null}
      <h3 className="text-h3 text-[var(--text-primary)]">{title}</h3>
      {body ? <p className="max-w-reading text-body text-[var(--text-secondary)]">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-card border border-[var(--border-subtle)] px-3 py-8 text-center"
    >
      <h3 className="text-h3 text-[var(--danger)]">{title}</h3>
      {body ? <p className="max-w-reading text-body text-[var(--text-secondary)]">{body}</p> : null}
      {action}
    </div>
  );
}
