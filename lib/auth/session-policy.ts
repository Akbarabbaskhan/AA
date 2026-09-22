import type { RoleName } from '@prisma/client';

/**
 * "Sessions 30 days on mobile, 12 hours for admin and bursar roles."
 *
 * The privileged roles win: an account that is both a teacher and a bursar gets 12 hours,
 * because the shorter window is the one that limits the damage.
 */
const PRIVILEGED_ROLES: readonly RoleName[] = ['ADMIN', 'BURSAR', 'SUPERADMIN'];

export const SESSION_SECONDS = {
  standard: 30 * 24 * 60 * 60,
  privileged: 12 * 60 * 60,
} as const;

export function sessionMaxAge(roles: readonly RoleName[]): number {
  return roles.some((role) => PRIVILEGED_ROLES.includes(role))
    ? SESSION_SECONDS.privileged
    : SESSION_SECONDS.standard;
}

/** Roles for which TOTP is offered (and may be required by school settings). */
export function twoFactorEligible(roles: readonly RoleName[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.includes(role));
}

/**
 * Absolute session expiry, enforced per role.
 *
 * NextAuth's own `session.maxAge` is a single global value and it overwrites whatever `exp`
 * the jwt callback sets, so a per-role window cannot be expressed through it. Instead the
 * token carries its own deadline and every request checks it here.
 */
export const SESSION_EXPIRY_CLAIM = 'voltExpiresAt';

export function sessionDeadline(roles: readonly RoleName[], now = Date.now()): number {
  return now + sessionMaxAge(roles) * 1000;
}

export function isSessionExpired(
  token: Record<string, unknown> | null | undefined,
  now = Date.now(),
): boolean {
  if (!token) return true;
  const deadline = token[SESSION_EXPIRY_CLAIM];
  // A token with no deadline predates this check — treat it as expired rather than
  // granting it an unbounded session.
  if (typeof deadline !== 'number') return true;
  return now >= deadline;
}
