import { describe, expect, it } from 'vitest';
import type { RoleName } from '@prisma/client';
import {
  MAX_BOTTOM_TABS,
  NAV_BY_ROLE,
  bottomTabs,
  navFor,
  primaryRole,
} from '@/components/layouts/nav-config';
import enMessages from '@/messages/en.json';

const roles = Object.keys(NAV_BY_ROLE) as RoleName[];

describe('navigation', () => {
  it('never shows more than five tabs on mobile', () => {
    for (const role of roles) {
      expect(bottomTabs([role]).length).toBeLessThanOrEqual(MAX_BOTTOM_TABS);
    }
  });

  it('gives every nav item a translated label', () => {
    const labels = enMessages.nav as Record<string, string>;
    for (const role of roles) {
      for (const item of NAV_BY_ROLE[role]) {
        expect(labels[item.key], `nav.${item.key} is missing from messages`).toBeTruthy();
      }
    }
  });

  it('keeps the bursar away from academic destinations', () => {
    // Finance only — no marks, no results, no remarks, even as a link.
    const hrefs = NAV_BY_ROLE.BURSAR.map((item) => item.href);
    for (const forbidden of ['/marks', '/results', '/remarks', '/exams']) {
      expect(hrefs).not.toContain(forbidden);
    }
  });

  it('puts what a student wants at 7am first', () => {
    const tabs = bottomTabs(['STUDENT']).map((item) => item.key);
    expect(tabs[0]).toBe('dashboard');
    expect(tabs).toContain('papers');
  });

  it('picks the most privileged role when an account holds several', () => {
    expect(primaryRole(['STUDENT', 'TEACHER'])).toBe('TEACHER');
    expect(primaryRole(['TEACHER', 'HOD'])).toBe('HOD');
    expect(primaryRole(['PARENT', 'ADMIN'])).toBe('ADMIN');
  });

  it('follows the role switcher when the user picks a role they hold', () => {
    const asParent = navFor(['TEACHER', 'PARENT'], 'PARENT');
    expect(asParent).toBe(NAV_BY_ROLE.PARENT);

    // Asking for a role the account does not hold falls back rather than granting it.
    const spoofed = navFor(['STUDENT'], 'ADMIN');
    expect(spoofed).toBe(NAV_BY_ROLE.STUDENT);
  });
});
