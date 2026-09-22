import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { writeAudit } from '@/lib/services/audit';
import { getSchoolSettings } from '@/lib/services/school-settings';
import {
  assertCanAccessSection,
  can,
  hasRole,
  requireCapability,
  type Actor,
} from '@/lib/permissions';
import { toDateOnly, zonedDateString, zonedDayOfWeek, zonedTimeString } from '@/lib/utils/tz';
import { findClashes, validatePlacement, type Clash, type SlotPlacement } from './timetable-clash';

/**
 * The timetable builder and the read views.
 *
 * Clash detection is not advice here: `placeSlot` runs the same three-axis check the
 * validate endpoint does and refuses the write, so a clash cannot be introduced by a client
 * that skipped the preview.
 */

async function currentAcademicYearId(): Promise<string> {
  const year = await prisma.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (!year) throw ApiError.badRequest('noAcademicYear', 'No academic year is set as current.');
  return year.id;
}

/**
 * Everything the cohort axis needs, for one academic year.
 *
 * Deliberately one query rather than a lookup per student: at 2,000 students with four
 * subjects each this is 6,000 rows, and doing it per placement is the N+1 that makes a
 * drag-and-drop builder unusable.
 */
async function loadStudentSections(academicYearId: string): Promise<Map<string, string[]>> {
  const enrolments = await prisma.enrolment.findMany({
    where: { academicYearId, droppedAt: null },
    select: { studentId: true, sectionId: true },
  });

  const map = new Map<string, string[]>();
  for (const enrolment of enrolments) {
    map.set(enrolment.studentId, [...(map.get(enrolment.studentId) ?? []), enrolment.sectionId]);
  }
  return map;
}

async function loadPlacements(academicYearId: string): Promise<SlotPlacement[]> {
  const slots = await prisma.timetableSlot.findMany({
    where: { academicYearId },
    select: {
      sectionId: true,
      dayOfWeek: true,
      periodIndex: true,
      roomId: true,
      section: { select: { teacherId: true } },
    },
  });

  return slots.map((slot) => ({
    sectionId: slot.sectionId,
    dayOfWeek: slot.dayOfWeek,
    periodIndex: slot.periodIndex,
    teacherId: slot.section.teacherId,
    roomId: slot.roomId,
  }));
}

export const placementSchema = z.object({
  sectionId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(7),
  periodIndex: z.number().int().min(1).max(20),
  roomId: z.string().uuid().nullable().optional(),
});

export type PlacementInput = z.infer<typeof placementSchema>;

export type PlacementCheck = {
  ok: boolean;
  clashes: Clash[];
};

/** Powers `POST /api/timetable/validate` — the preview behind the drag-and-drop grid. */
export async function checkPlacement(
  actor: Actor,
  input: PlacementInput,
): Promise<PlacementCheck> {
  requireCapability(actor, 'timetable.read');
  const academicYearId = await currentAcademicYearId();

  const [section, existing, studentSections] = await Promise.all([
    prisma.section.findFirst({
      where: { id: input.sectionId, academicYearId },
      select: { teacherId: true, roomId: true },
    }),
    loadPlacements(academicYearId),
    loadStudentSections(academicYearId),
  ]);
  if (!section) throw ApiError.notFound('Section not found');

  const clashes = validatePlacement(
    {
      sectionId: input.sectionId,
      dayOfWeek: input.dayOfWeek,
      periodIndex: input.periodIndex,
      teacherId: section.teacherId,
      roomId: input.roomId ?? section.roomId,
    },
    existing,
    studentSections,
  );

  return { ok: clashes.length === 0, clashes };
}

/**
 * Places a section in a slot.
 *
 * "Attempting to place a section in a slot that clashes on any of the three axes is blocked
 * with a message naming the specific conflict."
 */
export async function placeSlot(actor: Actor, input: PlacementInput) {
  requireCapability(actor, 'timetable.manage');

  /*
   * A section already sitting in this slot is not a clash — `validatePlacement` treats a
   * section staying where it is as fine, which is right for a move and wrong for a create.
   * Without this check the clash test passes and the insert then trips the unique
   * constraint, turning a clear conflict into a 500.
   */
  const duplicate = await prisma.timetableSlot.findFirst({
    where: {
      sectionId: input.sectionId,
      dayOfWeek: input.dayOfWeek,
      periodIndex: input.periodIndex,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw ApiError.conflict(
      'slotAlreadyPlaced',
      'That section is already timetabled in this period.',
    );
  }

  const check = await checkPlacement(actor, input);
  if (!check.ok) {
    throw ApiError.conflict(
      'timetableClash',
      // The first clash carries the specific conflict; the rest ride along in `fields`.
      check.clashes[0]?.message ?? 'That slot clashes.',
    );
  }

  const academicYearId = await currentAcademicYearId();
  const period = await prisma.period.findFirst({ where: { index: input.periodIndex } });
  if (!period) throw ApiError.badRequest('unknownPeriod', `There is no period ${input.periodIndex}.`);

  const section = await prisma.section.findFirstOrThrow({
    where: { id: input.sectionId, academicYearId },
    select: { roomId: true },
  });

  const slot = await prisma.timetableSlot.create({
    data: {
      schoolId: actor.schoolId,
      academicYearId,
      sectionId: input.sectionId,
      dayOfWeek: input.dayOfWeek,
      periodIndex: input.periodIndex,
      startTime: period.startTime,
      endTime: period.endTime,
      roomId: input.roomId ?? section.roomId,
    },
  });

  await writeAudit(actor, {
    action: 'timetable.place',
    entityType: 'TimetableSlot',
    entityId: slot.id,
    after: {
      sectionId: slot.sectionId,
      dayOfWeek: slot.dayOfWeek,
      periodIndex: slot.periodIndex,
      roomId: slot.roomId,
    },
  });

  return slot;
}

export async function moveSlot(actor: Actor, slotId: string, input: PlacementInput) {
  requireCapability(actor, 'timetable.manage');

  const existing = await prisma.timetableSlot.findFirst({
    where: { id: slotId },
    select: { id: true, sectionId: true, dayOfWeek: true, periodIndex: true, roomId: true },
  });
  if (!existing) throw ApiError.notFound('Timetable slot not found');

  const check = await checkPlacement(actor, input);
  if (!check.ok) {
    throw ApiError.conflict('timetableClash', check.clashes[0]?.message ?? 'That slot clashes.');
  }

  const period = await prisma.period.findFirst({ where: { index: input.periodIndex } });
  if (!period) throw ApiError.badRequest('unknownPeriod', `There is no period ${input.periodIndex}.`);

  const updated = await prisma.timetableSlot.update({
    where: { id: slotId },
    data: {
      dayOfWeek: input.dayOfWeek,
      periodIndex: input.periodIndex,
      startTime: period.startTime,
      endTime: period.endTime,
      ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
    },
  });

  await writeAudit(actor, {
    action: 'timetable.move',
    entityType: 'TimetableSlot',
    entityId: slotId,
    before: {
      dayOfWeek: existing.dayOfWeek,
      periodIndex: existing.periodIndex,
      roomId: existing.roomId,
    },
    after: {
      dayOfWeek: updated.dayOfWeek,
      periodIndex: updated.periodIndex,
      roomId: updated.roomId,
    },
  });

  return updated;
}

export async function removeSlot(actor: Actor, slotId: string): Promise<{ id: string }> {
  requireCapability(actor, 'timetable.manage');

  const existing = await prisma.timetableSlot.findFirst({
    where: { id: slotId },
    select: { id: true, sectionId: true, dayOfWeek: true, periodIndex: true },
  });
  if (!existing) throw ApiError.notFound('Timetable slot not found');

  await prisma.timetableSlot.delete({ where: { id: slotId } });
  await writeAudit(actor, {
    action: 'timetable.remove',
    entityType: 'TimetableSlot',
    entityId: slotId,
    before: existing,
  });

  return { id: slotId };
}

/** Whole-timetable health check, for the builder's "is this year sound?" banner. */
export async function auditTimetable(actor: Actor): Promise<{ clashes: Clash[] }> {
  requireCapability(actor, 'timetable.read');
  const academicYearId = await currentAcademicYearId();
  const [placements, studentSections] = await Promise.all([
    loadPlacements(academicYearId),
    loadStudentSections(academicYearId),
  ]);
  return { clashes: findClashes(placements, studentSections) };
}

export type TimetableEntry = {
  slotId: string;
  dayOfWeek: number;
  periodIndex: number;
  startTime: string;
  endTime: string;
  sectionId: string;
  sectionName: string;
  subjectName: string;
  subjectCode: string;
  teacherName: string | null;
  roomName: string | null;
  isCurrent: boolean;
  /** Set when a substitute is covering this slot on the requested date. */
  substituteName: string | null;
};

export type TimetableView = {
  scope: 'student' | 'staff' | 'section' | 'yearGroup';
  date: string;
  currentDayOfWeek: number;
  entries: TimetableEntry[];
};

/**
 * One read path for every timetable view — a student's, a teacher's, a section's or a whole
 * year group's — because they differ only in which sections they select.
 */
export async function getTimetable(
  actor: Actor,
  query: {
    studentId?: string;
    staffId?: string;
    sectionId?: string;
    yearGroupId?: string;
    date?: string;
  } = {},
): Promise<TimetableView> {
  requireCapability(actor, 'timetable.read');

  const settings = await getSchoolSettings();
  const now = new Date();
  const date = query.date ?? zonedDateString(now, settings.timezone);
  const academicYearId = await currentAcademicYearId();

  let scope: TimetableView['scope'] = 'student';
  let sectionFilter: { sectionId?: { in: string[] }; section?: object } = {};

  if (query.sectionId) {
    assertCanAccessSection(actor, query.sectionId);
    scope = 'section';
    sectionFilter = { sectionId: { in: [query.sectionId] } };
  } else if (query.yearGroupId) {
    // A whole year group is a planning view, not a personal one.
    if (!can(actor, 'timetable.manage') && !can(actor, 'report.school')) {
      throw ApiError.notFound('Timetable not available');
    }
    scope = 'yearGroup';
    sectionFilter = { section: { yearGroupId: query.yearGroupId } };
  } else if (query.staffId) {
    if (query.staffId !== actor.staffId && !hasRole(actor, 'ADMIN')) {
      throw ApiError.notFound('Timetable not available');
    }
    scope = 'staff';
    sectionFilter = { section: { teacherId: query.staffId } };
  } else if (query.studentId) {
    const student = await prisma.student.findFirst({
      where: { id: query.studentId },
      select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
    });
    if (!student) throw ApiError.notFound('Student not found');

    const sectionIds = student.enrolments.map((entry) => entry.sectionId);
    const isSelf = actor.studentId === query.studentId;
    const isChild = actor.childStudentIds.includes(query.studentId);
    if (!isSelf && !isChild && !hasRole(actor, 'ADMIN')) {
      throw ApiError.notFound('Timetable not available');
    }
    scope = 'student';
    sectionFilter = { sectionId: { in: sectionIds } };
  } else if (actor.studentId) {
    scope = 'student';
    sectionFilter = { sectionId: { in: [...actor.enrolledSectionIds] } };
  } else if (actor.staffId) {
    scope = 'staff';
    sectionFilter = { section: { teacherId: actor.staffId } };
  } else {
    return { scope: 'student', date, currentDayOfWeek: zonedDayOfWeek(now, settings.timezone), entries: [] };
  }

  const [slots, substitutions] = await Promise.all([
    prisma.timetableSlot.findMany({
      where: { academicYearId, ...sectionFilter },
      select: {
        id: true,
        dayOfWeek: true,
        periodIndex: true,
        startTime: true,
        endTime: true,
        sectionId: true,
        room: { select: { name: true } },
        section: {
          select: {
            name: true,
            subject: { select: { name: true, code: true } },
            teacher: { select: { user: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ dayOfWeek: 'asc' }, { periodIndex: 'asc' }],
    }),
    prisma.substitution.findMany({
      where: { date: toDateOnly(date) },
      select: { timetableSlotId: true, cover: { select: { user: { select: { name: true } } } } },
    }),
  ]);

  const substituteBySlot = new Map(
    substitutions.map((entry) => [entry.timetableSlotId, entry.cover.user.name]),
  );

  const clock = zonedTimeString(now, settings.timezone);
  const todayString = zonedDateString(now, settings.timezone);
  const currentDayOfWeek = zonedDayOfWeek(now, settings.timezone);

  return {
    scope,
    date,
    currentDayOfWeek,
    entries: slots.map((slot) => ({
      slotId: slot.id,
      dayOfWeek: slot.dayOfWeek,
      periodIndex: slot.periodIndex,
      startTime: slot.startTime,
      endTime: slot.endTime,
      sectionId: slot.sectionId,
      sectionName: slot.section.name,
      subjectName: slot.section.subject.name,
      subjectCode: slot.section.subject.code,
      teacherName: slot.section.teacher?.user.name ?? null,
      roomName: slot.room?.name ?? null,
      // "The current period highlighted live" — only meaningful when looking at today.
      isCurrent:
        date === todayString &&
        slot.dayOfWeek === currentDayOfWeek &&
        clock >= slot.startTime &&
        clock < slot.endTime,
      substituteName: substituteBySlot.get(slot.id) ?? null,
    })),
  };
}

export const substitutionSchema = z.object({
  timetableSlotId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverStaffId: z.string().uuid(),
  note: z.string().max(500).optional(),
});

/** "Substitute teacher assignment for a single day, with notification to the sections." */
export async function assignSubstitute(
  actor: Actor,
  input: z.infer<typeof substitutionSchema>,
) {
  requireCapability(actor, 'timetable.manage');

  const slot = await prisma.timetableSlot.findFirst({
    where: { id: input.timetableSlotId },
    select: {
      id: true,
      sectionId: true,
      dayOfWeek: true,
      periodIndex: true,
      section: { select: { teacherId: true } },
    },
  });
  if (!slot) throw ApiError.notFound('Timetable slot not found');

  const expectedDay = new Date(`${input.date}T00:00:00.000Z`).getUTCDay() || 7;
  if (expectedDay !== slot.dayOfWeek) {
    throw ApiError.badRequest(
      'dateDayMismatch',
      'That date is not the day of the week this period runs on.',
    );
  }

  // The cover teacher must not already be teaching in that period on that day.
  const clash = await prisma.timetableSlot.findFirst({
    where: {
      dayOfWeek: slot.dayOfWeek,
      periodIndex: slot.periodIndex,
      section: { teacherId: input.coverStaffId },
    },
    select: { section: { select: { name: true } } },
  });
  if (clash) {
    throw ApiError.conflict(
      'substituteBusy',
      `That teacher is already taking ${clash.section.name} in this period.`,
    );
  }

  const substitution = await prisma.substitution.upsert({
    where: {
      timetableSlotId_date: { timetableSlotId: slot.id, date: toDateOnly(input.date) },
    },
    create: {
      schoolId: actor.schoolId,
      timetableSlotId: slot.id,
      sectionId: slot.sectionId,
      date: toDateOnly(input.date),
      originalStaffId: slot.section.teacherId,
      coverStaffId: input.coverStaffId,
      note: input.note ?? null,
    },
    update: { coverStaffId: input.coverStaffId, note: input.note ?? null },
  });

  await writeAudit(actor, {
    action: 'timetable.substitute',
    entityType: 'TimetableSlot',
    entityId: slot.id,
    after: { date: input.date, coverStaffId: input.coverStaffId },
  });

  return substitution;
}
