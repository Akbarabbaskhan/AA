/**
 * Pakistani mobile numbers, normalised to E.164.
 *
 * Phone is the real identifier in this market — a parent will type `0300 1234567`,
 * `+92 300 1234567` or `92-300-1234567` and expect all three to reach the same account.
 */
const PK_COUNTRY_CODE = '92';

export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (digits.length === 0) return null;

  let rest = digits.startsWith('+') ? digits.slice(1) : digits;

  if (rest.startsWith('00')) rest = rest.slice(2);

  if (rest.startsWith(PK_COUNTRY_CODE) && rest.length === 12) {
    return `+${rest}`;
  }
  // Local format: 03001234567
  if (rest.startsWith('0') && rest.length === 11) {
    return `+${PK_COUNTRY_CODE}${rest.slice(1)}`;
  }
  // Bare national number: 3001234567
  if (rest.length === 10 && rest.startsWith('3')) {
    return `+${PK_COUNTRY_CODE}${rest}`;
  }
  // Anything else that already looks international is left alone.
  if (digits.startsWith('+') && rest.length >= 8 && rest.length <= 15) {
    return `+${rest}`;
  }
  return null;
}

export function looksLikeEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

/** Masks a number for display in logs and support screens — never log a full number. */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '***';
  return `${phone.slice(0, 3)}****${phone.slice(-3)}`;
}
