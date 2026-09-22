import { prisma } from '@/lib/db';
import type { Actor } from './actor';

/**
 * Builds the request's Actor in one round trip.
 *
 * Resolved once per request and passed down; services never re-query scope. The arrays are
 * small even for the busiest teacher (a dozen sections), so this stays cheap — and it is
 * cached in Redis by lib/auth/session.ts for the life of the session.
 */
export async function resolveActor(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: {
      id: true,
      schoolId: true,
      roles: { select: { role: true } },
      staff: {
        select: {
          id: true,
          departmentId: true,
          sections: { select: { id: true } },
          headsDepartment: { select: { id: true } },
        },
      },
      student: {
        select: {
          id: true,
          enrolments: { where: { droppedAt: null }, select: { sectionId: true } },
        },
      },
      guardian: {
        select: {
          id: true,
          students: { select: { studentId: true } },
        },
      },
    },
  });

  if (!user) return null;

  return {
    userId: user.id,
    schoolId: user.schoolId,
    roles: user.roles.map((entry) => entry.role),
    ...(user.staff ? { staffId: user.staff.id } : {}),
    ...(user.student ? { studentId: user.student.id } : {}),
    ...(user.guardian ? { guardianId: user.guardian.id } : {}),
    sectionIds: user.staff?.sections.map((section) => section.id) ?? [],
    enrolledSectionIds: user.student?.enrolments.map((e) => e.sectionId) ?? [],
    headOfDepartmentIds: user.staff?.headsDepartment.map((d) => d.id) ?? [],
    childStudentIds: user.guardian?.students.map((link) => link.studentId) ?? [],
  };
}
