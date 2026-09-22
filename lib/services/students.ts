import { z } from 'zod';
import { prisma } from '@/lib/db';
import { cursorArgs, paginationSchema, toPage, type Page } from '@/lib/api/pagination';
import { studentScopeFilter, type Actor } from '@/lib/permissions';
import type { Prisma } from '@prisma/client';

export const studentQuerySchema = paginationSchema.extend({
  search: z.string().max(100).optional(),
  yearGroupId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'SUSPENDED']).optional(),
});

export type StudentListItem = {
  id: string;
  name: string;
  rollNumber: string;
  admissionNumber: string;
  photoUrl: string | null;
  house: string | null;
  status: string;
  yearGroup: string | null;
};

/**
 * The student list.
 *
 * "Students must never be able to read another student's marks, remarks, fee status or
 * contact details through any endpoint, including list endpoints and search." That rule is
 * applied here as a `where` predicate rather than by filtering results afterwards, so it
 * holds however the caller paginates or searches.
 */
export async function listStudents(
  actor: Actor,
  query: z.infer<typeof studentQuerySchema>,
): Promise<Page<StudentListItem>> {
  const filters: Prisma.StudentWhereInput[] = [
    { deletedAt: null },
    // Row scope first, and composed with AND so a search can never widen it.
    studentScopeFilter(actor) as Prisma.StudentWhereInput,
  ];

  if (query.status) filters.push({ status: query.status });
  if (query.yearGroupId) {
    filters.push({
      enrolments: { some: { section: { yearGroupId: query.yearGroupId }, droppedAt: null } },
    });
  }
  if (query.sectionId) {
    filters.push({ enrolments: { some: { sectionId: query.sectionId, droppedAt: null } } });
  }
  if (query.search) {
    filters.push({
      OR: [
        { user: { name: { contains: query.search, mode: 'insensitive' } } },
        { rollNumber: { contains: query.search, mode: 'insensitive' } },
        { admissionNumber: { contains: query.search, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.StudentWhereInput = { AND: filters };

  const rows = await prisma.student.findMany({
    where,
    ...cursorArgs(query),
    orderBy: { rollNumber: 'asc' },
    select: {
      id: true,
      rollNumber: true,
      admissionNumber: true,
      photoUrl: true,
      house: true,
      status: true,
      user: { select: { name: true } },
      enrolments: {
        where: { droppedAt: null },
        take: 1,
        select: { section: { select: { yearGroup: { select: { name: true } } } } },
      },
    },
  });

  return toPage(
    rows.map((row) => ({
      id: row.id,
      name: row.user.name,
      rollNumber: row.rollNumber,
      admissionNumber: row.admissionNumber,
      photoUrl: row.photoUrl,
      house: row.house,
      status: row.status,
      yearGroup: row.enrolments[0]?.section.yearGroup.name ?? null,
    })),
    query.limit,
  );
}
