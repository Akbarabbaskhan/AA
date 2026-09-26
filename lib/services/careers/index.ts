import { z } from 'zod';
import type { CareerItemType, DocumentRequestStatus, DocumentRequestType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { notify } from '@/lib/services/notifications/notify';
import { dateOnly, toDateOnly } from '@/lib/utils/tz';

/**
 * The career and university corner.
 *
 * "No ERP in this market serves this, and it is what A Level students are most anxious
 * about. It is also the feature that makes parents value the portal."
 *
 * Four things live here: a deadline tracker with reminders, scholarship listings, a resource
 * library and the alumni destinations board. Plus the transcript and recommendation-letter
 * workflow, which is the only part with a state machine — because "routed to the relevant
 * teacher and tracked to completion" is the requirement, and an untracked request is what
 * students ring the office about twice a week.
 */

export const CAREER_TYPES = ['DEADLINE', 'SCHOLARSHIP', 'RESOURCE', 'EVENT', 'ALUMNI'] as const;

export const careerItemSchema = z.object({
  type: z.enum(CAREER_TYPES),
  title: z.string().min(1).max(200),
  institution: z.string().max(200).nullable().default(null),
  body: z.string().max(8000).nullable().default(null),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  link: z.string().max(1000).nullable().default(null),
});

export type CareerRow = {
  id: string;
  type: CareerItemType;
  title: string;
  institution: string | null;
  body: string | null;
  deadline: string | null;
  link: string | null;
  /** Negative once it has passed, so the UI can grey it rather than hide it. */
  daysUntilDeadline: number | null;
};

export const careerQuerySchema = z.object({
  type: z.enum(CAREER_TYPES).optional(),
  /** Off by default: a deadline a fortnight gone is clutter, not context. */
  includePast: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * Lists the corner.
 *
 * Deadlines soonest-first, because the anxious question is always "what is next". Anything
 * without a deadline sorts after, alphabetically.
 */
export async function listCareerItems(
  actor: Actor,
  query: z.infer<typeof careerQuerySchema>,
): Promise<CareerRow[]> {
  requireCapability(actor, 'career.read');

  const today = toDateOnly(dateOnly(new Date()));
  const cutoff = new Date(today.getTime() - 14 * 86_400_000);

  const rows = await prisma.careerItem.findMany({
    where: {
      ...(query.type ? { type: query.type } : {}),
      ...(query.includePast ? {} : { OR: [{ deadline: null }, { deadline: { gte: cutoff } }] }),
    },
    orderBy: [{ deadline: 'asc' }, { title: 'asc' }],
    take: query.limit,
    select: {
      id: true,
      type: true,
      title: true,
      institution: true,
      body: true,
      deadline: true,
      link: true,
    },
  });

  const now = today.getTime();
  return rows
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      institution: row.institution,
      body: row.body,
      deadline: row.deadline ? dateOnly(row.deadline) : null,
      link: row.link,
      daysUntilDeadline: row.deadline
        ? Math.round((row.deadline.getTime() - now) / 86_400_000)
        : null,
    }))
    .sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return a.title.localeCompare(b.title);
    });
}

export async function createCareerItem(
  actor: Actor,
  raw: z.infer<typeof careerItemSchema>,
): Promise<{ id: string }> {
  requireCapability(actor, 'career.manage');
  const input = careerItemSchema.parse(raw);

  const item = await prisma.careerItem.create({
    data: {
      schoolId: actor.schoolId,
      type: input.type,
      title: input.title,
      institution: input.institution,
      body: input.body,
      deadline: input.deadline ? toDateOnly(input.deadline) : null,
      link: input.link,
    },
    select: { id: true },
  });

  await writeAudit(actor, {
    action: 'career.item.create',
    entityType: 'CareerItem',
    entityId: item.id,
    after: { type: input.type, title: input.title, deadline: input.deadline },
  });

  return item;
}

export type DeadlineReminderResult = { notified: number; items: number };

/**
 * Reminds students about deadlines that are close.
 *
 * Batched into one message naming the count, not one per deadline: a student with six
 * applications open in October would otherwise get six messages in a morning and mute the
 * lot.
 *
 * Only the leaving cohort is reminded. A first-year AS student does not need a UCAS
 * countdown, and telling them anyway is how a useful reminder becomes noise.
 */
export async function remindUpcomingDeadlines(
  actor: Actor,
  options: { withinDays?: number } = {},
): Promise<DeadlineReminderResult> {
  requireCapability(actor, 'career.manage');

  const withinDays = options.withinDays ?? 14;
  const today = toDateOnly(dateOnly(new Date()));
  const horizon = new Date(today.getTime() + withinDays * 86_400_000);

  const items = await prisma.careerItem.findMany({
    where: { type: { in: ['DEADLINE', 'SCHOLARSHIP'] }, deadline: { gte: today, lte: horizon } },
    orderBy: { deadline: 'asc' },
    select: { title: true, institution: true, deadline: true },
  });
  if (items.length === 0) return { notified: 0, items: 0 };

  // The leaving cohort: the highest year group by sequence, which is who applies.
  const leaving = await prisma.yearGroup.findFirst({
    orderBy: { order: 'desc' },
    select: { id: true },
  });
  if (!leaving) return { notified: 0, items: items.length };

  const students = await prisma.student.findMany({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      enrolments: { some: { droppedAt: null, section: { yearGroupId: leaving.id } } },
    },
    select: { userId: true },
  });

  const soonest = items[0]!;
  const label = [soonest.institution, soonest.title].filter(Boolean).join(' — ');

  for (const student of students) {
    await notify(actor.schoolId, student.userId, 'announcement.published', {
      title:
        items.length === 1
          ? `Deadline coming up: ${label}`
          : `${items.length} application deadlines in the next ${withinDays} days`,
      body: `Next: ${label} on ${dateOnly(soonest.deadline!)}.`,
      link: '/careers',
    });
  }

  return { notified: students.length, items: items.length };
}

export const DOCUMENT_REQUEST_TYPES = [
  'TRANSCRIPT',
  'RECOMMENDATION',
  'CHARACTER_CERTIFICATE',
] as const;

export const documentRequestSchema = z
  .object({
    type: z.enum(DOCUMENT_REQUEST_TYPES),
    /** The teacher a recommendation is addressed to. */
    assignedToId: z.string().uuid().nullable().default(null),
    destination: z.string().min(1).max(200),
    note: z.string().max(2000).nullable().default(null),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  })
  .refine((value) => value.type !== 'RECOMMENDATION' || value.assignedToId !== null, {
    path: ['assignedToId'],
    message: 'Choose the teacher you are asking.',
  });

export type DocumentRequestRow = {
  id: string;
  type: DocumentRequestType;
  status: DocumentRequestStatus;
  destination: string;
  note: string | null;
  deadline: string | null;
  studentId: string;
  studentName: string;
  rollNumber: string;
  assignedToName: string | null;
  declineReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** Set once fulfilled — the locker item the student can download. */
  lockerItemId: string | null;
};

function titleFor(type: DocumentRequestType): string {
  if (type === 'TRANSCRIPT') return 'Transcript';
  if (type === 'RECOMMENDATION') return 'Reference letter';
  return 'Character certificate';
}

/**
 * Asks for a transcript or a reference.
 *
 * One open request per (type, destination) per student: a student who taps twice because
 * nothing visibly happened must not put two identical letters in a teacher's queue.
 */
export async function requestDocument(
  actor: Actor,
  raw: z.infer<typeof documentRequestSchema>,
): Promise<{ id: string; status: DocumentRequestStatus }> {
  requireCapability(actor, 'transcript.request');
  if (!actor.studentId) throw ApiError.notFound('Only students request documents');
  const studentId = actor.studentId;
  const input = documentRequestSchema.parse(raw);

  if (input.assignedToId) {
    const staff = await prisma.staff.findFirst({
      where: { id: input.assignedToId, deletedAt: null },
      select: { id: true },
    });
    if (!staff) throw ApiError.notFound('Teacher not found');
  }

  const existing = await prisma.documentRequest.findFirst({
    where: {
      studentId,
      type: input.type,
      destination: input.destination,
      status: { in: ['REQUESTED', 'IN_PROGRESS'] },
    },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict('alreadyRequested', 'You already have that request open.');
  }

  const request = await prisma.documentRequest.create({
    data: {
      schoolId: actor.schoolId,
      studentId,
      type: input.type,
      assignedToId: input.assignedToId,
      destination: input.destination,
      note: input.note,
      deadline: input.deadline ? toDateOnly(input.deadline) : null,
      status: 'REQUESTED',
    },
    select: { id: true, status: true },
  });

  await writeAudit(actor, {
    action: 'document.request',
    entityType: 'TranscriptRequest',
    entityId: request.id,
    after: { type: input.type, destination: input.destination, assignedToId: input.assignedToId },
  });

  /*
   * Routed to whoever has to act. A recommendation goes to the named teacher; a transcript
   * goes to the office, so everyone who can fulfil it hears rather than it sitting in a
   * queue nobody owns.
   */
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: { user: { select: { name: true } } },
  });
  const studentName = student?.user.name ?? 'A student';

  if (input.assignedToId) {
    const staff = await prisma.staff.findFirstOrThrow({
      where: { id: input.assignedToId },
      select: { userId: true },
    });
    await notify(actor.schoolId, staff.userId, 'announcement.published', {
      title: `Reference requested by ${studentName}`,
      body: `For ${input.destination}${input.deadline ? `, needed by ${input.deadline}` : ''}.`,
      link: '/careers/requests',
    });
  } else {
    const office = await prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: 'ADMIN' } } },
      select: { id: true },
    });
    for (const user of office) {
      await notify(actor.schoolId, user.id, 'announcement.published', {
        title: `${titleFor(input.type)} requested`,
        body: `${studentName} — ${input.destination}.`,
        link: '/careers/requests',
      });
    }
  }

  return request;
}

export const requestQuerySchema = z.object({
  status: z.enum(['REQUESTED', 'IN_PROGRESS', 'READY', 'DECLINED']).optional(),
  mineOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * The request queue.
 *
 * A student sees their own; a teacher sees what is addressed to them; the office sees
 * everything. Nobody sees another student's reference request, because who a student asked
 * for a letter — and who said no — is not a matter for the rest of the year group.
 */
export async function listDocumentRequests(
  actor: Actor,
  query: z.infer<typeof requestQuerySchema>,
): Promise<DocumentRequestRow[]> {
  const isOffice = can(actor, 'document.manage');
  const isFulfiller = can(actor, 'transcript.fulfil');

  let scope: Record<string, unknown>;
  if (actor.studentId) {
    scope = { studentId: actor.studentId };
  } else if (isOffice && !query.mineOnly) {
    scope = {};
  } else if (isFulfiller && actor.staffId) {
    scope = { assignedToId: actor.staffId };
  } else {
    throw ApiError.notFound('No requests');
  }

  const rows = await prisma.documentRequest.findMany({
    where: { ...scope, ...(query.status ? { status: query.status } : {}) },
    orderBy: [{ status: 'asc' }, { deadline: 'asc' }, { createdAt: 'desc' }],
    take: query.limit,
    select: {
      id: true,
      type: true,
      status: true,
      destination: true,
      note: true,
      deadline: true,
      studentId: true,
      declineReason: true,
      createdAt: true,
      decidedAt: true,
      lockerItemId: true,
      student: { select: { rollNumber: true, user: { select: { name: true } } } },
      assignedTo: { select: { user: { select: { name: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    destination: row.destination,
    note: row.note,
    deadline: row.deadline ? dateOnly(row.deadline) : null,
    studentId: row.studentId,
    studentName: row.student.user.name,
    rollNumber: row.student.rollNumber,
    assignedToName: row.assignedTo?.user.name ?? null,
    declineReason: row.declineReason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    lockerItemId: row.lockerItemId,
  }));
}

export const decideRequestSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'READY', 'DECLINED']),
    /** Required when declining: a refusal with no reason is worse than a slow yes. */
    declineReason: z.string().max(500).nullable().default(null),
    /** Where the finished document landed, when marking it ready. */
    fileUrl: z.string().max(1000).nullable().default(null),
  })
  .refine((value) => value.status !== 'DECLINED' || Boolean(value.declineReason?.trim()), {
    path: ['declineReason'],
    message: 'Say why, so the student can ask somebody else.',
  })
  .refine((value) => value.status !== 'READY' || Boolean(value.fileUrl?.trim()), {
    path: ['fileUrl'],
    message: 'Attach the document before marking it ready.',
  });

/**
 * Moves a request along.
 *
 * Marking it READY files the document into the student's locker in the same transaction, so
 * a request can never be "ready" with nothing to download — which is the state that makes a
 * tracker worse than no tracker.
 */
export async function decideDocumentRequest(
  actor: Actor,
  requestId: string,
  raw: z.infer<typeof decideRequestSchema>,
): Promise<{ id: string; status: DocumentRequestStatus; lockerItemId: string | null }> {
  requireCapability(actor, 'transcript.fulfil');
  const input = decideRequestSchema.parse(raw);

  const request = await prisma.documentRequest.findFirst({
    where: { id: requestId },
    select: {
      id: true,
      type: true,
      status: true,
      destination: true,
      assignedToId: true,
      studentId: true,
      student: { select: { userId: true } },
    },
  });
  if (!request) throw ApiError.notFound('Request not found');

  // A teacher acts on what was addressed to them; the office acts on anything.
  const isOffice = can(actor, 'document.manage');
  if (!isOffice && request.assignedToId !== actor.staffId) {
    throw ApiError.notFound('Request not found');
  }
  if (request.status === 'READY' || request.status === 'DECLINED') {
    throw ApiError.conflict('alreadyClosed', 'That request has already been closed.');
  }

  const result = await prisma.$transaction(async (tx) => {
    let lockerItemId: string | null = null;

    if (input.status === 'READY' && input.fileUrl) {
      const item = await tx.documentLockerItem.create({
        data: {
          schoolId: actor.schoolId,
          userId: request.student.userId,
          title: `${titleFor(request.type)} — ${request.destination}`,
          type: request.type,
          fileUrl: input.fileUrl,
        },
        select: { id: true },
      });
      lockerItemId = item.id;
    }

    await tx.documentRequest.update({
      where: { id: requestId },
      data: {
        status: input.status,
        declineReason: input.status === 'DECLINED' ? input.declineReason : null,
        decidedAt: input.status === 'IN_PROGRESS' ? null : new Date(),
        lockerItemId,
      },
    });

    return { lockerItemId };
  });

  await writeAudit(actor, {
    action: `document.${input.status.toLowerCase()}`,
    entityType: 'TranscriptRequest',
    entityId: requestId,
    before: { status: request.status },
    after: { status: input.status },
    ...(input.declineReason ? { reason: input.declineReason } : {}),
  });

  // The student is told at every step, which is the whole point of tracking it.
  const messages: Record<string, { title: string; body: string }> = {
    IN_PROGRESS: {
      title: `${titleFor(request.type)} in progress`,
      body: `Your request for ${request.destination} is being worked on.`,
    },
    READY: {
      title: `${titleFor(request.type)} ready`,
      body: `Your ${titleFor(request.type).toLowerCase()} for ${request.destination} is in your document locker.`,
    },
    DECLINED: {
      title: `${titleFor(request.type)} declined`,
      body: input.declineReason ?? 'Please speak to the office.',
    },
  };
  const message = messages[input.status];
  if (message) {
    await notify(actor.schoolId, request.student.userId, 'announcement.published', {
      ...message,
      link: input.status === 'READY' ? '/documents' : '/careers/requests',
    });
  }

  return { id: requestId, status: input.status, lockerItemId: result.lockerItemId };
}
