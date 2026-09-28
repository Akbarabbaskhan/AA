import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import {
  getSystemHealth,
  listTenants,
  provisionTenant,
  setTenantFlag,
} from '@/lib/services/tenants';
import { searchAuditLog } from '@/lib/services/audit-search';
import { signImpersonation, verifyImpersonation } from '@/lib/auth/impersonation';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';
import { withoutTenantScope } from '@/lib/db';

/**
 * Volt staff tooling: provisioning, per-tenant flags, usage, health, and impersonation.
 */

let schoolId: string;
let support: Actor;
let admin: Actor;
let student: Actor;
const SLUG = 'test-tenant-provision';

beforeAll(async () => {
  schoolId = await getSchoolId();
  support = await actorByEmail(schoolId, 'support@volt.test');
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');
});

afterAll(async () => {
  await withoutTenantScope(async () => {
    const created = await testPrisma.school.findFirst({
      where: { slug: SLUG },
      select: { id: true },
    });
    if (created) await testPrisma.school.delete({ where: { id: created.id } });
  });
  await testPrisma.$disconnect();
});

describe('the tenant list', () => {
  it('shows Volt staff every school with the usage that matters at renewal', async () => {
    const tenants = await asActor(support, () => listTenants(support));
    expect(tenants.length).toBeGreaterThan(0);

    const demo = tenants.find((tenant) => tenant.slug === 'volt-demo');
    expect(demo).toBeTruthy();
    expect(demo!.usage.students).toBeGreaterThan(1_000);
    expect(demo!.usage.staff).toBeGreaterThan(100);
    // The two numbers that prove the product is used rather than installed.
    expect(demo!.usage.attendanceMarkedLast30Days).toBeGreaterThan(100);
    expect(demo!.usage.invoicesRaised).toBeGreaterThan(1_000);
  });

  it('is refused to a school’s own coordinator and to a student', async () => {
    for (const actor of [admin, student]) {
      await expect(asActor(actor, () => listTenants(actor))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(asActor(actor, () => getSystemHealth(actor))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});

describe('provisioning', () => {
  it('creates a school that can be signed into, with the defaults a school cannot start without', async () => {
    const result = await asActor(support, () =>
      provisionTenant(support, {
        name: 'Test Provisioned School',
        slug: SLUG,
        themeId: 'volt-default',
        adminName: 'Test Coordinator',
        adminEmail: 'coordinator@test-provision.test',
        adminPassword: 'ProvisionedTest2026!',
        yearLabel: '2099–00',
        yearStart: '2099-04-01',
        yearEnd: '2100-03-31',
      }),
    );

    expect(result.slug).toBe(SLUG);
    expect(result.defaults).toEqual({ periods: 8, gradingScales: 1, feeHeads: 5 });

    const created = await withoutTenantScope(() =>
      testPrisma.school.findFirstOrThrow({
        where: { slug: SLUG },
        select: {
          id: true,
          themeJson: true,
          _count: { select: { users: true, periods: true, academicYears: true } },
          academicYears: { select: { isCurrent: true, label: true } },
          gradingScales: { select: { isDefault: true, name: true } },
        },
      }),
    );

    expect(created._count.users).toBe(1);
    expect(created._count.periods).toBe(8);
    expect(created.academicYears).toEqual([{ isCurrent: true, label: '2099–00' }]);
    expect(created.gradingScales[0]?.isDefault).toBe(true);
    expect((created.themeJson as { themeId?: string }).themeId).toBe('volt-default');

    // The coordinator is an ADMIN in their own school and nothing anywhere else.
    const roles = await withoutTenantScope(() =>
      testPrisma.userRole.findMany({
        where: { user: { email: 'coordinator@test-provision.test' } },
        select: { role: true, schoolId: true },
      }),
    );
    expect(roles).toHaveLength(1);
    expect(roles[0]?.role).toBe('ADMIN');
    expect(roles[0]?.schoolId).toBe(created.id);

    // And the school's own audit log records where it came from.
    const adminActor = { ...support, schoolId: created.id };
    const audit = await asActor(adminActor, () =>
      searchAuditLog(adminActor, { action: 'tenant.provision', limit: 5 } as never),
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('refuses a handle or an email that is already taken', async () => {
    await expect(
      asActor(support, () =>
        provisionTenant(support, {
          name: 'Another School',
          slug: SLUG,
          adminName: 'Someone',
          adminEmail: 'another@test-provision.test',
          adminPassword: 'ProvisionedTest2026!',
          yearLabel: '2099–00',
          yearStart: '2099-04-01',
          yearEnd: '2100-03-31',
        }),
      ),
    ).rejects.toMatchObject({ code: 'slugTaken' });

    await expect(
      asActor(support, () =>
        provisionTenant(support, {
          name: 'Another School',
          slug: 'another-test-slug',
          adminName: 'Someone',
          adminEmail: 'coordinator@test-provision.test',
          adminPassword: 'ProvisionedTest2026!',
          yearLabel: '2099–00',
          yearStart: '2099-04-01',
          yearEnd: '2100-03-31',
        }),
      ),
    ).rejects.toMatchObject({ code: 'emailTaken' });
  });

  it('is refused to a school’s own coordinator', async () => {
    await expect(
      asActor(admin, () =>
        provisionTenant(admin, {
          name: 'Not Allowed',
          slug: 'not-allowed-school',
          adminName: 'Someone',
          adminEmail: 'someone@not-allowed.test',
          adminPassword: 'ProvisionedTest2026!',
          yearLabel: '2099–00',
          yearStart: '2099-04-01',
          yearEnd: '2100-03-31',
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('per-tenant flags', () => {
  it('turns a module off for one school and records it in that school’s log', async () => {
    const created = await withoutTenantScope(() =>
      testPrisma.school.findFirstOrThrow({ where: { slug: SLUG }, select: { id: true } }),
    );

    const off = await asActor(support, () =>
      setTenantFlag(support, { schoolId: created.id, module: 'societies', enabled: false }),
    );
    expect(off).toContain('societies');

    const actorInTenant = { ...support, schoolId: created.id };
    const audit = await asActor(actorInTenant, () =>
      searchAuditLog(actorInTenant, { action: 'school.module', limit: 5 } as never),
    );
    expect(audit.rows[0]?.action).toBe('school.module.disable');
    expect(audit.rows[0]?.reason).toBe('Changed by Volt staff');

    // The demo tenant is untouched: a per-tenant flag is per tenant.
    const demoFlags = await asActor(admin, async () => {
      const { getFeatureFlags } = await import('@/lib/services/school-settings');
      return getFeatureFlags();
    });
    expect(demoFlags.societies).toBe(true);
  });
});

describe('system health', () => {
  it('reports the queue, the failures and the size', async () => {
    const health = await asActor(support, () => getSystemHealth(support));
    expect(health.tenants.total).toBeGreaterThan(0);
    expect(health.tenants.active).toBeGreaterThan(0);
    expect(health.database.sizeBytes).toBeGreaterThan(1_000_000);
    expect(health.queueDepth).toBeGreaterThanOrEqual(0);
    expect(health.auditRowsLast24Hours).toBeGreaterThan(0);
  });
});

describe('impersonation', () => {
  it('signs a token that only this secret can have produced', () => {
    const token = signImpersonation('11111111-1111-4111-8111-111111111111', Date.now() + 60_000);
    expect(verifyImpersonation(token)?.targetUserId).toBe('11111111-1111-4111-8111-111111111111');

    // Tampered, expired, and malformed all fail closed.
    expect(verifyImpersonation(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(verifyImpersonation(signImpersonation('someone', Date.now() - 1_000))).toBeNull();
    expect(verifyImpersonation('nonsense')).toBeNull();
  });
});
