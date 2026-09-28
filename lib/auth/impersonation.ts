import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Impersonation, as a signed cookie beside the session rather than inside it.
 *
 * "Impersonation by Super Admin must write an audit record and show a persistent banner in the
 * UI reading who is impersonating whom."
 *
 * The session JWT says who signed in, and it stays that way: rewriting it would make the
 * audit trail depend on a token that has already been issued, and ending an impersonation
 * would mean re-issuing it again. So the impersonation is a second, short-lived, signed cookie
 * that names the target — the real user is always the one in the session, which is exactly the
 * property an audit trail needs.
 *
 * Signed with the same secret as everything else and stamped with an expiry, so a copied
 * cookie is useless in an hour and a forged one is useless immediately.
 */

export const IMPERSONATION_COOKIE = 'volt_impersonation';
export const IMPERSONATION_TTL_MINUTES = 60;

const SECRET = () => process.env['NEXTAUTH_SECRET'] ?? 'volt-dev-only-impersonation-secret';

export function signImpersonation(targetUserId: string, expiresAt: number): string {
  const payload = `${targetUserId}.${expiresAt}`;
  const signature = createHmac('sha256', SECRET()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyImpersonation(value: string): { targetUserId: string } | null {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [targetUserId, rawExpiry, signature] = parts as [string, string, string];

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expected = createHmac('sha256', SECRET())
    .update(`${targetUserId}.${rawExpiry}`)
    .digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { targetUserId };
}

/** The target this request is impersonating, if any. */
export function currentImpersonation(): { targetUserId: string } | null {
  const cookie = cookies().get(IMPERSONATION_COOKIE);
  return cookie ? verifyImpersonation(cookie.value) : null;
}
