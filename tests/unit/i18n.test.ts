import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, direction, isLocale } from '@/lib/i18n/config';
import { formatDate, formatPkr } from '@/lib/i18n/format';

type Messages = Record<string, unknown>;

function load(locale: string): Messages {
  return JSON.parse(readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf8'));
}

function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('i18n', () => {
  it('ships English and Urdu', () => {
    expect([...LOCALES]).toEqual(['en', 'ur']);
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('lays Urdu out right to left', () => {
    expect(direction('ur')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
  });

  it('keeps every locale file on exactly the same keys', () => {
    // A missing Urdu string is a blank label in a parent's portal, which is the one
    // surface where Urdu is a requirement rather than a nice-to-have.
    const en = flatten(load('en')).sort();
    const ur = flatten(load('ur')).sort();
    expect(ur).toEqual(en);
  });

  it('actually translates rather than copying English through', () => {
    const en = load('en') as { auth: { errors: Record<string, string> } };
    const ur = load('ur') as { auth: { errors: Record<string, string> } };
    for (const key of Object.keys(en.auth.errors)) {
      expect(ur.auth.errors[key]).not.toBe(en.auth.errors[key]);
      expect(ur.auth.errors[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('recognises only supported locales', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('ur')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it('formats dates unambiguously', () => {
    // 14 October 2026, never 10/14/2026 or 14/10/2026.
    expect(formatDate(new Date('2026-10-14T06:00:00Z'), 'en')).toBe('14 Oct 2026');
  });

  it('formats paisa as rupees', () => {
    // 4,500,000 paisa is PKR 45,000.
    const formatted = formatPkr(4_500_000, 'en');
    expect(formatted).toContain('45,000');
    expect(formatted).not.toContain('.00');
  });
});
