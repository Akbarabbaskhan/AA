import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import {
  commitRollover,
  getRolloverRun,
  previewRollover,
  revertRollover,
} from '@/lib/services/rollover';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

/**
 * The year-end rollover, run for real and then undone.
 *
 * Committing against the shared demo tenant and reverting is the only honest way to test this:
 * the promise is "previewable before commit and reversible within 24 hours", and a test that
 * only previewed would be testing the easy half. The suite therefore ends with the tenant back
 * in its seeded state, which is asserted rather than assumed.
 */

let schoolId: string;
let admin: Actor;
let teacher: Actor;
let student: Actor;
let baseline: {
  currentYearLabel: string;
  sections: number;
  enrolments: number;
  activeStudents: number;
  graduated: number;
};

const NEW_LABEL = '2099–00';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  const staff = await asActor(admin, () =>
    testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'TEACHER' } } },
      select: { email: true },
    }),
  );
  teacher = await actorByEmail(schoolId, staff.email!);

  baseline = await asActor(admin, async () => {
    const year = await testPrisma.academicYear.findFirstOrThrow({
      where: { isCurrent: true },
      select: { label: true },
    });
    return {
      currentYearLabel: year.label,
      sections: await testPrisma.section.count(),
      enrolments: await testPrisma.enrolment.count(),
      activeStudents: await testPrisma.student.count({ where: { status: 'ACTIVE' } }),
      graduated: await testPrisma.student.count({ where: { status: 'GRADUATED' } }),
    };
  });
});

afterAll(async () => {
  // Belt and braces: if an assertion failed mid-way, leave nothing of the test year behind.
  await asActor(admin, async () => {
    const stray = await testPrisma.academicYear.findFirst({
      where: { label: NEW_LABEL },
      select: { id: true },
    });
    if (stray) {
      await testPrisma.enrolment.deleteMany({ where: { academicYearId: stray.id } });
      await testPrisma.timetableSlot.deleteMany({ where: { academicYearId: stray.id } });
      await testPrisma.feeStructure.deleteMany({ where: { academicYearId: stray.id } });
      await testPrisma.section.deleteMany({ where: { academicYearId: stray.id } });
      await testPrisma.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      await testPrisma.academicYear.delete({ where: { id: stray.id } });
      const previous = await testPrisma.academicYear.findFirstOrThrow({
        where: { label: baseline.currentYearLabel },
        select: { id: true },
      });
      await testPrisma.academicYear.update({ where: { id: previous.id }, data: { isCurrent: true } });
    }
    await testPrisma.rolloverRun.deleteMany({ where: { planJson: { path: ['newYear', 'label'], equals: NEW_LABEL } } });
  });
  await testPrisma.$disconnect();
});

const input = {
  label: NEW_LABEL,
  startDate: '2099-04-01',
  endDate: '2100-03-31',
  copyTimetable: true,
  copyFeeStructures: true,
  exceptions: [],
};

describe('the rollover preview', () => {
  it('describes the whole year end without writing any of it', async () => {
    const before = await asActor(admin, () => testPrisma.section.count());

    const run = await asActor(admin, () => previewRollover(admin, input));

    expect(run.status).toBe('PREVIEW');
    expect(run.plan.fromYear.label).toBe(baseline.currentYearLabel);
    expect(run.plan.newYear.label).toBe(NEW_LABEL);

    // A cohort moves up and a cohort leaves.
    expect(run.plan.promotions.length).toBeGreaterThan(0);
    expect(run.plan.promotions.some((row) => row.toYearGroup !== null)).toBe(true);
    expect(run.plan.graduating).toBeGreaterThan(100);
    expect(run.plan.sectionsToCreate).toBe(before);
    expect(run.plan.enrolmentsToCreate).toBeGreaterThan(1_000);
    expect(run.plan.timetableSlotsToCopy).toBeGreaterThan(100);

    // And it says what it will not touch, which is the part that frightens people.
    expect(run.plan.warnings.join(' ')).toContain('marks, attendance and fees stay as they are');

    // Nothing has been created.
    expect(await asActor(admin, () => testPrisma.section.count())).toBe(before);
    expect(
      await asActor(admin, () =>
        testPrisma.academicYear.count({ where: { label: NEW_LABEL } }),
      ),
    ).toBe(0);
  });

  it('refuses a year label that already exists', async () => {
    await expect(
      asActor(admin, () => previewRollover(admin, { ...input, label: baseline.currentYearLabel })),
    ).rejects.toMatchObject({ code: 'yearExists' });
  });

  it('refuses dates that run backwards', async () => {
    await expect(
      asActor(admin, () =>
        previewRollover(admin, { ...input, startDate: '2099-04-01', endDate: '2099-03-31' }),
      ),
    ).rejects.toMatchObject({ code: 'invalidDates' });
  });

  it('is refused to a teacher and a student', async () => {
    for (const actor of [teacher, student]) {
      await expect(asActor(actor, () => previewRollover(actor, input))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
});

describe('the rollover itself', () => {
  it('promotes, graduates, copies the timetable, and is then undone cleanly', async () => {
    const preview = await asActor(admin, () => previewRollover(admin, input));

    const committed = await asActor(admin, () => commitRollover(admin, preview.id));
    expect(committed.status).toBe('COMMITTED');
    expect(committed.revertibleUntil).toBeTruthy();

    const after = await asActor(admin, async () => {
      const year = await testPrisma.academicYear.findFirstOrThrow({
        where: { isCurrent: true },
        select: { id: true, label: true },
      });
      return {
        yearId: year.id,
        label: year.label,
        sections: await testPrisma.section.count({ where: { academicYearId: year.id } }),
        enrolments: await testPrisma.enrolment.count({ where: { academicYearId: year.id } }),
        slots: await testPrisma.timetableSlot.count({ where: { academicYearId: year.id } }),
        fees: await testPrisma.feeStructure.count({ where: { academicYearId: year.id } }),
        graduated: await testPrisma.student.count({ where: { status: 'GRADUATED' } }),
        oldSections: await testPrisma.section.count(),
      };
    });

    // The new year is current, and built.
    expect(after.label).toBe(NEW_LABEL);
    expect(after.sections).toBe(preview.plan.sectionsToCreate);
    expect(after.enrolments).toBe(preview.plan.enrolmentsToCreate);
    expect(after.slots).toBe(preview.plan.timetableSlotsToCopy);
    expect(after.fees).toBe(preview.plan.feeStructuresToCopy);

    // The leaving cohort has graduated.
    expect(after.graduated).toBe(baseline.graduated + preview.plan.graduating);

    // Last year is untouched: its sections and enrolments are still there.
    expect(after.oldSections).toBe(baseline.sections + preview.plan.sectionsToCreate);

    // A student who moved up is in the next year group, taking the same subjects.
    const moved = await asActor(admin, () =>
      testPrisma.enrolment.findFirst({
        where: { academicYearId: after.yearId },
        select: {
          student: { select: { rollNumber: true, status: true } },
          section: { select: { name: true, yearGroup: { select: { order: true } } } },
        },
      }),
    );
    expect(moved?.student.status).toBe('ACTIVE');
    expect(moved?.section.yearGroup.order).toBeGreaterThan(0);

    /*
     * Real work in the new year blocks the undo. This is the guard that matters: by day two a
     * revert would delete a fortnight of registers, and losing them quietly is worse than
     * living with a bad rollover.
     */
    const guard = await asActor(admin, async () => {
      const section = await testPrisma.section.findFirstOrThrow({
        where: { academicYearId: after.yearId },
        select: { id: true },
      });
      return testPrisma.attendanceSession.create({
        data: {
          schoolId,
          academicYearId: after.yearId,
          sectionId: section.id,
          date: new Date('2099-04-02T00:00:00.000Z'),
          periodIndex: 1,
        },
        select: { id: true },
      });
    });

    await expect(
      asActor(admin, () => revertRollover(admin, preview.id, 'Testing the guard')),
    ).rejects.toMatchObject({ code: 'newYearInUse' });

    await asActor(admin, () => testPrisma.attendanceSession.delete({ where: { id: guard.id } }));

    const reverted = await asActor(admin, () =>
      revertRollover(admin, preview.id, 'Undoing the test rollover'),
    );
    expect(reverted.status).toBe('REVERTED');

    // And the school is exactly where it started.
    const restored = await asActor(admin, async () => ({
      currentYearLabel: (
        await testPrisma.academicYear.findFirstOrThrow({
          where: { isCurrent: true },
          select: { label: true },
        })
      ).label,
      sections: await testPrisma.section.count(),
      enrolments: await testPrisma.enrolment.count(),
      activeStudents: await testPrisma.student.count({ where: { status: 'ACTIVE' } }),
      graduated: await testPrisma.student.count({ where: { status: 'GRADUATED' } }),
      years: await testPrisma.academicYear.count({ where: { label: NEW_LABEL } }),
    }));

    expect(restored).toEqual({ ...baseline, years: 0 });
  }, 180_000);

  it('refuses to run the same preview twice', async () => {
    const preview = await asActor(admin, () => previewRollover(admin, input));
    await asActor(admin, () => commitRollover(admin, preview.id));

    await expect(asActor(admin, () => commitRollover(admin, preview.id))).rejects.toMatchObject({
      code: 'alreadyCommitted',
    });

    await asActor(admin, () => revertRollover(admin, preview.id, 'Cleaning up after the test'));
    const finished = await asActor(admin, () => getRolloverRun(admin, preview.id));
    expect(finished.status).toBe('REVERTED');
  }, 180_000);
});
