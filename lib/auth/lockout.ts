import { prisma } from '@/lib/db';

/** "5 failed attempts locks the account for 15 minutes and notifies the user." */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export type LockState = { locked: true; until: Date } | { locked: false };

export function lockState(user: { lockedUntil: Date | null }, now = new Date()): LockState {
  if (user.lockedUntil && user.lockedUntil > now) {
    return { locked: true, until: user.lockedUntil };
  }
  return { locked: false };
}

export async function recordFailedAttempt(userId: string, now = new Date()): Promise<LockState> {
  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { failedLoginCount: true, lockedUntil: true },
  });
  if (!user) return { locked: false };

  // A lock that has expired resets the counter rather than compounding.
  const base = user.lockedUntil && user.lockedUntil <= now ? 0 : user.failedLoginCount;
  const failedLoginCount = base + 1;

  if (failedLoginCount >= MAX_FAILED_ATTEMPTS) {
    const until = new Date(now.getTime() + LOCKOUT_MINUTES * 60_000);
    await prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount, lockedUntil: until },
    });
    return { locked: true, until };
  }

  await prisma.user.update({ where: { id: userId }, data: { failedLoginCount } });
  return { locked: false };
}

export async function recordSuccessfulLogin(userId: string, now = new Date()): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
  });
}
