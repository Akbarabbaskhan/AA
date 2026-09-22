import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import { tenancyExtension } from '@/lib/db/tenancy';
import {
  CrossTenantAccessError,
  TenantContextMissingError,
  withTenant,
  withoutTenantScope,
} from '@/lib/db/tenant-context';

const prisma = new PrismaClient().$extends(tenancyExtension);

const LGS = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';

async function seedTwoTenants() {
  await withoutTenantScope(async () => {
    for (const [id, slug, name] of [
      [LGS, 'tenancy-test-lgs', 'Tenancy Test LGS'],
      [OTHER, 'tenancy-test-other', 'Tenancy Test Other'],
    ] as const) {
      await prisma.school.upsert({
        where: { id },
        update: {},
        create: { id, slug, name },
      });
      await prisma.department.upsert({
        where: { schoolId_name: { schoolId: id, name: 'Sciences' } },
        update: {},
        create: { schoolId: id, name: 'Sciences' },
      });
    }
  });
}

beforeAll(async () => {
  await seedTwoTenants();
});

afterAll(async () => {
  await withoutTenantScope(async () => {
    await prisma.school.deleteMany({ where: { id: { in: [LGS, OTHER] } } });
  });
  await prisma.$disconnect();
});

describe('tenancy: runtime enforcement', () => {
  it('refuses to query a tenant table with no tenant context', async () => {
    await expect(prisma.department.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  it('never returns another school\'s rows from a list query', async () => {
    const rows = await withTenant({ schoolId: LGS }, () => prisma.department.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schoolId).toBe(LGS);
  });

  it('does not leak another school\'s row through a lookup by primary key', async () => {
    const other = await withoutTenantScope(() =>
      prisma.department.findFirstOrThrow({ where: { schoolId: OTHER } }),
    );

    // The id is real and valid — the only thing stopping it is the injected predicate.
    const leaked = await withTenant({ schoolId: LGS }, () =>
      prisma.department.findUnique({ where: { id: other.id } }),
    );
    expect(leaked).toBeNull();
  });

  it('injects the tenant into writes', async () => {
    // Prisma's generated types still require `schoolId` on a create, so the compiler asks
    // for it even though the extension supplies it. The cast here is standing in for a
    // service that forgot — which is the case the runtime guard has to cover.
    const created = await withTenant({ schoolId: LGS }, () =>
      prisma.room.create({
        data: { name: 'Lab 1', capacity: 24, type: 'lab' } as Prisma.RoomCreateInput,
      }),
    );
    expect(created.schoolId).toBe(LGS);

    await withTenant({ schoolId: LGS }, () => prisma.room.delete({ where: { id: created.id } }));
  });

  it('blocks a query that names a school other than the one in context', async () => {
    await expect(
      withTenant({ schoolId: LGS }, () =>
        prisma.department.findMany({ where: { schoolId: OTHER } }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it('blocks a write that names another school', async () => {
    await expect(
      withTenant({ schoolId: LGS }, () =>
        prisma.room.create({
          data: { schoolId: OTHER, name: 'Smuggled', capacity: 1 } as Prisma.RoomUncheckedCreateInput,
        }),
      ),
    ).rejects.toBeInstanceOf(CrossTenantAccessError);
  });

  it('scopes updateMany and deleteMany to the tenant', async () => {
    const updated = await withTenant({ schoolId: LGS }, () =>
      prisma.department.updateMany({ data: { name: 'Sciences (renamed)' } }),
    );
    expect(updated.count).toBe(1);

    const otherName = await withoutTenantScope(() =>
      prisma.department.findFirstOrThrow({ where: { schoolId: OTHER } }),
    );
    expect(otherName.name).toBe('Sciences');

    await withTenant({ schoolId: LGS }, () =>
      prisma.department.updateMany({ data: { name: 'Sciences' } }),
    );
  });

  it('scopes counts and aggregates', async () => {
    const count = await withTenant({ schoolId: LGS }, () => prisma.department.count());
    expect(count).toBe(1);
  });

  it('leaves the tenant table itself reachable, since School is the tenant', async () => {
    const schools = await prisma.school.findMany({ where: { id: { in: [LGS, OTHER] } } });
    expect(schools).toHaveLength(2);
  });

  it('keeps the context across an await boundary', async () => {
    await withTenant({ schoolId: LGS }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const rows = await prisma.department.findMany();
      expect(rows.every((row) => row.schoolId === LGS)).toBe(true);
    });
  });
});
