import { z } from 'zod';
import type { RsvpStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { notify } from '@/lib/services/notifications/notify';
import { assertCanManageSociety } from '@/lib/services/societies';

/**
 * Events, with capacity and a waitlist.
 *
 * The waitlist is the whole reason this is not a boolean. A trip with forty places and
 * sixty interested students is the normal case, and a system that simply refuses the
 * forty-first leaves the organiser running the list on paper — which is what the app was
 * supposed to replace.
 *
 * So: RSVPs are ordered, the first N are GOING, the rest are WAITLIST, and a cancellation
 * promotes the next person and tells them. Position is by when they said yes, because any
 * other rule is a rule somebody has to justify.
 */

export const eventInputSchema = z
  .object({
    societyId: z.string().uuid().nullable().default(null),
    title: z.string().min(1).max(200),
    description: z.string().max(8000).nullable().default(null),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    venue: z.string().max(200).nullable().default(null),
    capacity: z.number().int().min(1).max(5000).nullable().default(null),
    rsvpRequired: z.boolean().default(false),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    path: ['endsAt'],
    message: 'An event has to end after it starts.',
  });

/**
 * `raw` is deliberately unknown here rather than the parsed shape: this is the one writer in
 * the module that has to authorise before it validates, so the route hands over the body
 * untouched instead of parsing it first and turning a 403 into a 400.
 */
export async function createEvent(actor: Actor, raw: unknown): Promise<{ id: string }> {
  /*
   * Authorised before validated, unlike the rest of this file, because which check applies
   * depends on the input: a society event is the officers' to create, a campus event needs
   * `event.manage`. So only the society is read first — enough to pick the check, and no
   * schema for a caller with no business here to map by reading validation errors. An
   * unparseable society is nobody's society, which lands on the stricter check.
   */
  const named = z.object({ societyId: z.string().uuid().nullish() }).safeParse(raw);
  const societyId = named.success ? named.data.societyId ?? null : null;

  if (societyId) {
    await assertCanManageSociety(actor, societyId);
  } else {
    requireCapability(actor, 'event.manage');
  }

  const input = eventInputSchema.parse(raw);

  const event = await prisma.event.create({
    data: {
      schoolId: actor.schoolId,
      societyId: input.societyId,
      title: input.title,
      description: input.description,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      venue: input.venue,
      capacity: input.capacity,
      rsvpRequired: input.rsvpRequired,
    },
    select: { id: true },
  });

  await writeAudit(actor, {
    action: 'event.create',
    entityType: 'Event',
    entityId: event.id,
    after: { title: input.title, startsAt: input.startsAt.toISOString(), capacity: input.capacity },
  });

  return event;
}

export type EventRow = {
  id: string;
  title: string;
  description: string | null;
  societyId: string | null;
  societyName: string | null;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  capacity: number | null;
  rsvpRequired: boolean;
  going: number;
  waitlisted: number;
  /** Places left, or null when the event is uncapped. */
  placesLeft: number | null;
  /** This actor's own answer, and where they stand if waitlisted. */
  myStatus: RsvpStatus | null;
  myWaitlistPosition: number | null;
  canManage: boolean;
};

export const eventQuerySchema = z.object({
  societyId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Only the ones this person said yes to — the "my calendar" filter. */
  mineOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listEvents(
  actor: Actor,
  query: z.infer<typeof eventQuerySchema>,
): Promise<EventRow[]> {
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date();
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;

  const events = await prisma.event.findMany({
    where: {
      ...(query.societyId ? { societyId: query.societyId } : {}),
      startsAt: { gte: from, ...(to ? { lte: to } : {}) },
      ...(query.mineOnly ? { rsvps: { some: { userId: actor.userId, status: 'GOING' } } } : {}),
    },
    orderBy: { startsAt: 'asc' },
    take: query.limit,
    select: {
      id: true,
      title: true,
      description: true,
      societyId: true,
      startsAt: true,
      endsAt: true,
      venue: true,
      capacity: true,
      rsvpRequired: true,
      society: { select: { name: true } },
      rsvps: {
        orderBy: { createdAt: 'asc' },
        select: { userId: true, status: true, createdAt: true },
      },
    },
  });

  const isOrganiser = can(actor, 'event.manage');

  return events.map((event): EventRow => {
    const going = event.rsvps.filter((rsvp) => rsvp.status === 'GOING');
    const waitlist = event.rsvps.filter((rsvp) => rsvp.status === 'WAITLIST');
    const mine = event.rsvps.find((rsvp) => rsvp.userId === actor.userId);
    const position = mine?.status === 'WAITLIST'
      ? waitlist.findIndex((rsvp) => rsvp.userId === actor.userId) + 1
      : null;

    return {
      id: event.id,
      title: event.title,
      description: event.description,
      societyId: event.societyId,
      societyName: event.society?.name ?? null,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      venue: event.venue,
      capacity: event.capacity,
      rsvpRequired: event.rsvpRequired,
      going: going.length,
      waitlisted: waitlist.length,
      placesLeft: event.capacity === null ? null : Math.max(0, event.capacity - going.length),
      myStatus: mine?.status ?? null,
      myWaitlistPosition: position,
      canManage: isOrganiser,
    };
  });
}

export type RsvpResult = {
  status: RsvpStatus;
  /** Set when they landed on the waitlist, so the UI can say "you are 4th". */
  waitlistPosition: number | null;
  placesLeft: number | null;
};

/**
 * Says yes.
 *
 * Capacity is enforced inside a transaction with the count taken there: two students
 * tapping the last place at the same moment is the ordinary case at a popular trip, and
 * a read-then-write would hand the place to both.
 */
export async function rsvp(actor: Actor, eventId: string): Promise<RsvpResult> {
  requireCapability(actor, 'event.rsvp');

  const event = await prisma.event.findFirst({
    where: { id: eventId },
    select: { id: true, title: true, capacity: true, startsAt: true },
  });
  if (!event) throw ApiError.notFound('Event not found');
  if (event.startsAt.getTime() < Date.now()) {
    throw ApiError.conflict('alreadyHappened', 'That event has already taken place.');
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.eventRSVP.findFirst({
      where: { eventId, userId: actor.userId },
      select: { id: true, status: true },
    });
    if (existing?.status === 'GOING' || existing?.status === 'WAITLIST') {
      const waitlist = await tx.eventRSVP.findMany({
        where: { eventId, status: 'WAITLIST' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      });
      const going = await tx.eventRSVP.count({ where: { eventId, status: 'GOING' } });
      return {
        status: existing.status,
        waitlistPosition:
          existing.status === 'WAITLIST'
            ? waitlist.findIndex((entry) => entry.userId === actor.userId) + 1
            : null,
        placesLeft: event.capacity === null ? null : Math.max(0, event.capacity - going),
      };
    }

    const going = await tx.eventRSVP.count({ where: { eventId, status: 'GOING' } });
    const hasRoom = event.capacity === null || going < event.capacity;
    const status: RsvpStatus = hasRoom ? 'GOING' : 'WAITLIST';

    if (existing) {
      await tx.eventRSVP.update({ where: { id: existing.id }, data: { status } });
    } else {
      await tx.eventRSVP.create({
        data: { schoolId: actor.schoolId, eventId, userId: actor.userId, status },
      });
    }

    let waitlistPosition: number | null = null;
    if (status === 'WAITLIST') {
      const waitlist = await tx.eventRSVP.findMany({
        where: { eventId, status: 'WAITLIST' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      });
      waitlistPosition = waitlist.findIndex((entry) => entry.userId === actor.userId) + 1;
    }

    return {
      status,
      waitlistPosition,
      placesLeft:
        event.capacity === null ? null : Math.max(0, event.capacity - going - (hasRoom ? 1 : 0)),
    };
  });
}

/**
 * Withdraws, and promotes whoever is next.
 *
 * The promotion is the point: a place given up has to reach the next person on the list
 * without the organiser noticing and doing it by hand, and that person has to be told —
 * a silent promotion is a place nobody turns up to claim.
 */
export async function cancelRsvp(actor: Actor, eventId: string): Promise<{ promoted: boolean }> {
  requireCapability(actor, 'event.rsvp');

  const result = await prisma.$transaction(async (tx) => {
    const mine = await tx.eventRSVP.findFirst({
      where: { eventId, userId: actor.userId },
      select: { id: true, status: true },
    });
    if (!mine) throw ApiError.notFound('You have not replied to this event');

    const wasGoing = mine.status === 'GOING';
    await tx.eventRSVP.update({ where: { id: mine.id }, data: { status: 'NOT_GOING' } });

    if (!wasGoing) return { promotedUserId: null };

    const next = await tx.eventRSVP.findFirst({
      where: { eventId, status: 'WAITLIST' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, userId: true },
    });
    if (!next) return { promotedUserId: null };

    await tx.eventRSVP.update({ where: { id: next.id }, data: { status: 'GOING' } });
    return { promotedUserId: next.userId };
  });

  if (result.promotedUserId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId },
      select: { title: true, startsAt: true },
    });
    await notify(actor.schoolId, result.promotedUserId, 'announcement.published', {
      title: 'A place has opened up',
      body: `You are off the waitlist for ${event?.title ?? 'an event'}.`,
      link: `/events`,
    });
  }

  return { promoted: result.promotedUserId !== null };
}

export type AttendeeRow = {
  userId: string;
  name: string;
  rollNumber: string | null;
  status: RsvpStatus;
  position: number | null;
};

/** The organiser's list, in the order the waitlist will be worked through. */
export async function getAttendees(actor: Actor, eventId: string): Promise<AttendeeRow[]> {
  const event = await prisma.event.findFirst({
    where: { id: eventId },
    select: { id: true, societyId: true },
  });
  if (!event) throw ApiError.notFound('Event not found');

  if (event.societyId) {
    await assertCanManageSociety(actor, event.societyId);
  } else {
    requireCapability(actor, 'event.manage');
  }

  const rsvps = await prisma.eventRSVP.findMany({
    where: { eventId, status: { in: ['GOING', 'WAITLIST'] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: {
      userId: true,
      status: true,
      user: { select: { name: true, student: { select: { rollNumber: true } } } },
    },
  });

  let position = 0;
  return rsvps.map((entry) => ({
    userId: entry.userId,
    name: entry.user.name,
    rollNumber: entry.user.student?.rollNumber ?? null,
    status: entry.status,
    position: entry.status === 'WAITLIST' ? ++position : null,
  }));
}
