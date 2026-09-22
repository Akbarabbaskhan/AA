/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * `--brand-on-primary` "must pass 4.5:1" is an acceptance criterion, so it needs to be
 * checkable rather than eyeballed — tests/unit/theme.test.ts asserts it for every theme.
 */
export type Rgb = { r: number; g: number; b: number };

export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }

  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(colour: Rgb): number {
  return (
    0.2126 * channelLuminance(colour.r) +
    0.7152 * channelLuminance(colour.g) +
    0.0722 * channelLuminance(colour.b)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(parseHex(foreground));
  const b = relativeLuminance(parseHex(background));
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL_TEXT = 4.5;
export const WCAG_AA_LARGE_TEXT = 3;

export function passesAA(foreground: string, background: string, large = false): boolean {
  const required = large ? WCAG_AA_LARGE_TEXT : WCAG_AA_NORMAL_TEXT;
  // Round to two places first: a ratio of 4.4996 is not a passing 4.5 by any useful reading,
  // but 4.499999 from float error on an exactly-4.5 pair is.
  return Math.round(contrastRatio(foreground, background) * 100) / 100 >= required;
}
