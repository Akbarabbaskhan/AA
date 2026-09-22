import { DEFAULT_TIMEZONE, type Locale } from './config';

/** "Dates displayed as DD MMM YYYY, never ambiguous numeric formats." */
export function formatDate(date: Date, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: DEFAULT_TIMEZONE,
  }).format(date);
}

export function formatTime(date: Date, locale: Locale = 'en'): string {
  return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: DEFAULT_TIMEZONE,
  }).format(date);
}

/**
 * Money is held as integer paisa everywhere in the system. This is the only place it
 * becomes a decimal, and it happens at the very edge, for display.
 */
export function formatPkr(paisa: number, locale: Locale = 'en'): string {
  return new Intl.NumberFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(paisa / 100));
}

export function formatPercent(value: number, locale: Locale = 'en'): string {
  return new Intl.NumberFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}
