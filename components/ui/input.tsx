import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Roll numbers, voucher IDs and marks render in the mono face with tabular figures. */
  numeric?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, numeric = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      data-numeric={numeric ? '' : undefined}
      className={cn(
        'min-h-tap w-full rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2',
        'text-body text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]',
        'transition-colors duration-base ease-out',
        'focus:border-[var(--accent)] focus:outline-none focus-visible:outline-none',
        'disabled:opacity-50',
        numeric && 'font-mono',
        className,
      )}
      {...props}
    />
  );
});
