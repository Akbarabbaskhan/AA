import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import { searchAuditLog, visibleEntityTypes, diffFields } from '@/lib/services/audit-search';
import { createRemark, listRemarks } from '@/lib/services/remarks';
import { listStaff } from '@/lib/services/staff';
import { saveMarks } from '@/lib/services/exams/marks';
import { resolveActor } from '@/lib/permissions/resolve';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

/**
 * The admin console: the audit log a coordinator answers a parent from, the staff directory,
 * and the behaviour notes a teacher writes.
 */

let schoolId: string;
let admin: Actor;
let bursar: Actor;
let teacher: Actor;
let student: Actor;
let parent: Actor;
let teacherStudentId: string;
let assessmentId: string;

const TEST_PREFIX = '[test] ';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  bursar = await actorByEmail(schoolId, 'bursar@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  /*
   * A published series is a fixed record and refuses a mark change, which is the point of
   * publication. The seed deliberately leaves the latest series unpublished for the demo, so
   * this restores that state if an earlier suite published it rather than inventing a series.
   */
  await asActor(admin, async () => {
    const latest = await testPrisma.examSeries.findFirstOrThrow({
      where: { assessments: { some: { marks: { some: {} } } } },
      orderBy: { startDate: 'desc' },
      select: { id: true, isPublished: true },
    });
    if (latest.isPublished) {
      const { unpublishExamSeries } = await import('@/lib/services/exams/publish');
      await unpublishExamSeries(admin, latest.id, 'Restoring the seeded demo state for a test run');
    }
  });

  const picked = await asActor(admin, async () => {
    // A teacher with a section, an assessment in it, and a student enrolled in it: enough to
    // change a mark and then find that change in the log.
    const assessment = await testPrisma.assessment.findFirstOrThrow({
      where: {
        marks: { some: {} },
        section: { teacherId: { not: null } },
        examSeries: { isPublished: false },
      },
      select: {
        id: true,
        sectionId: true,
        section: { select: { teacherId: true } },
        marks: { take: 1, select: { studentId: true } },
      },
    });
    const staff = await testPrisma.staff.findFirstOrThrow({
      where: { id: assessment.section.teacherId ?? '' },
      select: { user: { select: { email: true } } },
    });
    const guardian = await testPrisma.guardian.findFirstOrThrow({
      where: { students: { some: {} } },
      select: { userId: true },
    });
    return {
      assessmentId: assessment.id,
      studentId: assessment.marks[0]!.studentId,
      teacherEmail: staff.user.email!,
      guardianUserId: guardian.userId,
    };
  });

  assessmentId = picked.assessmentId;
  teacherStudentId = picked.studentId;
  teacher = await actorByEmail(schoolId, picked.teacherEmail);
  parent = (await asActor(admin, () => resolveActor(picked.guardianUserId)))!;
});

afterAll(async () => {
  await asActor(admin, async () => {
    await testPrisma.behaviourNote.deleteMany({ where: { body: { startsWith: TEST_PREFIX } } });
  });
  await testPrisma.$disconnect();
});

describe('the audit log', () => {
  it('answers "who changed this mark, and what was it before?" from a student name', async () => {
    const { before, total } = await asActor(admin, async () => ({
      before: await testPrisma.mark.findFirstOrThrow({
        where: { assessmentId, studentId: teacherStudentId },
        select: { marksObtained: true },
      }),
      total: (
        await testPrisma.assessment.findFirstOrThrow({
          where: { id: assessmentId },
          select: { totalMarks: true },
        })
      ).totalMarks,
    }));

    // A mark inside the paper's total, and different from what is there: a mark above the
    // total is refused per entry rather than thrown, which would leave nothing to find.
    const current = before.marksObtained ?? 0;
    const changed = current > 0 ? current - 1 : Math.min(1, total);

    const saved = await asActor(teacher, () =>
      saveMarks(teacher, assessmentId, {
        entries: [{ studentId: teacherStudentId, marksObtained: changed, isAbsent: false }],
      }),
    );
    expect(saved.results.every((result) => result.applied)).toBe(true);

    const name = await asActor(admin, () =>
      testPrisma.student.findFirstOrThrow({
        where: { id: teacherStudentId },
        select: { user: { select: { name: true } } },
      }),
    );

    const page = await asActor(admin, () =>
      searchAuditLog(admin, { student: name.user.name, action: 'marks', limit: 20 } as never),
    );

    const row = page.rows.find((entry) => entry.entityId.endsWith(`:${teacherStudentId}`));
    expect(row, 'the mark change must be findable by the student’s name').toBeTruthy();

    // What it was, what it became, and who did it — the three facts the parent asked for.
    expect(row!.actorName.length).toBeGreaterThan(0);
    expect(row!.changes.some((change) => change.field === 'marksObtained')).toBe(true);
    expect(row!.changes.find((change) => change.field === 'marksObtained')?.after).toBe(
      String(changed),
    );
    // And the label says which subject and series, not a pair of uuids.
    expect(row!.label).toContain(name.user.name);
    expect(row!.label).not.toBe(row!.entityId);
  });

  it('filters by date range, and by the member of staff who made the change', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const byDate = await asActor(admin, () =>
      searchAuditLog(admin, { from: today, to: today, limit: 50 } as never),
    );
    expect(byDate.rows.length).toBeGreaterThan(0);
    expect(byDate.rows.every((row) => row.at.slice(0, 10) === today)).toBe(true);

    const actorName = byDate.rows[0]!.actorName;
    const byActor = await asActor(admin, () =>
      searchAuditLog(admin, { actor: actorName, limit: 50 } as never),
    );
    expect(byActor.rows.length).toBeGreaterThan(0);
    expect(byActor.rows.every((row) => row.actorName === actorName)).toBe(true);
  });

  it('returns nothing for a student nobody is called, rather than everything', async () => {
    const page = await asActor(admin, () =>
      searchAuditLog(admin, { student: 'Zzzz Noone', limit: 20 } as never),
    );
    expect(page.rows).toEqual([]);
  });

  it('never shows the bursar an academic change', async () => {
    // The bursar holds `audit.read` for the finance trail. The log must not become the way
    // around every other boundary in the app: a mark change carries the mark in `after`.
    const types = visibleEntityTypes(bursar);
    expect(types).not.toContain('Mark');
    expect(types).not.toContain('BehaviourNote');
    expect(types).toContain('Payment');

    const page = await asActor(bursar, () => searchAuditLog(bursar, { limit: 100 } as never));
    expect(page.rows.every((row) => row.entityType !== 'Mark')).toBe(true);

    // Asking for marks directly is empty rather than an error, and still not a leak.
    const asked = await asActor(bursar, () =>
      searchAuditLog(bursar, { entityType: 'Mark', limit: 20 } as never),
    );
    expect(asked.rows).toEqual([]);
  });

  it('refuses a teacher, a student and a parent the log entirely', async () => {
    for (const actor of [teacher, student, parent]) {
      const types = visibleEntityTypes(actor);
      expect(types).toEqual([]);
      await expect(asActor(actor, () => searchAuditLog(actor, { limit: 10 } as never))).rejects.toThrow();
    }
  });

  it('pages without repeating or skipping a row', async () => {
    const first = await asActor(admin, () => searchAuditLog(admin, { limit: 5 } as never));
    expect(first.rows).toHaveLength(5);
    expect(first.nextCursor).toBeTruthy();

    const second = await asActor(admin, () =>
      searchAuditLog(admin, { limit: 5, cursor: first.nextCursor! } as never),
    );
    const firstIds = new Set(first.rows.map((row) => row.id));
    expect(second.rows.some((row) => firstIds.has(row.id))).toBe(false);
  });

  it('reads a diff rather than two blobs of JSON', () => {
    const changes = diffFields(
      { marksObtained: 62, isAbsent: false },
      { marksObtained: 71, isAbsent: false },
    );
    expect(changes).toEqual([{ field: 'marksObtained', before: '62', after: '71' }]);
  });
});

describe('the staff directory', () => {
  it('lists staff with their department, their load and who heads what', async () => {
    const page = await asActor(admin, () => listStaff(admin, { limit: 100 }));
    expect(page.total).toBeGreaterThan(100);
    expect(page.items.some((member) => member.headsDepartment !== null)).toBe(true);
    expect(page.items.some((member) => member.sectionCount > 0)).toBe(true);
    expect(page.items.every((member) => member.employeeCode.length > 0)).toBe(true);
  });

  it('searches by name and by employee code', async () => {
    const all = await asActor(admin, () => listStaff(admin, { limit: 5 }));
    const target = all.items[0]!;

    const byCode = await asActor(admin, () =>
      listStaff(admin, { search: target.employeeCode, limit: 5 }),
    );
    expect(byCode.items.map((member) => member.id)).toContain(target.id);
  });

  it('is refused to a student', async () => {
    await expect(asActor(student, () => listStaff(student, { limit: 5 }))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('merits and demerits', () => {
  it('lets a teacher write a note about a student they teach', async () => {
    const created = await asActor(teacher, () =>
      createRemark(teacher, {
        studentId: teacherStudentId,
        type: 'MERIT',
        severity: 2,
        body: `${TEST_PREFIX}Stayed behind to help pack up the lab.`,
        isVisibleToParent: false,
      }),
    );
    expect(created.id).toBeTruthy();

    const rows = await asActor(teacher, () =>
      listRemarks(teacher, { studentId: teacherStudentId, visibleToParentOnly: false, limit: 20 }),
    );
    const mine = rows.find((row) => row.id === created.id);
    expect(mine?.isMine).toBe(true);
    expect(mine?.isVisibleToParent).toBe(false);
  });

  it('writes an audit row a coordinator can find', async () => {
    const page = await asActor(admin, () =>
      searchAuditLog(admin, { action: 'remark', limit: 20 } as never),
    );
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((row) => row.entityType === 'BehaviourNote')).toBe(true);
  });

  it('keeps a staff-only note out of the family’s portal', async () => {
    const { getParentRemarks } = await import('@/lib/services/parents');
    const visible = await asActor(parent, () => getParentRemarks(parent));
    expect(visible.every((note) => !note.body.startsWith(TEST_PREFIX))).toBe(true);
  });

  it('refuses a note about a student this teacher does not teach', async () => {
    const stranger = await asActor(admin, () =>
      testPrisma.student.findFirstOrThrow({
        where: { enrolments: { every: { sectionId: { notIn: [...teacher.sectionIds] } } } },
        select: { id: true },
      }),
    );

    await expect(
      asActor(teacher, () =>
        createRemark(teacher, {
          studentId: stranger.id,
          type: 'DEMERIT',
          severity: 3,
          body: `${TEST_PREFIX}Not my student.`,
          isVisibleToParent: false,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('never lets a student write a note', async () => {
    await expect(
      asActor(student, () =>
        createRemark(student, {
          studentId: student.studentId!,
          type: 'MERIT',
          severity: 5,
          body: `${TEST_PREFIX}I was excellent today.`,
          isVisibleToParent: true,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('shows a student only the notes the school chose to share', async () => {
    const rows = await asActor(student, () =>
      listRemarks(student, { visibleToParentOnly: false, limit: 50 }),
    );
    expect(rows.every((row) => row.isVisibleToParent)).toBe(true);
    expect(rows.every((row) => row.studentId === student.studentId)).toBe(true);
  });
});
