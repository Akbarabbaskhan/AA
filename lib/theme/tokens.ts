import { z } from 'zod';

/**
 * A tenant theme is a JSON file, so a second school is a new file and nothing else.
 * No hex codes anywhere in component code — components only ever read `var(--token)`.
 */
const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour');

const paletteSchema = z.object({
  /** Tenant's primary brand colour. */
  brandPrimary: hex,
  /** Text on primary; must pass 4.5:1 against brandPrimary. */
  brandOnPrimary: hex,
  /** The single interactive accent. Defaults to brandPrimary. */
  accent: hex,
  accentOn: hex,

  /** Three background depths. */
  bg: hex,
  surface: hex,
  surfaceRaised: hex,

  textPrimary: hex,
  textSecondary: hex,
  textTertiary: hex,

  borderSubtle: hex,
  borderStrong: hex,

  /** Status only, never brand. */
  success: hex,
  warning: hex,
  danger: hex,
  info: hex,
});

export const themeSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  logoUrl: z.string().optional(),
  faviconUrl: z.string().optional(),
  loginImageUrl: z.string().optional(),
  /** Set false for a theme that may not be shown publicly — see the branding section. */
  publicUseApproved: z.boolean().default(false),
  light: paletteSchema,
  /** Dark mode is a first-class theme, not an inversion — it is authored, not derived. */
  dark: paletteSchema,
});

export type Theme = z.infer<typeof themeSchema>;
export type Palette = z.infer<typeof paletteSchema>;

const CSS_VARIABLE_NAMES: Record<keyof Palette, string> = {
  brandPrimary: '--brand-primary',
  brandOnPrimary: '--brand-on-primary',
  accent: '--accent',
  accentOn: '--accent-on',
  bg: '--bg',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textTertiary: '--text-tertiary',
  borderSubtle: '--border-subtle',
  borderStrong: '--border-strong',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  info: '--info',
};

export const PALETTE_KEYS = Object.keys(CSS_VARIABLE_NAMES) as (keyof Palette)[];

function declarations(palette: Palette): string {
  return PALETTE_KEYS.map((key) => `  ${CSS_VARIABLE_NAMES[key]}: ${palette[key]};`).join('\n');
}

/**
 * Serialises a theme to the two blocks the app ships: `:root` for light and
 * `[data-theme="dark"]` for dark, exactly as the design system section requires.
 */
export function themeToCss(theme: Theme): string {
  return [
    `:root {\n${declarations(theme.light)}\n}`,
    `[data-theme="dark"] {\n${declarations(theme.dark)}\n}`,
    // Respect the OS preference when the user has not chosen explicitly.
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${declarations(
      theme.dark,
    )
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')}\n  }\n}`,
  ].join('\n\n');
}

export function parseTheme(input: unknown): Theme {
  return themeSchema.parse(input);
}
