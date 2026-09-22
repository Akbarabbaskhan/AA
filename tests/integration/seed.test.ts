import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tenancyExtension } from '@/lib/db/tenancy';
import { withTenant, withoutTenantScope } from '@/lib/db/tenant-context';
import { findClashes, type SlotPlacement } from '@/lib/services/timetable-clash';
import { SUBJECTS } from '@/prisma/seed/curriculum';

const prisma = new PrismaClient().$extends(tenancyExtension);
const TENANT_SLUG = process.env['DEFAULT_TENANT_SLUG'] ?? 'volt-demo';

let schoolId: string;
let academicYearId: string;

beforeAll(async () => {
  const school = await withoutTenantScope(() =>
    prisma.school.findFirst({ where: { slug: TENANT_SLUG }, select: { id: true } }),
  );
  if (!school) {
    throw new Error(`Demo tenant "${TENANT_SLUG}" is not seeded. Run: npm run db:seed`);
  }
  schoolId = school.id;

  const year = await withTenant({ schoolId }, () =>
    prisma.academicYear.findFirstOrThrow({ where: { isCurrent: true }, select: { id: true } }),
  );
  academicYearId = year.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('seed: volume', () => {
  it('produces the 2,000 students the demo needs', async () => {
    const count = await withTenant({ schoolId }, () =>
      prisma.student.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    );
    expect(count).toBe(2000);
  });

  it('produces 150 staff across six departments with an HOD each', async () => {
    // Counted within a department: the office roles (coordinator, bursar) are staff too,
    // but they belong to no department and are not part of the teaching establishment.
    const [staff, departments, headed] = await withTenant({ schoolId }, async () => [
      await prisma.staff.count({ where: { departmentId: { not: null } } }),
      await prisma.department.count(),
      await prisma.department.count({ where: { hodStaffId: { not: null } } }),
    ]);

    expect(staff).toBe(150);
    expect(departments).toBe(6);
    expect(headed).toBe(6);
  });

  it('runs two academic years, exactly one of them current', async () => {
    const years = await withTenant({ schoolId }, () => prisma.academicYear.findMany());
    expect(years).toHaveLength(2);
    expect(years.filter((year) => year.isCurrent)).toHaveLength(1);
  });

  it('gives students real A Level combinations rather than every subject', async () => {
    const students = await withTenant({ schoolId }, () =>
      prisma.student.findMany({
        take: 200,
        select: {
          enrolments: {
            select: { section: { select: { subject: { select: { code: true } } } } },
          },
        },
      }),
    );

    const validCombinations = new Set(
      SUBJECTS.map((subject) => subject.code),
    );

    for (const student of students) {
      const codes = student.enrolments.map((e) => e.section.subject.code);
      // "A Level students pick 3–4 subjects."
      expect(codes.length).toBeGreaterThanOrEqual(3);
      expect(codes.length).toBeLessThanOrEqual(4);
      // No duplicates, and every code is a real subject.
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) expect(validCombinations.has(code)).toBe(true);
    }
  });

  it('keeps class sizes teachable', async () => {
    const sections = await withTenant({ schoolId }, () =>
      prisma.section.findMany({
        where: { academicYearId },
        select: { capacity: true, _count: { select: { enrolments: true } } },
      }),
    );

    expect(sections.length).toBeGreaterThan(100);
    for (const section of sections) {
      expect(section._count.enrolments).toBeLessThanOrEqual(section.capacity);
    }
  });

  it('gives every section a teacher and a room', async () => {
    const orphaned = await withTenant({ schoolId }, () =>
      prisma.section.count({
        where: { academicYearId, OR: [{ teacherId: null }, { roomId: null }] },
      }),
    );
    expect(orphaned).toBe(0);
  });

  it('gives every student a guardian who receives alerts', async () => {
    const withoutGuardian = await withTenant({ schoolId }, () =>
      prisma.student.count({ where: { guardians: { none: {} } } }),
    );
    expect(withoutGuardian).toBe(0);
  });

  it('links some guardians to more than one child, so the child switcher has a subject', async () => {
    const guardians = await withTenant({ schoolId }, () =>
      prisma.guardian.findMany({ select: { _count: { select: { students: true } } } }),
    );
    const multiChild = guardians.filter((guardian) => guardian._count.students > 1);
    expect(multiChild.length).toBeGreaterThan(50);
  });
});

describe('seed: the timetable is clash-free on all three axes', () => {
  it('has no teacher, room or student-cohort clash anywhere in the week', async () => {
    const [slots, enrolments] = await withTenant({ schoolId }, async () => [
      await prisma.timetableSlot.findMany({
        where: { academicYearId },
        select: {
          sectionId: true,
          dayOfWeek: true,
          periodIndex: true,
          roomId: true,
          section: { select: { teacherId: true } },
        },
      }),
      await prisma.enrolment.findMany({
        where: { academicYearId, droppedAt: null },
        select: { studentId: true, sectionId: true },
      }),
    ]);

    expect(slots.length).toBeGreaterThan(500);

    const placements: SlotPlacement[] = slots.map((slot) => ({
      sectionId: slot.sectionId,
      dayOfWeek: slot.dayOfWeek,
      periodIndex: slot.periodIndex,
      teacherId: slot.section.teacherId,
      roomId: slot.roomId,
    }));

    const studentSections = new Map<string, string[]>();
    for (const enrolment of enrolments) {
      const list = studentSections.get(enrolment.studentId) ?? [];
      list.push(enrolment.sectionId);
      studentSections.set(enrolment.studentId, list);
    }

    const clashes = findClashes(placements, studentSections);

    // Print the first few rather than a 2,000-line diff if this ever breaks.
    expect(clashes.slice(0, 5)).toEqual([]);
    expect(clashes).toHaveLength(0);
  });

  it('timetables every section for the same number of periods a week', async () => {
    const slots = await withTenant({ schoolId }, () =>
      prisma.timetableSlot.groupBy({
        by: ['sectionId'],
        where: { academicYearId },
        _count: { _all: true },
      }),
    );

    expect(slots.length).toBeGreaterThan(100);
    for (const entry of slots) {
      expect(entry._count._all).toBe(4);
    }
  });

  it('spreads each section across different days rather than stacking one day', async () => {
    const section = await withTenant({ schoolId }, () =>
      prisma.section.findFirstOrThrow({
        where: { academicYearId },
        select: { timetableSlots: { select: { dayOfWeek: true } } },
      }),
    );
    const days = section.timetableSlots.map((slot) => slot.dayOfWeek);
    expect(new Set(days).size).toBe(days.length);
  });

  it('leaves room in the week rather than filling all 48 periods', async () => {
    // 6 days × 8 periods, with the option blocks using 32 — the rest is assembly, games
    // and free periods, which is what a real A Level week looks like.
    const used = await withTenant({ schoolId }, () =>
      prisma.timetableSlot.groupBy({
        by: ['dayOfWeek', 'periodIndex'],
        where: { academicYearId },
      }),
    );
    expect(used.length).toBeLessThan(48);
    expect(used.length).toBeGreaterThan(20);
  });
});
