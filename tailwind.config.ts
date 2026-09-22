import type { Config } from 'tailwindcss';

/**
 * Tailwind reads the CSS custom properties rather than holding colour values itself, so a
 * tenant theme swap is a JSON file change with no rebuild of the design system.
 * There are no hex codes here, and there must be none in component code either.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'var(--brand-primary)',
          on: 'var(--brand-on-primary)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          on: 'var(--accent-on)',
        },
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
        },
        status: {
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // The type scale from the design system, tracking included.
        display: ['clamp(2.5rem, 5vw, 4rem)', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '600' }],
        h1: ['2rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        h2: ['1.5rem', { lineHeight: '1.3', letterSpacing: '-0.01em', fontWeight: '600' }],
        h3: ['1.125rem', { lineHeight: '1.4', letterSpacing: '-0.01em', fontWeight: '600' }],
        body: ['0.9375rem', { lineHeight: '1.6', letterSpacing: '0' }],
        small: ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0' }],
        mono: ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0', fontWeight: '500' }],
      },
      spacing: {
        // 8px scale.
        1: '0.5rem',
        2: '1rem',
        3: '1.5rem',
        4: '2rem',
        5: '2.5rem',
        6: '3rem',
        8: '4rem',
        // Section rhythm: 96px desktop, 64px mobile.
        section: '6rem',
        'section-mobile': '4rem',
        /** Minimum tap target. */
        tap: '2.75rem',
      },
      borderRadius: {
        input: '8px',
        button: '8px',
        card: '12px',
        sheet: '16px',
        pill: '999px',
      },
      maxWidth: {
        container: '1200px',
        reading: '720px',
      },
      boxShadow: {
        // Depth through elevation, not ornament: soft and low-opacity.
        raised: '0 1px 2px rgb(0 0 0 / 0.04), 0 2px 8px rgb(0 0 0 / 0.04)',
        overlay: '0 8px 32px rgb(0 0 0 / 0.12)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        fast: '150ms',
        base: '200ms',
        slow: '250ms',
      },
      screens: {
        // The two breakpoints the spec names explicitly.
        tablet: '768px',
        desktop: '1024px',
      },
    },
  },
  plugins: [],
};

export default config;
