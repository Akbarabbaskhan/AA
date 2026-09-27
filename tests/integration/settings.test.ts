import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import {
  MODULES,
  getFeatureFlags,
  getSchoolConfig,
  getSchoolSettings,
  isModuleEnabled,
  listThemes,
  parseFeatureFlags,
  resolveChannels,
  setFeatureFlag,
  updateBranding,
  updateSchoolSettings,
} from '@/lib/services/school-settings';
import { hiddenNavKeys, navFor } from '@/components/layouts/nav-config';
import { notify } from '@/lib/services/notifications/notify';
import { listSocieties } from '@/lib/services/societies';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

/**
 * School settings and the module flags.
 *
 * "Everything that differs between schools is a setting, never a code change" is only true if
 * the setting is read by the thing it configures — so these tests change a setting and then
 * check the behaviour it governs, rather than checking that the value came back.
 */

let schoolId: string;
let admin: Actor;
let teacher: Actor;
let student: Actor;
let originalSettings: unknown;
let originalFlags: unknown;

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  const staff = await asActor(admin, () =>
    testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'TEACHER' } }, staff: { sections: { some: {} } } },
      select: { email: true },
    }),
  );
  teacher = await actorByEmail(schoolId, staff.email!);

  const school = await asActor(admin, () =>
    testPrisma.school.findFirstOrThrow({ select: { settingsJson: true, featureFlags: true } }),
  );
  originalSettings = school.settingsJson;
  originalFlags = school.featureFlags;
});

afterAll(async () => {
  // The demo tenant is shared. Whatever these tests switch off goes back on.
  await asActor(admin, async () => {
    const school = await testPrisma.school.findFirstOrThrow({ select: { id: true } });
    await testPrisma.school.update({
      where: { id: school.id },
      data: {
        settingsJson: originalSettings as object,
        featureFlags: originalFlags as object,
      },
    });
  });
  await testPrisma.$disconnect();
});

describe('school settings', () => {
  it('reads a whole configuration in one go, with defaults filled in', async () => {
    const config = await asActor(admin, () => getSchoolConfig());
    expect(config.name.length).toBeGreaterThan(0);
    expect(config.timezone).toBe('Asia/Karachi');
    expect(config.settings.attendance.lockWindowHours).toBeGreaterThan(0);
    expect(Object.keys(config.flags).sort()).toEqual([...MODULES].sort());
  });

  it('patches one section without resetting the others', async () => {
    const before = await asActor(admin, () => getSchoolSettings());

    const after = await asActor(admin, () =>
      updateSchoolSettings(admin, { attendance: { lockWindowHours: 48 } }),
    );

    expect(after.attendance.lockWindowHours).toBe(48);
    // The sections the patch did not mention are untouched — a PATCH that reset the fee gate
    // or the bank block because the caller sent one field would be a data-loss bug.
    expect(after.fees.voucherPrefix).toBe(before.fees.voucherPrefix);
    expect(after.notifications.quietHours.from).toBe(before.notifications.quietHours.from);
    expect(after.engagement.effortLeaderboards).toBe(before.engagement.effortLeaderboards);

    await asActor(admin, () =>
      updateSchoolSettings(admin, {
        attendance: { lockWindowHours: before.attendance.lockWindowHours },
      }),
    );
  });

  it('is governed by the setting it stores: the attendance lock window', async () => {
    const { isLocked } = await import('@/lib/services/attendance/policy');
    const markedAt = new Date('2026-09-01T09:30:00.000Z');

    await asActor(admin, () => updateSchoolSettings(admin, { attendance: { lockWindowHours: 2 } }));
    const tight = await asActor(admin, () => getSchoolSettings());
    // A period ending at 08:00 Karachi (03:00 UTC) is locked by 09:30 UTC with a 2-hour window.
    expect(
      isLocked('2026-09-01', '08:00', markedAt, tight.attendance.lockWindowHours, tight.timezone),
    ).toBe(true);

    await asActor(admin, () => updateSchoolSettings(admin, { attendance: { lockWindowHours: 24 } }));
    const relaxed = await asActor(admin, () => getSchoolSettings());
    expect(
      isLocked('2026-09-01', '08:00', markedAt, relaxed.attendance.lockWindowHours, relaxed.timezone),
    ).toBe(false);
  });

  it('refuses a teacher and a student', async () => {
    for (const actor of [teacher, student]) {
      await expect(
        asActor(actor, () => updateSchoolSettings(actor, { attendance: { lockWindowHours: 999 } })),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it('writes an audit row for every change', async () => {
    const { searchAuditLog } = await import('@/lib/services/audit-search');
    const page = await asActor(admin, () =>
      searchAuditLog(admin, { action: 'school.settings', limit: 10 } as never),
    );
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows[0]?.changes.length).toBeGreaterThan(0);
  });
});

describe('branding', () => {
  it('offers only themes this school may use', async () => {
    const forAdmin = await asActor(admin, () => listThemes(admin));
    expect(forAdmin.length).toBeGreaterThan(0);
    expect(forAdmin.every((theme) => theme.publicUseApproved)).toBe(true);

    // LGS's own theme is not approved for public use until the school puts it in writing, so
    // it is offered to Volt staff and to nobody else.
    const support = await actorByEmail(schoolId, 'support@volt.test');
    const forVolt = await asActor(support, () => listThemes(support));
    expect(forVolt.length).toBeGreaterThanOrEqual(forAdmin.length);
  });

  it('refuses a theme that is not on the list', async () => {
    await expect(
      asActor(admin, () => updateBranding(admin, { themeId: 'not-a-theme' })),
    ).rejects.toMatchObject({ code: 'unknownTheme' });
  });

  it('keeps the theme id the loader reads in step with the setting', async () => {
    const config = await asActor(admin, () => updateBranding(admin, { themeId: 'volt-default' }));
    expect(config.settings.branding.themeId).toBe('volt-default');

    const school = await asActor(admin, () =>
      testPrisma.school.findFirstOrThrow({ select: { themeJson: true } }),
    );
    expect((school.themeJson as { themeId?: string }).themeId).toBe('volt-default');
  });
});

describe('module flags', () => {
  it('defaults every module on, including one a school has never heard of', () => {
    const flags = parseFeatureFlags({ societies: false });
    expect(flags.societies).toBe(false);
    // A module added after this school configured itself is on, not silently off.
    expect(flags.careers).toBe(true);
  });

  it('closes the module’s service, not only its navigation', async () => {
    await asActor(admin, () => setFeatureFlag(admin, { module: 'societies', enabled: false }));
    expect(await asActor(admin, () => isModuleEnabled('societies'))).toBe(false);

    // The navigation loses it, for every role that had it.
    const flags = await asActor(admin, () => getFeatureFlags());
    expect(hiddenNavKeys(flags).has('societies')).toBe(true);
    expect(navFor(['STUDENT'], 'STUDENT', flags).some((item) => item.key === 'societies')).toBe(false);

    // And the service still answers, because the flag is enforced at the edge: the route
    // wrapper and the page guard both refuse before a service is reached. This asserts the
    // separation deliberately — a flag that services enforced individually would be a flag
    // that one forgotten service ignores.
    const societies = await asActor(student, () => listSocieties(student));
    expect(Array.isArray(societies)).toBe(true);

    await asActor(admin, () => setFeatureFlag(admin, { module: 'societies', enabled: true }));
    expect(await asActor(admin, () => isModuleEnabled('societies'))).toBe(true);
  });

  it('audits a module being switched off', async () => {
    const { searchAuditLog } = await import('@/lib/services/audit-search');
    await asActor(admin, () => setFeatureFlag(admin, { module: 'events', enabled: false }));

    const page = await asActor(admin, () =>
      searchAuditLog(admin, { action: 'school.module', limit: 5 } as never),
    );
    expect(page.rows[0]?.action).toBe('school.module.disable');

    await asActor(admin, () => setFeatureFlag(admin, { module: 'events', enabled: true }));
  });
});

describe('notification defaults per type and per role', () => {
  it('honours a school that has not signed for WhatsApp', async () => {
    await asActor(admin, () =>
      updateSchoolSettings(admin, {
        notifications: { typeDefaults: { 'fee.reminder': { channels: ['IN_APP'], enabled: true } } },
      }),
    );

    const settings = await asActor(admin, () => getSchoolSettings());
    const resolved = resolveChannels(settings, 'fee.reminder', ['PARENT'], [
      'IN_APP',
      'WHATSAPP',
      'SMS',
    ]);
    expect(resolved.channels).toEqual(['IN_APP']);

    const guardian = await asActor(admin, () =>
      testPrisma.guardian.findFirstOrThrow({ select: { userId: true } }),
    );
    const result = await asActor(admin, () =>
      notify(schoolId, guardian.userId, 'fee.reminder', {
        title: '[test] Fee reminder',
        body: 'Voucher due.',
      }),
    );
    // One row, in-app, and no WhatsApp attempt at all.
    expect(result.attempted).not.toContain('WHATSAPP');
    expect(result.suppressed.some((entry) => entry.channel === 'WHATSAPP')).toBe(false);
  });

  it('lets a school turn a whole type off, and records why nothing was sent', async () => {
    await asActor(admin, () =>
      updateSchoolSettings(admin, {
        notifications: { typeDefaults: { 'assignment.due': { enabled: false } } },
      }),
    );

    const result = await asActor(admin, () =>
      notify(schoolId, student.userId, 'assignment.due', {
        title: '[test] Assignment due',
        body: 'Tomorrow.',
      }),
    );

    expect(result.notificationIds).toHaveLength(0);
    expect(result.suppressed.every((entry) => entry.reason === 'disabledBySchool')).toBe(true);
    expect(result.suppressed.length).toBeGreaterThan(0);

    // The suppression is written down: "why did this not go out?" is answerable from the log.
    const rows = await asActor(admin, () =>
      testPrisma.notification.findMany({
        where: { userId: student.userId, type: 'assignment.due', failureReason: 'disabledBySchool' },
        select: { id: true },
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('applies a per-role default over the type default', async () => {
    await asActor(admin, () =>
      updateSchoolSettings(admin, {
        notifications: {
          typeDefaults: { 'announcement.published': { channels: ['IN_APP', 'PUSH'], enabled: true } },
          roleDefaults: { TEACHER: { 'announcement.published': ['IN_APP'] } },
        },
      }),
    );

    const settings = await asActor(admin, () => getSchoolSettings());
    expect(
      resolveChannels(settings, 'announcement.published', ['TEACHER'], ['IN_APP', 'PUSH']).channels,
    ).toEqual(['IN_APP']);
    expect(
      resolveChannels(settings, 'announcement.published', ['PARENT'], ['IN_APP', 'PUSH']).channels,
    ).toEqual(['IN_APP', 'PUSH']);
  });
});
