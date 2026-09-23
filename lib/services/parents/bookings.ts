import { z } from 'zod';
import type { BookingStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { notify } from '@/lib/services/notifications/notify';
import { resolveChild } from './index';

/**
 * Parent–teacher meeting slots.
 *
 * The admin publishes a teacher's available slots and a parent books one. Deliberately not
 * a calendar integration and not a chat: a fixed grid of slots is what a school actually
 * runs on a parents' evening, and it keeps the interaction structured — the spec is
 * explicit that free-form parent-to-teacher messaging "becomes a support nightmare".
 */

export const BOOKING_TYPES = ['PARENT_TEACHER', 'COUNSELLOR'] as const;

export const publishSlotsSchema = z.object({
  staffId: z.string().uuid(),
  type: z.enum(BOOKING_TYPES).default('PARENT_TEACHER'),
  /** A single sitting, split into equal slots. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  slotMinutes: z.number().int().min(5).max(60).default(10),
});

/**
 * Publishes a teacher's slots for a sitting.
 *
 * Idempotent on (staff, start): re-running for the same evening tops up the grid rather
 * than doubling it, because an admin who adds half an hour at the end should not have to
 * delete and rebuild what parents have already booked.
 */
export async function publishSlots(
  actor: Actor,
  raw: z.infer<typeof publishSlotsSchema>,
): Promise<{ created: number; existing: number }> {
  requireCapability(actor, 'structure.manage');
  const input = publishSlotsSchema.parse(raw);

  const start = new Date(`${input.date}T${input.startTime}:00.000Z`);
  const end = new Date(`${input.date}T${input.endTime}:00.000Z`);
  if (end <= start) {
    throw ApiError.badRequest('endBeforeStart', 'The sitting must end after it starts.', {
      endTime: ['Must be after the start time.'],
    });
  }

  const staff = await prisma.staff.findFirst({
    where: { id: input.staffId, deletedAt: null },
    select: { id: true },
  });
  if (!staff) throw ApiError.notFound('Staff member not found');

  const wanted: { startsAt: Date; endsAt: Date }[] = [];
  for (let cursor = start; cursor < end; ) {
    const slotEnd = new Date(cursor.getTime() + input.slotMinutes * 60_000);
    if (slotEnd > end) break;
    wanted.push({ startsAt: new Date(cursor), endsAt: slotEnd });
    cursor = slotEnd;
  }

  const already = await prisma.bookingSlot.findMany({
    where: { staffId: input.staffId, startsAt: { in: wanted.map((slot) => slot.startsAt) } },
    select: { startsAt: true },
  });
  const taken = new Set(already.map((slot) => slot.startsAt.getTime()));
  const fresh = wanted.filter((slot) => !taken.has(slot.startsAt.getTime()));

  if (fresh.length > 0) {
    await prisma.bookingSlot.createMany({
      data: fresh.map((slot) => ({
        schoolId: actor.schoolId,
        staffId: input.staffId,
        type: input.type,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        status: 'OPEN' as const,
      })),
    });
  }

  return { created: fresh.length, existing: taken.size };
}

export type SlotRow = {
  id: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  /** Set only for the booking this actor made — never whose slot it is otherwise. */
  isMine: boolean;
  studentName: string | null;
  note: string | null;
};

/**
 * The slots a parent can see.
 *
 * Open slots plus their own bookings. A parent must never see who booked the 4:10 — that
 * is another family's business with the school, and a list that shows it is a privacy
 * incident waiting for a screenshot.
 */
export async function listSlots(
  actor: Actor,
  options: { staffId?: string; from?: string } = {},
): Promise<SlotRow[]> {
  const isStaffView = can(actor, 'structure.manage') || Boolean(actor.staffId);
  const from = options.from ? new Date(`${options.from}T00:00:00.000Z`) : new Date();

  const rows = await prisma.bookingSlot.findMany({
    where: {
      startsAt: { gte: from },
      ...(options.staffId ? { staffId: options.staffId } : {}),
      ...(isStaffView
        ? // A teacher sees their own grid in full; an admin sees everything.
          actor.staffId && !can(actor, 'structure.manage')
          ? { staffId: actor.staffId }
          : {}
        : /*
           * A parent sees the whole grid, including slots somebody else has taken — that
           * is what tells them the sitting is filling up and which times are left. What
           * they never see is *who*: the student name and the note are nulled below for
           * anything that is not their own booking.
           */
          { status: { in: ['OPEN', 'BOOKED'] as const } }),
    },
    orderBy: { startsAt: 'asc' },
    take: 200,
    select: {
      id: true,
      staffId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      bookedByUserId: true,
      note: true,
      studentId: true,
      staff: { select: { user: { select: { name: true } } } },
    },
  });

  const studentIds = rows.flatMap((row) => (row.studentId ? [row.studentId] : []));
  const students =
    studentIds.length > 0
      ? await prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, user: { select: { name: true } } },
        })
      : [];
  const names = new Map(students.map((student) => [student.id, student.user.name]));

  return rows.map((row) => {
    const isMine = row.bookedByUserId === actor.userId;
    // A parent sees the child's name only on their own booking; staff see every booking.
    const maySeeWho = isStaffView || isMine;
    return {
      id: row.id,
      staffId: row.staffId,
      staffName: row.staff.user.name,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: row.status,
      isMine,
      studentName: maySeeWho && row.studentId ? names.get(row.studentId) ?? null : null,
      note: maySeeWho ? row.note : null,
    };
  });
}

export const bookSlotSchema = z.object({
  studentId: z.string().uuid().optional(),
  note: z.string().max(500).nullable().default(null),
});

/**
 * Books a slot.
 *
 * The race is real — two parents tap the same 4:10 at the same moment — so the claim is a
 * conditional update on `status: OPEN` rather than a read-then-write. Whoever loses gets a
 * clear "already taken" instead of a double booking the teacher discovers on the evening.
 */
export async function bookSlot(
  actor: Actor,
  slotId: string,
  raw: z.infer<typeof bookSlotSchema>,
): Promise<{ id: string; startsAt: string }> {
  const input = bookSlotSchema.parse(raw);
  const studentId = actor.studentId ?? resolveChild(actor, input.studentId);

  const slot = await prisma.bookingSlot.findFirst({
    where: { id: slotId },
    select: {
      id: true,
      status: true,
      startsAt: true,
      staffId: true,
      staff: { select: { userId: true, user: { select: { name: true, locale: true } } } },
    },
  });
  if (!slot) throw ApiError.notFound('Slot not found');
  if (slot.startsAt.getTime() < Date.now()) {
    throw ApiError.conflict('inThePast', 'That slot has already passed.');
  }

  // One booking per family per teacher per sitting: a parent holding four consecutive
  // slots is how a parents' evening runs out of time for everyone else.
  const existing = await prisma.bookingSlot.findFirst({
    where: {
      staffId: slot.staffId,
      bookedByUserId: actor.userId,
      status: 'BOOKED',
      startsAt: {
        gte: new Date(slot.startsAt.getTime() - 12 * 3_600_000),
        lte: new Date(slot.startsAt.getTime() + 12 * 3_600_000),
      },
    },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict('alreadyBooked', 'You already have a slot with this teacher.');
  }

  const claimed = await prisma.bookingSlot.updateMany({
    where: { id: slotId, status: 'OPEN' },
    data: {
      status: 'BOOKED',
      bookedByUserId: actor.userId,
      studentId,
      note: input.note,
    },
  });
  if (claimed.count === 0) {
    throw ApiError.conflict('slotTaken', 'Someone booked that slot a moment ago. Pick another.');
  }

  await writeAudit(actor, {
    action: 'meeting.book',
    entityType: 'MeetingBooking',
    entityId: slotId,
    after: { studentId, staffId: slot.staffId, startsAt: slot.startsAt.toISOString() },
  });

  // The teacher needs to know before the evening, not on it.
  await notify(actor.schoolId, slot.staff.userId, 'meeting.booked', {
    title: 'Meeting booked',
    body: `A parent booked your ${slot.startsAt.toISOString().slice(11, 16)} slot.`,
    link: '/meetings',
  });

  return { id: slotId, startsAt: slot.startsAt.toISOString() };
}

/** Releases a slot back to the pool. Only whoever booked it, and only before it starts. */
export async function cancelBooking(actor: Actor, slotId: string): Promise<{ id: string }> {
  const slot = await prisma.bookingSlot.findFirst({
    where: { id: slotId },
    select: { id: true, bookedByUserId: true, startsAt: true },
  });
  if (!slot) throw ApiError.notFound('Slot not found');
  if (slot.bookedByUserId !== actor.userId && !can(actor, 'structure.manage')) {
    throw ApiError.notFound('Slot not found');
  }
  if (slot.startsAt.getTime() < Date.now()) {
    throw ApiError.conflict('inThePast', 'That slot has already passed.');
  }

  await prisma.bookingSlot.update({
    where: { id: slotId },
    data: { status: 'OPEN', bookedByUserId: null, studentId: null, note: null },
  });

  await writeAudit(actor, {
    action: 'meeting.cancel',
    entityType: 'MeetingBooking',
    entityId: slotId,
    before: { bookedByUserId: slot.bookedByUserId },
  });

  return { id: slotId };
}
