import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';

/**
 * The year-end rollover.
 *
 * "A once-a-year operation that must not be a developer task." It is also the single most
 * destructive thing anybody will ever do in this system, which is why it works the way a
 * surgeon works: a plan you read first, a commit that records exactly what it did, and a
 * revert that undoes that record rather than recomputing what it thinks happened.
 *
 * What it does, in the spec's order: creates the new academic year, promotes each cohort a
 * year group up with an exception list, graduates the leaving cohort, carries staff and
 * subjects forward, copies the timetable, and generates the new fee structures.
 *
 * What it deliberately does not do: touch a single mark, attendance record, invoice or
 * payment. Last year's records are last year's, and a rollover that rewrote history would be
 * unauditable. The new year is built alongside the old one.
 */

export const ROLLOVER_REVERT_WINDOW_HOURS = 24;

export const rolloverExceptionSchema = z.object({
  studentId: z.string().uuid(),
  /** Repeat the year, leave now, or graduate early — the three exceptions a school has. */
  action: z.enum(['REPEAT', 'WITHDRAW', 'GRADUATE']),
  reason: z.string().max(300).optional(),
});

export const rolloverInputSchema = z.object({
  label: z.string().min(4).max(40),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Sections, and the timetable that hangs off them. Off means "we will rebuild it". */
  copyTimetable: z.boolean().default(true),
  copyFeeStructures: z.boolean().default(true),
  exceptions: z.array(rolloverExceptionSchema).max(2_000).default([]),
});

export type RolloverInput = z.infer<typeof rolloverInputSchema>;

export type RolloverPlan = {
  fromYear: { id: string; label: string };
  newYear: { label: string; startDate: string; endDate: string };
  /** One row per year group: how many students move, and where to. */
  promotions: {
    fromYearGroup: string;
    toYearGroup: string | null;
    students: number;
    /** Students whose subjects do not all exist in the next year group. */
    subjectGaps: number;
  }[];
  graduating: number;
  repeating: number;
  withdrawing: number;
  sectionsToCreate: number;
  enrolmentsToCreate: number;
  timetableSlotsToCopy: number;
  feeStructuresToCopy: number;
  /** Anything a coordinator should read before pressing the button. */
  warnings: string[];
};

export type RolloverRunRow = {
  id: string;
  status: 'PREVIEW' | 'COMMITTED' | 'REVERTED';
  fromYearLabel: string;
  newYearLabel: string;
  createdAt: string;
  committedAt: string | null;
  revertedAt: string | null;
  /** Null unless committed and still inside the window. */
  revertibleUntil: string | null;
  plan: RolloverPlan;
};

/** What the commit created, which is what a revert deletes. Stored on the run. */
type RolloverResult = {
  toYearId: string;
  sectionIds: string[];
  enrolmentIds: string[];
  timetableSlotIds: string[];
  feeStructureIds: string[];
  /** Student statuses the commit changed, with what they were. */
  studentStatuses: { studentId: string; previous: string; next: string }[];
  previousCurrentYearId: string;
};

async function loadCurrentYear() {
  const year = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true, label: true, startDate: true, endDate: true },
  });
  if (!year)
    throw ApiError.badRequest('noCurrentYear', 'This school has no current academic year.');
  return year;
}

/**
 * The promotion map: which year group each one feeds into.
 *
 * By `order`, so a school with three years (or ten) needs no code change. The last year group
 * has no successor, which is what "graduating" means.
 */
async function promotionMap(): Promise<{
  groups: { id: string; name: string; order: number }[];
  nextOf: Map<string, string | null>;
}> {
  const groups = await prisma.yearGroup.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, name: true, order: true },
  });

  const nextOf = new Map<string, string | null>();
  groups.forEach((group, index) => {
    nextOf.set(group.id, groups[index + 1]?.id ?? null);
  });

  return { groups, nextOf };
}

export async function previewRollover(actor: Actor, raw: unknown): Promise<RolloverRunRow> {
  requireCapability(actor, 'structure.manage');
  const input = rolloverInputSchema.parse(raw);

  if (input.endDate <= input.startDate) {
    throw ApiError.badRequest('invalidDates', 'The year has to end after it starts.', {
      endDate: ['Must be after the start date.'],
    });
  }

  const fromYear = await loadCurrentYear();

  const clash = await prisma.academicYear.findFirst({
    where: { label: input.label },
    select: { id: true },
  });
  if (clash) {
    throw ApiError.conflict('yearExists', `There is already a year called ${input.label}.`);
  }

  const { groups, nextOf } = await promotionMap();
  if (groups.length === 0) {
    throw ApiError.badRequest('noYearGroups', 'Set up year groups before rolling over.');
  }

  const [sections, slots, feeStructures, enrolments] = await Promise.all([
    prisma.section.findMany({
      where: { academicYearId: fromYear.id },
      select: {
        id: true,
        name: true,
        yearGroupId: true,
        subjectId: true,
        teacherId: true,
        roomId: true,
        capacity: true,
      },
    }),
    prisma.timetableSlot.count({ where: { academicYearId: fromYear.id } }),
    prisma.feeStructure.findMany({
      where: { academicYearId: fromYear.id },
      select: { id: true, yearGroupId: true, frequency: true, headsJson: true },
    }),
    prisma.enrolment.findMany({
      where: { academicYearId: fromYear.id, droppedAt: null, student: { status: 'ACTIVE' } },
      select: {
        studentId: true,
        section: { select: { yearGroupId: true, subjectId: true } },
      },
    }),
  ]);

  const exceptionByStudent = new Map(
    input.exceptions.map((entry) => [entry.studentId, entry.action]),
  );

  // Subjects offered per year group, to spot a student whose combination does not continue.
  const subjectsByYearGroup = new Map<string, Set<string>>();
  for (const section of sections) {
    const set = subjectsByYearGroup.get(section.yearGroupId) ?? new Set<string>();
    set.add(section.subjectId);
    subjectsByYearGroup.set(section.yearGroupId, set);
  }

  const byStudent = new Map<string, { yearGroupId: string; subjects: Set<string> }>();
  for (const enrolment of enrolments) {
    const existing = byStudent.get(enrolment.studentId) ?? {
      yearGroupId: enrolment.section.yearGroupId,
      subjects: new Set<string>(),
    };
    existing.subjects.add(enrolment.section.subjectId);
    byStudent.set(enrolment.studentId, existing);
  }

  const promotions = new Map<string, { students: number; subjectGaps: number }>();
  let graduating = 0;
  let repeating = 0;
  let withdrawing = 0;
  let enrolmentsToCreate = 0;

  for (const [studentId, current] of byStudent) {
    const exception = exceptionByStudent.get(studentId);
    if (exception === 'WITHDRAW') {
      withdrawing += 1;
      continue;
    }
    if (exception === 'GRADUATE') {
      graduating += 1;
      continue;
    }

    const targetYearGroupId =
      exception === 'REPEAT' ? current.yearGroupId : (nextOf.get(current.yearGroupId) ?? null);

    if (!targetYearGroupId) {
      graduating += 1;
      continue;
    }
    if (exception === 'REPEAT') repeating += 1;

    const offered = subjectsByYearGroup.get(targetYearGroupId) ?? new Set<string>();
    const continuing = [...current.subjects].filter((subjectId) => offered.has(subjectId));
    enrolmentsToCreate += continuing.length;

    const row = promotions.get(current.yearGroupId) ?? { students: 0, subjectGaps: 0 };
    row.students += 1;
    if (continuing.length < current.subjects.size) row.subjectGaps += 1;
    promotions.set(current.yearGroupId, row);
  }

  const nameOf = new Map(groups.map((group) => [group.id, group.name]));

  const warnings: string[] = [];
  const topGroup = groups[groups.length - 1];
  if (topGroup && (promotions.get(topGroup.id)?.students ?? 0) === 0 && graduating === 0) {
    warnings.push('No cohort is graduating, which is unusual for a year end.');
  }
  const gaps = [...promotions.values()].reduce((sum, row) => sum + row.subjectGaps, 0);
  if (gaps > 0) {
    warnings.push(
      `${gaps} students take a subject the next year group does not offer; they will be enrolled in the subjects that continue and will need their combination reviewed.`,
    );
  }
  if (input.copyFeeStructures && feeStructures.length === 0) {
    warnings.push('There are no fee structures in the current year to copy.');
  }
  if (!input.copyTimetable) {
    warnings.push('The timetable will not be copied: every section starts the year unscheduled.');
  }
  warnings.push(
    'Staff, subjects, rooms and periods are not year-scoped and carry forward unchanged.',
  );
  warnings.push(
    'Nothing in the current year is altered: marks, attendance and fees stay as they are.',
  );

  const plan: RolloverPlan = {
    fromYear: { id: fromYear.id, label: fromYear.label },
    newYear: { label: input.label, startDate: input.startDate, endDate: input.endDate },
    promotions: groups
      .filter((group) => promotions.has(group.id))
      .map((group) => ({
        fromYearGroup: group.name,
        toYearGroup: nextOf.get(group.id) ? (nameOf.get(nextOf.get(group.id)!) ?? null) : null,
        students: promotions.get(group.id)!.students,
        subjectGaps: promotions.get(group.id)!.subjectGaps,
      })),
    graduating,
    repeating,
    withdrawing,
    sectionsToCreate: sections.length,
    enrolmentsToCreate,
    timetableSlotsToCopy: input.copyTimetable ? slots : 0,
    feeStructuresToCopy: input.copyFeeStructures ? feeStructures.length : 0,
    warnings,
  };

  const run = await prisma.rolloverRun.create({
    data: {
      schoolId: actor.schoolId,
      fromYearId: fromYear.id,
      status: 'PREVIEW',
      inputJson: input as unknown as Prisma.InputJsonValue,
      planJson: plan as unknown as Prisma.InputJsonValue,
      createdByUserId: actor.userId,
    },
    select: { id: true, createdAt: true },
  });

  return {
    id: run.id,
    status: 'PREVIEW',
    fromYearLabel: fromYear.label,
    newYearLabel: input.label,
    createdAt: run.createdAt.toISOString(),
    committedAt: null,
    revertedAt: null,
    revertibleUntil: null,
    plan,
  };
}

/** The new section that the students of one old section move into. */
function successorName(name: string, fromGroup: string, toGroup: string): string {
  return name.startsWith(`${fromGroup} `) ? `${toGroup} ${name.slice(fromGroup.length + 1)}` : name;
}

export async function commitRollover(actor: Actor, runId: string): Promise<RolloverRunRow> {
  requireCapability(actor, 'structure.manage');

  const run = await prisma.rolloverRun.findFirst({
    where: { id: runId },
    select: { id: true, status: true, fromYearId: true, inputJson: true, planJson: true },
  });
  if (!run) throw ApiError.notFound('Rollover not found');
  if (run.status !== 'PREVIEW') {
    throw ApiError.conflict('alreadyCommitted', 'That rollover has already been run.');
  }

  const input = rolloverInputSchema.parse(run.inputJson);
  const fromYear = await prisma.academicYear.findFirstOrThrow({
    where: { id: run.fromYearId },
    select: { id: true, label: true, isCurrent: true },
  });

  const { groups, nextOf } = await promotionMap();
  const nameOf = new Map(groups.map((group) => [group.id, group.name]));

  const [sections, slots, feeStructures, enrolments, students] = await Promise.all([
    prisma.section.findMany({
      where: { academicYearId: fromYear.id },
      select: {
        id: true,
        name: true,
        yearGroupId: true,
        subjectId: true,
        teacherId: true,
        roomId: true,
        capacity: true,
      },
    }),
    prisma.timetableSlot.findMany({
      where: { academicYearId: fromYear.id },
      select: {
        sectionId: true,
        dayOfWeek: true,
        periodIndex: true,
        startTime: true,
        endTime: true,
        roomId: true,
      },
    }),
    prisma.feeStructure.findMany({
      where: { academicYearId: fromYear.id },
      select: { yearGroupId: true, frequency: true, headsJson: true },
    }),
    prisma.enrolment.findMany({
      where: { academicYearId: fromYear.id, droppedAt: null, student: { status: 'ACTIVE' } },
      select: {
        studentId: true,
        section: { select: { yearGroupId: true, subjectId: true, name: true } },
      },
    }),
    prisma.student.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true, status: true },
    }),
  ]);

  const exceptionByStudent = new Map(
    input.exceptions.map((entry) => [entry.studentId, entry.action]),
  );
  const statusByStudent = new Map(students.map((student) => [student.id, student.status]));

  /*
   * Ids are generated up front rather than read back, so one `createMany` per table does the
   * whole year — two thousand students is six thousand enrolments, and a row-at-a-time commit
   * inside a transaction is how a five-second operation becomes a five-minute one.
   */
  const newYearId = randomUUID();
  const sectionIdByOld = new Map<string, string>(
    sections.map((section) => [section.id, randomUUID()]),
  );

  const sectionRows: Prisma.SectionCreateManyInput[] = sections.map((section) => ({
    id: sectionIdByOld.get(section.id)!,
    schoolId: actor.schoolId,
    academicYearId: newYearId,
    yearGroupId: section.yearGroupId,
    subjectId: section.subjectId,
    name: section.name,
    teacherId: section.teacherId,
    roomId: section.roomId,
    capacity: section.capacity,
  }));

  const slotRows: Prisma.TimetableSlotCreateManyInput[] = input.copyTimetable
    ? slots.map((slot) => ({
        id: randomUUID(),
        schoolId: actor.schoolId,
        academicYearId: newYearId,
        sectionId: sectionIdByOld.get(slot.sectionId)!,
        dayOfWeek: slot.dayOfWeek,
        periodIndex: slot.periodIndex,
        startTime: slot.startTime,
        endTime: slot.endTime,
        roomId: slot.roomId,
      }))
    : [];

  const feeRows: Prisma.FeeStructureCreateManyInput[] = input.copyFeeStructures
    ? feeStructures.map((structure) => ({
        id: randomUUID(),
        schoolId: actor.schoolId,
        academicYearId: newYearId,
        yearGroupId: structure.yearGroupId,
        frequency: structure.frequency,
        headsJson: structure.headsJson as Prisma.InputJsonValue,
      }))
    : [];

  // New sections indexed by (year group, subject) and by name, so a student lands in the
  // section with the same letter where one exists rather than all in section A.
  const newSectionsByKey = new Map<string, { id: string; name: string }[]>();
  for (const section of sections) {
    const key = `${section.yearGroupId}:${section.subjectId}`;
    const list = newSectionsByKey.get(key) ?? [];
    list.push({ id: sectionIdByOld.get(section.id)!, name: section.name });
    newSectionsByKey.set(key, list);
  }

  /*
   * Each student's year group, their subjects, and the section name they sat in — the name is
   * what puts them in "A2 Physics A" rather than all two hundred of them in section A.
   */
  const bySubjectAndStudent = new Map<
    string,
    { yearGroupId: string; subjects: Set<string>; names: Map<string, string> }
  >();
  for (const enrolment of enrolments) {
    const existing = bySubjectAndStudent.get(enrolment.studentId) ?? {
      yearGroupId: enrolment.section.yearGroupId,
      subjects: new Set<string>(),
      names: new Map<string, string>(),
    };
    existing.subjects.add(enrolment.section.subjectId);
    existing.names.set(enrolment.section.subjectId, enrolment.section.name);
    bySubjectAndStudent.set(enrolment.studentId, existing);
  }

  const enrolmentRows: Prisma.EnrolmentCreateManyInput[] = [];
  const statusChanges: RolloverResult['studentStatuses'] = [];

  for (const [studentId, current] of bySubjectAndStudent) {
    const exception = exceptionByStudent.get(studentId);

    if (exception === 'WITHDRAW') {
      statusChanges.push({
        studentId,
        previous: statusByStudent.get(studentId) ?? 'ACTIVE',
        next: 'WITHDRAWN',
      });
      continue;
    }

    const targetYearGroupId =
      exception === 'GRADUATE'
        ? null
        : exception === 'REPEAT'
          ? current.yearGroupId
          : (nextOf.get(current.yearGroupId) ?? null);

    if (!targetYearGroupId) {
      statusChanges.push({
        studentId,
        previous: statusByStudent.get(studentId) ?? 'ACTIVE',
        next: 'GRADUATED',
      });
      continue;
    }

    const targetGroupName = nameOf.get(targetYearGroupId) ?? '';
    const currentGroupName = nameOf.get(current.yearGroupId) ?? '';

    for (const subjectId of current.subjects) {
      const candidates = newSectionsByKey.get(`${targetYearGroupId}:${subjectId}`);
      if (!candidates || candidates.length === 0) continue;

      const wanted = successorName(
        current.names.get(subjectId) ?? '',
        currentGroupName,
        targetGroupName,
      );
      const chosen = candidates.find((section) => section.name === wanted) ?? candidates[0]!;

      enrolmentRows.push({
        id: randomUUID(),
        schoolId: actor.schoolId,
        academicYearId: newYearId,
        studentId,
        sectionId: chosen.id,
      });
    }
  }

  const result: RolloverResult = {
    toYearId: newYearId,
    sectionIds: sectionRows.map((row) => row.id as string),
    enrolmentIds: enrolmentRows.map((row) => row.id as string),
    timetableSlotIds: slotRows.map((row) => row.id as string),
    feeStructureIds: feeRows.map((row) => row.id as string),
    studentStatuses: statusChanges,
    previousCurrentYearId: fromYear.id,
  };

  await prisma.$transaction(
    async (tx) => {
      await tx.academicYear.create({
        data: {
          id: newYearId,
          schoolId: actor.schoolId,
          label: input.label,
          startDate: new Date(`${input.startDate}T00:00:00.000Z`),
          endDate: new Date(`${input.endDate}T00:00:00.000Z`),
          isCurrent: false,
        },
      });

      await tx.section.createMany({ data: sectionRows });
      if (slotRows.length > 0) await tx.timetableSlot.createMany({ data: slotRows });
      if (feeRows.length > 0) await tx.feeStructure.createMany({ data: feeRows });
      for (let index = 0; index < enrolmentRows.length; index += 2_000) {
        await tx.enrolment.createMany({ data: enrolmentRows.slice(index, index + 2_000) });
      }

      const graduated = statusChanges.filter((change) => change.next === 'GRADUATED');
      if (graduated.length > 0) {
        await tx.student.updateMany({
          where: { id: { in: graduated.map((change) => change.studentId) } },
          data: { status: 'GRADUATED' },
        });
      }
      const withdrawn = statusChanges.filter((change) => change.next === 'WITHDRAWN');
      if (withdrawn.length > 0) {
        await tx.student.updateMany({
          where: { id: { in: withdrawn.map((change) => change.studentId) } },
          data: { status: 'WITHDRAWN' },
        });
      }

      /*
       * The new year becomes current last, and the old one stops being current in the same
       * statement — the schema allows only one current year per school, and a half-applied
       * rollover that left two would break every screen that asks "which year is it".
       */
      await tx.academicYear.updateMany({
        where: { isCurrent: true },
        data: { isCurrent: false },
      });
      await tx.academicYear.update({ where: { id: newYearId }, data: { isCurrent: true } });

      await tx.rolloverRun.update({
        where: { id: run.id },
        data: {
          status: 'COMMITTED',
          toYearId: newYearId,
          committedAt: new Date(),
          resultJson: result as unknown as Prisma.InputJsonValue,
        },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  await writeAudit(actor, {
    action: 'rollover.commit',
    entityType: 'School',
    entityId: actor.schoolId,
    before: { currentYear: fromYear.label },
    after: {
      currentYear: input.label,
      sections: sectionRows.length,
      enrolments: enrolmentRows.length,
      graduated: statusChanges.filter((change) => change.next === 'GRADUATED').length,
      withdrawn: statusChanges.filter((change) => change.next === 'WITHDRAWN').length,
    },
  });

  return getRolloverRun(actor, run.id);
}

export async function revertRollover(
  actor: Actor,
  runId: string,
  reason: string,
): Promise<RolloverRunRow> {
  requireCapability(actor, 'structure.manage');

  const run = await prisma.rolloverRun.findFirst({
    where: { id: runId },
    select: { id: true, status: true, committedAt: true, resultJson: true, fromYearId: true },
  });
  if (!run) throw ApiError.notFound('Rollover not found');
  if (run.status !== 'COMMITTED' || !run.committedAt || !run.resultJson) {
    throw ApiError.conflict(
      'notCommitted',
      'That rollover has not been run, or is already undone.',
    );
  }

  const deadline = new Date(run.committedAt.getTime() + ROLLOVER_REVERT_WINDOW_HOURS * 3_600_000);
  if (new Date() > deadline) {
    /*
     * Twenty-four hours, as the spec says, and a hard stop. By day two the new year has
     * registers marked and fees raised against it, and "undo" would mean deleting a
     * fortnight of somebody's work — at that point the fix is a correction, not a revert.
     */
    throw ApiError.conflict(
      'revertWindowClosed',
      'A rollover can only be undone within 24 hours of being run.',
    );
  }

  const result = run.resultJson as unknown as RolloverResult;

  const blockers = await prisma.$transaction([
    prisma.attendanceSession.count({ where: { academicYearId: result.toYearId } }),
    prisma.mark.count({ where: { academicYearId: result.toYearId } }),
    prisma.invoice.count({ where: { academicYearId: result.toYearId } }),
  ]);
  const [sessions, marks, invoices] = blockers;
  if (sessions + marks + invoices > 0) {
    // Real work has landed in the new year. Deleting it silently is the one outcome worse
    // than living with a bad rollover.
    throw ApiError.conflict(
      'newYearInUse',
      `The new year already has ${sessions} registers, ${marks} marks and ${invoices} invoices. Undoing it would delete them.`,
    );
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.enrolment.deleteMany({ where: { academicYearId: result.toYearId } });
      await tx.timetableSlot.deleteMany({ where: { academicYearId: result.toYearId } });
      await tx.feeStructure.deleteMany({ where: { academicYearId: result.toYearId } });
      await tx.section.deleteMany({ where: { academicYearId: result.toYearId } });

      for (const change of result.studentStatuses) {
        await tx.student.update({
          where: { id: change.studentId },
          data: { status: change.previous as 'ACTIVE' },
        });
      }

      await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      await tx.academicYear.update({
        where: { id: result.previousCurrentYearId },
        data: { isCurrent: true },
      });
      await tx.academicYear.delete({ where: { id: result.toYearId } });

      await tx.rolloverRun.update({
        where: { id: run.id },
        data: { status: 'REVERTED', revertedAt: new Date() },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  await writeAudit(actor, {
    action: 'rollover.revert',
    entityType: 'School',
    entityId: actor.schoolId,
    before: { currentYearId: result.toYearId },
    after: { currentYearId: result.previousCurrentYearId },
    reason,
  });

  return getRolloverRun(actor, run.id);
}

function toRow(run: {
  id: string;
  status: 'PREVIEW' | 'COMMITTED' | 'REVERTED';
  planJson: unknown;
  createdAt: Date;
  committedAt: Date | null;
  revertedAt: Date | null;
}): RolloverRunRow {
  const plan = run.planJson as RolloverPlan;
  return {
    id: run.id,
    status: run.status,
    fromYearLabel: plan.fromYear.label,
    newYearLabel: plan.newYear.label,
    createdAt: run.createdAt.toISOString(),
    committedAt: run.committedAt?.toISOString() ?? null,
    revertedAt: run.revertedAt?.toISOString() ?? null,
    revertibleUntil:
      run.status === 'COMMITTED' && run.committedAt
        ? new Date(
            run.committedAt.getTime() + ROLLOVER_REVERT_WINDOW_HOURS * 3_600_000,
          ).toISOString()
        : null,
    plan,
  };
}

export async function getRolloverRun(actor: Actor, runId: string): Promise<RolloverRunRow> {
  requireCapability(actor, 'structure.read');
  const run = await prisma.rolloverRun.findFirst({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      planJson: true,
      createdAt: true,
      committedAt: true,
      revertedAt: true,
    },
  });
  if (!run) throw ApiError.notFound('Rollover not found');
  return toRow(run);
}

export async function listRolloverRuns(actor: Actor, limit = 10): Promise<RolloverRunRow[]> {
  requireCapability(actor, 'structure.read');
  const runs = await prisma.rolloverRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      planJson: true,
      createdAt: true,
      committedAt: true,
      revertedAt: true,
    },
  });
  return runs.map(toRow);
}
