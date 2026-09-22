import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, passesAA, parseHex } from '@/lib/theme/contrast';
import { PALETTE_KEYS, parseTheme, themeToCss, type Palette } from '@/lib/theme/tokens';

const THEMES_DIR = join(process.cwd(), 'themes');
const themeFiles = readdirSync(THEMES_DIR).filter((file) => file.endsWith('.json'));

describe('contrast maths', () => {
  it('matches the known WCAG reference values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // #767676 is the darkest grey that still passes AA on white, and #777777 the first
    // that does not — the pair that catches an off-by-one in the luminance curve.
    expect(passesAA('#767676', '#FFFFFF')).toBe(true);
    expect(passesAA('#777777', '#FFFFFF')).toBe(false);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  it('reads both hex shorthands', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('0A0A0A')).toEqual({ r: 10, g: 10, b: 10 });
    expect(() => parseHex('#xyz')).toThrow();
  });
});

describe('themes', () => {
  it('ships at least the neutral Volt theme and the LGS tenant theme', () => {
    expect(themeFiles.sort()).toEqual(['lgs.json', 'volt-default.json']);
  });

  it.each(themeFiles)('%s parses against the token schema', (file) => {
    const theme = parseTheme(JSON.parse(readFileSync(join(THEMES_DIR, file), 'utf8')));
    expect(PALETTE_KEYS.every((key) => key in theme.light)).toBe(true);
    expect(PALETTE_KEYS.every((key) => key in theme.dark)).toBe(true);
  });

  describe.each(themeFiles)('%s', (file) => {
    const theme = parseTheme(JSON.parse(readFileSync(join(THEMES_DIR, file), 'utf8')));

    it.each(['light', 'dark'] as const)('%s mode passes WCAG AA', (mode) => {
      const palette: Palette = theme[mode];

      // "--brand-on-primary: Text on primary; must pass 4.5:1" — an acceptance criterion.
      expect(
        passesAA(palette.brandOnPrimary, palette.brandPrimary),
        `brandOnPrimary on brandPrimary is ${contrastRatio(
          palette.brandOnPrimary,
          palette.brandPrimary,
        ).toFixed(2)}:1`,
      ).toBe(true);

      expect(passesAA(palette.accentOn, palette.accent)).toBe(true);

      // "4.5:1 contrast minimum" applies to the whole text hierarchy, tertiary included —
      // which is exactly the token designers tend to let slide.
      for (const key of ['textPrimary', 'textSecondary', 'textTertiary'] as const) {
        expect(
          passesAA(palette[key], palette.bg),
          `${key} on bg is ${contrastRatio(palette[key], palette.bg).toFixed(2)}:1`,
        ).toBe(true);
        expect(
          passesAA(palette[key], palette.surface),
          `${key} on surface is ${contrastRatio(palette[key], palette.surface).toFixed(2)}:1`,
        ).toBe(true);
      }

      // Status colours are used as text, so they carry the same floor.
      for (const key of ['success', 'warning', 'danger', 'info'] as const) {
        expect(
          passesAA(palette[key], palette.bg),
          `${key} on bg is ${contrastRatio(palette[key], palette.bg).toFixed(2)}:1`,
        ).toBe(true);
      }
    });

    it('authors dark mode rather than inverting light', () => {
      // If dark were a mechanical inversion, at least one pair would be an exact complement.
      const inverted = PALETTE_KEYS.filter((key) => {
        const light = parseHex(theme.light[key]);
        const dark = parseHex(theme.dark[key]);
        return (
          light.r + dark.r === 255 && light.g + dark.g === 255 && light.b + dark.b === 255
        );
      });
      expect(inverted).toEqual([]);
    });
  });

  it('emits both theme blocks as CSS custom properties', () => {
    const theme = parseTheme(
      JSON.parse(readFileSync(join(THEMES_DIR, 'volt-default.json'), 'utf8')),
    );
    const css = themeToCss(theme);
    expect(css).toContain(':root {');
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toContain('prefers-color-scheme: dark');
    expect(css).toContain('--brand-primary:');
    expect(css).toContain('--text-tertiary:');
  });

  it('marks the LGS theme as not approved for public use', () => {
    // Section 18: build against the neutral theme, switch LGS on only for the pitch.
    const lgs = parseTheme(JSON.parse(readFileSync(join(THEMES_DIR, 'lgs.json'), 'utf8')));
    expect(lgs.publicUseApproved).toBe(false);
  });
});
