import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireCapability, type Actor } from '@/lib/permissions';

/**
 * The staff directory.
 *
 * Read-only, and deliberately thin: this is the screen a coordinator opens to find out who
 * teaches 9701-A and who is covering while somebody is away, not an HR system. Payroll is
 * one of the modules this product does not build.
 */

export const staffQuerySchema = z.object({
  search: z.string().max(120).optional(),
  departmentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

export type StaffRow = {
  id: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  departmentName: string | null;
  email: string | null;
  phone: string | null;
  /** How many sections they teach this year, which is the load question. */
  sectionCount: number;
  /** Set when they head a department. */
  headsDepartment: string | null;
  roles: string[];
};

export async function listStaff(
  actor: Actor,
  query: z.infer<typeof staffQuerySchema>,
): Promise<{ items: StaffRow[]; total: number }> {
  requireCapability(actor, 'user.read');

  const where = {
    deletedAt: null,
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.search
      ? {
          OR: [
            { employeeCode: { contains: query.search, mode: 'insensitive' as const } },
            { designation: { contains: query.search, mode: 'insensitive' as const } },
            { user: { name: { contains: query.search, mode: 'insensitive' as const } } },
            { user: { email: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.staff.findMany({
      where,
      orderBy: { employeeCode: 'asc' },
      take: query.limit,
      select: {
        id: true,
        employeeCode: true,
        designation: true,
        department: { select: { name: true } },
        headsDepartment: { select: { name: true } },
        user: {
          select: { name: true, email: true, phone: true, roles: { select: { role: true } } },
        },
        _count: { select: { sections: true } },
      },
    }),
    prisma.staff.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.user.name,
      employeeCode: row.employeeCode,
      designation: row.designation,
      departmentName: row.department?.name ?? null,
      email: row.user.email,
      phone: row.user.phone,
      sectionCount: row._count.sections,
      headsDepartment: row.headsDepartment[0]?.name ?? null,
      roles: row.user.roles.map((entry) => entry.role),
    })),
    total,
  };
}
