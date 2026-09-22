import { describe, expect, it } from 'vitest';
import { looksLikeEmail, maskPhone, normalisePhone } from '@/lib/utils/phone';
import { passwordProblems } from '@/lib/auth/password';
import {
  SESSION_EXPIRY_CLAIM,
  SESSION_SECONDS,
  isSessionExpired,
  sessionDeadline,
  sessionMaxAge,
  twoFactorEligible,
} from '@/lib/auth/session-policy';
import { MAX_FAILED_ATTEMPTS, lockState } from '@/lib/auth/lockout';

describe('phone normalisation', () => {
  it('accepts the formats a Pakistani parent actually types', () => {
    const expected = '+923001234567';
    for (const input of [
      '03001234567',
      '0300 1234567',
      '0300-123-4567',
      '+92 300 1234567',
      '+923001234567',
      '923001234567',
      '00923001234567',
      '3001234567',
    ]) {
      expect(normalisePhone(input), `failed on ${input}`).toBe(expected);
    }
  });

  it('rejects input that is not a usable number', () => {
    for (const input of ['', 'abc', '123', '0300123']) {
      expect(normalisePhone(input)).toBeNull();
    }
  });

  it('tells an email apart from a phone number', () => {
    expect(looksLikeEmail('bursar@lgs.edu.pk')).toBe(true);
    expect(looksLikeEmail('03001234567')).toBe(false);
  });

  it('masks a number for logs', () => {
    expect(maskPhone('+923001234567')).toBe('+92****567');
  });
});

describe('password policy', () => {
  it('flags the three things that matter and nothing else', () => {
    expect(passwordProblems('Chem9701')).toEqual([]);
    expect(passwordProblems('short1')).toEqual(['tooShort']);
    expect(passwordProblems('12345678')).toEqual(['needsLetter']);
    expect(passwordProblems('abcdefgh')).toEqual(['needsDigit']);
  });
});

describe('session policy', () => {
  it('gives mobile roles 30 days', () => {
    expect(sessionMaxAge(['STUDENT'])).toBe(SESSION_SECONDS.standard);
    expect(sessionMaxAge(['TEACHER', 'HOD'])).toBe(SESSION_SECONDS.standard);
  });

  it('gives admin and bursar 12 hours', () => {
    expect(sessionMaxAge(['ADMIN'])).toBe(SESSION_SECONDS.privileged);
    expect(sessionMaxAge(['BURSAR'])).toBe(SESSION_SECONDS.privileged);
  });

  it('applies the shorter window when one account holds both', () => {
    // A teacher who is also the bursar gets 12 hours, not 30 days.
    expect(sessionMaxAge(['TEACHER', 'BURSAR'])).toBe(SESSION_SECONDS.privileged);
  });

  it('offers 2FA to the privileged roles', () => {
    expect(twoFactorEligible(['ADMIN'])).toBe(true);
    expect(twoFactorEligible(['STUDENT'])).toBe(false);
  });
});

describe('account lockout', () => {
  const now = new Date('2026-10-14T08:00:00Z');

  it('locks while the window is open', () => {
    const until = new Date(now.getTime() + 5 * 60_000);
    expect(lockState({ lockedUntil: until }, now)).toEqual({ locked: true, until });
  });

  it('releases once the window has passed', () => {
    const until = new Date(now.getTime() - 60_000);
    expect(lockState({ lockedUntil: until }, now)).toEqual({ locked: false });
  });

  it('locks after five attempts, per the spec', () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
  });
});

describe('per-role session deadline', () => {
  const now = Date.UTC(2026, 9, 14, 8, 0, 0);

  it('gives an admin twelve hours and a student thirty days', () => {
    expect(sessionDeadline(['ADMIN'], now) - now).toBe(12 * 60 * 60 * 1000);
    expect(sessionDeadline(['STUDENT'], now) - now).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('expires a token once its deadline passes', () => {
    const token = { [SESSION_EXPIRY_CLAIM]: sessionDeadline(['ADMIN'], now) };
    expect(isSessionExpired(token, now + 11 * 60 * 60 * 1000)).toBe(false);
    expect(isSessionExpired(token, now + 13 * 60 * 60 * 1000)).toBe(true);
  });

  it('treats a token with no deadline as expired rather than unbounded', () => {
    // NextAuth's own maxAge would happily keep an admin signed in for 30 days; a token
    // issued before this check existed must not inherit that.
    expect(isSessionExpired({}, now)).toBe(true);
    expect(isSessionExpired(null, now)).toBe(true);
    expect(isSessionExpired({ [SESSION_EXPIRY_CLAIM]: 'soon' }, now)).toBe(true);
  });
});
