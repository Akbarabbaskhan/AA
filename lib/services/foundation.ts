import { prisma } from '@/lib/db';

export type FoundationSummary = {
  academicYearLabel: string | null;
  students: number;
  staff: number;
  sections: number;
  subjects: number;
  programmes: number;
  departments: number;
  timetableSlots: number;
};

/**
 * Counts for the M0 shell. Every query here runs through the tenant-scoped client, so none
 * of them names `schoolId` — which is the point.
 *
 * Business logic lives in services like this one; route handlers and components never
 * touch Prisma directly.
 */
export async function getFoundationSummary(): Promise<FoundationSummary> {
  const currentYear = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true, label: true },
  });

  const yearFilter = currentYear ? { academicYearId: currentYear.id } : {};

  const [students, staff, sections, subjects, programmes, departments, timetableSlots] =
    await Promise.all([
      prisma.student.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      prisma.staff.count({ where: { deletedAt: null } }),
      prisma.section.count({ where: yearFilter }),
      prisma.subject.count(),
      prisma.programme.count(),
      prisma.department.count(),
      prisma.timetableSlot.count({ where: yearFilter }),
    ]);

  return {
    academicYearLabel: currentYear?.label ?? null,
    students,
    staff,
    sections,
    subjects,
    programmes,
    departments,
    timetableSlots,
  };
}
