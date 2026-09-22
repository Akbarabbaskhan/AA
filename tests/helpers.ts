import { PrismaClient } from '@prisma/client';
import { tenancyExtension } from '@/lib/db/tenancy';
import { withTenant, withoutTenantScope } from '@/lib/db/tenant-context';
import { resolveActor } from '@/lib/permissions/resolve';
import type { Actor } from '@/lib/permissions';

/**
 * Test fixtures resolve against the real seeded tenant rather than building their own, so
 * the tests exercise the same volume and shape the demo does.
 */
export const testPrisma = new PrismaClient().$extends(tenancyExtension);

export const TENANT_SLUG = process.env['DEFAULT_TENANT_SLUG'] ?? 'volt-demo';

export async function getSchoolId(): Promise<string> {
  const school = await withoutTenantScope(() =>
    testPrisma.school.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } }),
  );
  if (!school) throw new Error(`Demo tenant "${TENANT_SLUG}" is not seeded. Run: npm run db:seed`);
  return school.id;
}

/** Builds a real Actor for a seeded account, with its true roles and row scope. */
export async function actorByEmail(schoolId: string, email: string): Promise<Actor> {
  return withTenant({ schoolId }, async () => {
    const user = await testPrisma.user.findFirstOrThrow({
      where: { email },
      select: { id: true },
    });
    const actor = await resolveActor(user.id);
    if (!actor) throw new Error(`Could not resolve an actor for ${email}`);
    return actor;
  });
}

export async function actorForStudentRoll(schoolId: string, rollNumber: string): Promise<Actor> {
  return withTenant({ schoolId }, async () => {
    const student = await testPrisma.student.findFirstOrThrow({
      where: { rollNumber },
      select: { userId: true },
    });
    const actor = await resolveActor(student.userId);
    if (!actor) throw new Error(`Could not resolve an actor for ${rollNumber}`);
    return actor;
  });
}

/** Runs a service call the way a route handler would: inside the actor's tenant scope. */
export async function asActor<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, fn);
}
