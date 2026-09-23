import { formatPaisa } from '@/lib/services/fees/money';

/**
 * Money on screen.
 *
 * Always tabular numerals and always right-aligned, because a column of fees that does not
 * line up is one a bursar cannot scan — and scanning a column for the odd figure is most of
 * what the accounts office does with these screens.
 */
export function Money({
  paisa,
  className,
  muted,
}: {
  paisa: number;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      data-numeric
      className={[
        'tabular-nums',
        muted ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]',
        className ?? '',
      ].join(' ')}
    >
      {formatPaisa(paisa)}
    </span>
  );
}

/** The aging and status chips. One shape, so the eye learns it once. */
export function StatusChip({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const tones = {
    ok: 'text-[var(--success)] border-[var(--success)]',
    warn: 'text-[var(--warning)] border-[var(--warning)]',
    bad: 'text-[var(--danger)] border-[var(--danger)]',
    muted: 'text-[var(--text-tertiary)] border-[var(--border-subtle)]',
  } as const;

  return (
    <span className={`rounded-pill border px-2 py-0.5 text-small ${tones[tone]}`}>{label}</span>
  );
}

export function toneForStatus(status: string): 'ok' | 'warn' | 'bad' | 'muted' {
  if (status === 'PAID' || status === 'WAIVED') return 'ok';
  if (status === 'OVERDUE') return 'bad';
  if (status === 'PARTIAL') return 'warn';
  return 'muted';
}
