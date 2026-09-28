import { z } from 'zod';
import { hashPassword } from '@/lib/auth/password';
import { prisma, withTenant, withoutTenantScope } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { MODULES, parseFeatureFlags, type ModuleName } from '@/lib/services/school-settings';
import { DEFAULT_THEME_ID } from '@/lib/theme/load';

/**
 * Volt staff tooling: the tenants, their flags, and whether the system is healthy.
 *
 * Everything here runs outside the tenant scope on purpose — it is the one part of the product
 * that is allowed to see across schools, and it is deliberately narrow: provisioning, flags,
 * usage, health. No marks, no fees, no names of children. A Volt engineer with support access
 * should not be able to read a school's records without impersonating somebody, which leaves a
 * trail.
 */

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  /** The renewal conversation: is anybody actually using it? */
  usage: {
    users: number;
    activeUsersLast30Days: number;
    students: number;
    staff: number;
    attendanceMarkedLast30Days: number;
    papersAttemptedLast30Days: number;
    invoicesRaised: number;
  };
  disabledModules: ModuleName[];
};

export async function listTenants(actor: Actor): Promise<TenantRow[]> {
  requireCapability(actor, 'tenant.provision');
  const since = new Date(Date.now() - 30 * 86_400_000);

  return withoutTenantScope(async () => {
    const schools = await prisma.school.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        createdAt: true,
        featureFlags: true,
        _count: { select: { users: true, students: true, staff: true, invoices: true } },
      },
    });

    /*
     * Counted per tenant in three grouped queries rather than per school in a loop: this is the
     * screen Volt staff open to see every school at once, and an N+1 here is an N+1 that grows
     * with the customer list.
     */
    const [sessions, attempts, logins] = await Promise.all([
      prisma.attendanceSession.groupBy({
        by: ['schoolId'],
        where: { markedAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.paperAttempt.groupBy({
        by: ['schoolId'],
        where: { startedAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.user.groupBy({
        by: ['schoolId'],
        where: { lastLoginAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const markedBy = new Map(sessions.map((row) => [row.schoolId, row._count._all]));
    const attemptsBy = new Map(attempts.map((row) => [row.schoolId, row._count._all]));
    const activeBy = new Map(logins.map((row) => [row.schoolId, row._count._all]));

    return schools.map((school) => {
      const flags = parseFeatureFlags(school.featureFlags);
      return {
        id: school.id,
        name: school.name,
        slug: school.slug,
        isActive: school.isActive,
        createdAt: school.createdAt.toISOString(),
        usage: {
          users: school._count.users,
          activeUsersLast30Days: activeBy.get(school.id) ?? 0,
          students: school._count.students,
          staff: school._count.staff,
          attendanceMarkedLast30Days: markedBy.get(school.id) ?? 0,
          papersAttemptedLast30Days: attemptsBy.get(school.id) ?? 0,
          invoicesRaised: school._count.invoices,
        },
        disabledModules: MODULES.filter((module) => !flags[module]),
      };
    });
  });
}

export const provisionSchema = z.object({
  name: z.string().min(3).max(120),
  /** The subdomain-safe handle a school signs in with. */
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Lower case letters, numbers and hyphens only'),
  themeId: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(60)
    .default(DEFAULT_THEME_ID),
  timezone: z.string().max(60).default('Asia/Karachi'),
  locale: z.enum(['en', 'ur']).default('en'),
  /** The first account: a coordinator who can then invite everybody else. */
  adminName: z.string().min(3).max(120),
  adminEmail: z.string().email().max(200),
  adminPhone: z.string().max(40).optional(),
  adminPassword: z.string().min(12).max(200),
  /** The academic year the school is starting in. */
  yearLabel: z.string().min(4).max(40),
  yearStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  yearEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type ProvisionResult = {
  schoolId: string;
  slug: string;
  adminUserId: string;
  /** What the new tenant starts with, so the caller can tell the school what to expect. */
  defaults: { periods: number; gradingScales: number; feeHeads: number };
};

/**
 * Create a school.
 *
 * "Tenant provisioning: create a school, apply a theme, seed defaults." The defaults are the
 * things no school can start without and every school then edits: a bell schedule, a grading
 * scale, and the fee heads a Pakistani A Level campus actually charges. Nothing else — a new
 * tenant with invented departments and subjects is a tenant whose first hour is spent deleting
 * things.
 */
export async function provisionTenant(actor: Actor, raw: unknown): Promise<ProvisionResult> {
  requireCapability(actor, 'tenant.provision');
  const input = provisionSchema.parse(raw);

  if (input.yearEnd <= input.yearStart) {
    throw ApiError.badRequest('invalidDates', 'The academic year has to end after it starts.');
  }

  const existing = await withoutTenantScope(() =>
    prisma.school.findFirst({ where: { slug: input.slug }, select: { id: true } }),
  );
  if (existing)
    throw ApiError.conflict('slugTaken', `The handle "${input.slug}" is already in use.`);

  const duplicateEmail = await withoutTenantScope(() =>
    prisma.user.findFirst({ where: { email: input.adminEmail }, select: { id: true } }),
  );
  if (duplicateEmail) {
    throw ApiError.conflict('emailTaken', 'That email address already has a Volt account.');
  }

  const passwordHash = await hashPassword(input.adminPassword);

  const result = await withoutTenantScope(() =>
    prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: input.name,
          slug: input.slug,
          timezone: input.timezone,
          locale: input.locale,
          themeJson: { themeId: input.themeId },
          settingsJson: { branding: { themeId: input.themeId, displayName: input.name } },
          featureFlags: {},
        },
        select: { id: true },
      });

      const year = await tx.academicYear.create({
        data: {
          schoolId: school.id,
          label: input.yearLabel,
          startDate: new Date(`${input.yearStart}T00:00:00.000Z`),
          endDate: new Date(`${input.yearEnd}T00:00:00.000Z`),
          isCurrent: true,
        },
        select: { id: true },
      });

      // A bell schedule: eight periods, the shape the spec describes, editable on day one.
      const periods = [
        ['1', '08:00', '08:45'],
        ['2', '08:45', '09:30'],
        ['3', '09:50', '10:35'],
        ['4', '10:35', '11:20'],
        ['5', '11:40', '12:25'],
        ['6', '12:25', '13:10'],
        ['7', '13:30', '14:15'],
        ['8', '14:15', '15:00'],
      ] as const;

      await tx.period.createMany({
        data: periods.map(([label, startTime, endTime], index) => ({
          schoolId: school.id,
          index: index + 1,
          label: `Period ${label}`,
          startTime,
          endTime,
        })),
      });

      // The CAIE A Level scale, which is the one every one of these schools uses.
      await tx.gradingScale.createMany({
        data: [
          {
            schoolId: school.id,
            name: 'CAIE A Level',
            board: 'CAIE',
            isDefault: true,
            bandsJson: [
              { grade: 'A*', minPercent: 90 },
              { grade: 'A', minPercent: 80 },
              { grade: 'B', minPercent: 70 },
              { grade: 'C', minPercent: 60 },
              { grade: 'D', minPercent: 50 },
              { grade: 'E', minPercent: 40 },
              { grade: 'U', minPercent: 0 },
            ],
          },
        ],
      });

      /*
       * The heads a Pakistani A Level campus charges, at zero: the amounts are the school's to
       * set, and a provisioned tenant that arrived with invented fees would have somebody
       * correcting numbers before they had entered a single student.
       */
      const feeHeads: { name: string; isRecurring: boolean }[] = [
        { name: 'Tuition', isRecurring: true },
        { name: 'Admission', isRecurring: false },
        { name: 'Examination', isRecurring: false },
        { name: 'Transport', isRecurring: true },
        { name: 'Laboratory', isRecurring: false },
      ];
      await tx.feeHead.createMany({
        data: feeHeads.map((head) => ({
          schoolId: school.id,
          name: head.name,
          isRecurring: head.isRecurring,
          defaultAmount: 0,
        })),
      });

      const user = await tx.user.create({
        data: {
          schoolId: school.id,
          name: input.adminName,
          email: input.adminEmail,
          phone: input.adminPhone ?? null,
          passwordHash,
          isActive: true,
          locale: input.locale,
        },
        select: { id: true },
      });

      await tx.userRole.create({ data: { schoolId: school.id, userId: user.id, role: 'ADMIN' } });

      return {
        schoolId: school.id,
        academicYearId: year.id,
        adminUserId: user.id,
        defaults: { periods: periods.length, gradingScales: 1, feeHeads: feeHeads.length },
      };
    }),
  );

  /*
   * Audited inside the new tenant, because that is where a school's own coordinator will look
   * for "who created this and when" — and audited again under Volt's own tenant would be a row
   * nobody at the school can read.
   */
  await withTenant({ schoolId: result.schoolId, userId: actor.userId }, () =>
    writeAudit(
      { ...actor, schoolId: result.schoolId },
      {
        action: 'tenant.provision',
        entityType: 'School',
        entityId: result.schoolId,
        after: {
          name: input.name,
          slug: input.slug,
          themeId: input.themeId,
          admin: input.adminEmail,
        },
      },
    ),
  );

  return {
    schoolId: result.schoolId,
    slug: input.slug,
    adminUserId: result.adminUserId,
    defaults: result.defaults,
  };
}

export const tenantFlagSchema = z.object({
  schoolId: z.string().uuid(),
  module: z.enum(MODULES),
  enabled: z.boolean(),
});

/** Volt staff turning a module off for one tenant, from the tenants console. */
export async function setTenantFlag(
  actor: Actor,
  raw: unknown,
): Promise<TenantRow['disabledModules']> {
  requireCapability(actor, 'tenant.provision');
  const input = tenantFlagSchema.parse(raw);

  const school = await withoutTenantScope(() =>
    prisma.school.findFirst({
      where: { id: input.schoolId },
      select: { id: true, featureFlags: true },
    }),
  );
  if (!school) throw ApiError.notFound('School not found');

  const before = parseFeatureFlags(school.featureFlags);
  const after = { ...before, [input.module]: input.enabled };

  await withoutTenantScope(() =>
    prisma.school.update({ where: { id: school.id }, data: { featureFlags: after } }),
  );

  await withTenant({ schoolId: school.id, userId: actor.userId }, () =>
    writeAudit(
      { ...actor, schoolId: school.id },
      {
        action: input.enabled ? 'school.module.enable' : 'school.module.disable',
        entityType: 'School',
        entityId: school.id,
        before: { [input.module]: before[input.module] },
        after: { [input.module]: input.enabled },
        reason: 'Changed by Volt staff',
      },
    ),
  );

  return MODULES.filter((module) => !parseFeatureFlags(after)[module]);
}

export type SystemHealth = {
  /** Notifications waiting to go out. A number that only grows means the worker is dead. */
  queueDepth: number;
  oldestQueuedMinutes: number | null;
  failedLast24Hours: number;
  suppressedLast24Hours: number;
  /** Bytes in object storage, per tenant, as recorded on the rows that reference them. */
  storage: { files: number };
  /** Rows the audit log gained in the last day: a rough proxy for "is anything happening". */
  auditRowsLast24Hours: number;
  tenants: { total: number; active: number };
  database: { sizeBytes: number };
};

export async function getSystemHealth(actor: Actor): Promise<SystemHealth> {
  requireCapability(actor, 'tenant.provision');
  const since = new Date(Date.now() - 86_400_000);

  return withoutTenantScope(async () => {
    const [queued, oldest, failed, suppressed, audits, tenants, active, files, size] =
      await Promise.all([
        prisma.notification.count({ where: { deliveryStatus: 'QUEUED' } }),
        prisma.notification.findFirst({
          where: { deliveryStatus: 'QUEUED' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        prisma.notification.count({
          where: { deliveryStatus: 'FAILED', createdAt: { gte: since } },
        }),
        prisma.notification.count({
          where: { deliveryStatus: 'SUPPRESSED', createdAt: { gte: since } },
        }),
        prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
        prisma.school.count(),
        prisma.school.count({ where: { isActive: true } }),
        prisma.resource.count(),
        prisma.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`,
      ]);

    return {
      queueDepth: queued,
      oldestQueuedMinutes: oldest
        ? Math.round((Date.now() - oldest.createdAt.getTime()) / 60_000)
        : null,
      failedLast24Hours: failed,
      suppressedLast24Hours: suppressed,
      storage: { files },
      auditRowsLast24Hours: audits,
      tenants: { total: tenants, active },
      database: { sizeBytes: Number(size[0]?.size ?? 0) },
    };
  });
}
