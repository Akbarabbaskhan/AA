export const LOCALES = ['en', 'ur'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Urdu runs right to left — the layout has to know, not just the font. */
export const RTL_LOCALES: readonly Locale[] = ['ur'];

export const LOCALE_COOKIE = 'volt_locale';

export function isLocale(value: string | undefined): value is Locale {
  return value !== undefined && (LOCALES as readonly string[]).includes(value);
}

export function direction(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  ur: 'اردو',
};

/** Pakistan Standard Time. Stored as UTC, displayed local. */
export const DEFAULT_TIMEZONE = 'Asia/Karachi';
