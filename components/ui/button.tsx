import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * One accent colour per screen; everything else greyscale. There are no gradients here
 * and no glassmorphism — depth comes from elevation.
 */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-button font-medium ' +
    'transition-colors duration-base ease-out ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-[var(--accent)] ' +
    'disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-[var(--accent)] text-[var(--accent-on)] hover:opacity-90',
        secondary:
          'bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)]',
        ghost: 'text-[var(--text-secondary)] hover:bg-[var(--surface)] hover:text-[var(--text-primary)]',
        danger: 'bg-[var(--danger)] text-[var(--brand-on-primary)] hover:opacity-90',
      },
      size: {
        // Every size clears the 44×44px tap target.
        md: 'min-h-tap px-3 text-body',
        lg: 'min-h-[3rem] px-4 text-body',
        icon: 'min-h-tap min-w-tap',
      },
      full: {
        true: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, full, asChild = false, ...props },
  ref,
) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component ref={ref} className={cn(button({ variant, size, full }), className)} {...props} />
  );
});
