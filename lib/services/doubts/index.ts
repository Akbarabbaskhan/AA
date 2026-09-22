import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, type Actor } from '@/lib/permissions';

/**
 * Doubt threads — ask a question about a subject, or about a specific resource.
 *
 * Deliberately not a chat. A thread has one asker, any number of replies, and a resolved
 * flag, because the value is the archive: the same question asked by next year's cohort
 * already has an answer under the same resource.
 *
 * Threads are visible to the whole subject cohort, not just the asker. A question only one
 * student can see has to be answered thirty times.
 */

export const doubtInputSchema = z.object({
  subjectId: z.string().uuid(),
  resourceId: z.string().uuid().nullable().default(null),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
});

export async function askDoubt(
  actor: Actor,
  raw: z.infer<typeof doubtInputSchema>,
): Promise<{ id: string }> {
  requireCapability(actor, 'doubt.ask');
  const input = doubtInputSchema.parse(raw);
  if (!actor.studentId) throw ApiError.notFound('Only students open doubt threads');

  const enrolled = await prisma.enrolment.findFirst({
    where: { studentId: actor.studentId, droppedAt: null, section: { subjectId: input.subjectId } },
    select: { id: true },
  });
  if (!enrolled) throw ApiError.notFound('Subject not found');

  if (input.resourceId) {
    const resource = await prisma.resource.findFirst({
      where: { id: input.resourceId, deletedAt: null, subjectId: input.subjectId },
      select: { id: true },
    });
    if (!resource) throw ApiError.notFound('Resource not found');
  }

  const thread = await prisma.doubtThread.create({
    data: {
      schoolId: actor.schoolId,
      subjectId: input.subjectId,
      resourceId: input.resourceId,
      studentId: actor.studentId,
      title: input.title,
      body: input.body,
    },
    select: { id: true },
  });
  return thread;
}

export type DoubtSummary = {
  id: string;
  title: string;
  subjectId: string;
  subjectName: string;
  resourceId: string | null;
  resourceTitle: string | null;
  askedBy: string;
  isMine: boolean;
  isResolved: boolean;
  replyCount: number;
  createdAt: string;
  lastActivityAt: string;
};

export const doubtQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  resourceId: z.string().uuid().optional(),
  scope: z.enum(['ALL', 'UNANSWERED', 'MINE']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** The subjects an actor may see threads for: enrolled in, teaches, or heads. */
async function doubtSubjectIds(actor: Actor): Promise<string[] | 'ALL'> {
  if (can(actor, 'structure.manage')) return 'ALL';
  const sectionIds = actor.studentId ? [...actor.enrolledSectionIds] : [...actor.sectionIds];
  const sections = await prisma.section.findMany({
    where: {
      OR: [
        ...(sectionIds.length > 0 ? [{ id: { in: sectionIds } }] : []),
        ...(actor.headOfDepartmentIds.length > 0
          ? [{ subject: { departmentId: { in: [...actor.headOfDepartmentIds] } } }]
          : []),
      ],
    },
    select: { subjectId: true },
  });
  return [...new Set(sections.map((section) => section.subjectId))];
}

export async function listDoubts(
  actor: Actor,
  query: z.infer<typeof doubtQuerySchema>,
): Promise<DoubtSummary[]> {
  if (!can(actor, 'doubt.ask') && !can(actor, 'doubt.answer')) {
    throw ApiError.notFound('Not found');
  }
  const allowed = await doubtSubjectIds(actor);
  if (allowed !== 'ALL' && allowed.length === 0) return [];
  if (query.subjectId && allowed !== 'ALL' && !allowed.includes(query.subjectId)) {
    throw ApiError.notFound('Subject not found');
  }

  const rows = await prisma.doubtThread.findMany({
    where: {
      ...(query.subjectId
        ? { subjectId: query.subjectId }
        : allowed === 'ALL'
          ? {}
          : { subjectId: { in: allowed } }),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.scope === 'UNANSWERED' ? { isResolved: false, answeredAt: null } : {}),
      ...(query.scope === 'MINE' && actor.studentId ? { studentId: actor.studentId } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      title: true,
      subjectId: true,
      subject: { select: { name: true } },
      resourceId: true,
      resource: { select: { title: true } },
      studentId: true,
      student: { select: { user: { select: { name: true } } } },
      isResolved: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { replies: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    resourceId: row.resourceId,
    resourceTitle: row.resource?.title ?? null,
    askedBy: row.student.user.name,
    isMine: row.studentId === actor.studentId,
    isResolved: row.isResolved,
    replyCount: row._count.replies,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.updatedAt.toISOString(),
  }));
}

export type DoubtThreadDetail = DoubtSummary & {
  body: string;
  answeredBy: string | null;
  replies: { id: string; author: string; body: string; isStaff: boolean; createdAt: string }[];
  /** Whether this actor may mark the thread resolved. */
  canResolve: boolean;
};

/**
 * One thread.
 *
 * Authorised against the thread's own subject rather than against a page of the list. The
 * archive is the point of these threads — last year's answer is the value — so a thread
 * that has fallen off the first page of recent activity must still open.
 */
export async function getDoubt(actor: Actor, threadId: string): Promise<DoubtThreadDetail> {
  if (!can(actor, 'doubt.ask') && !can(actor, 'doubt.answer')) {
    throw ApiError.notFound('Thread not found');
  }

  const thread = await prisma.doubtThread.findFirst({
    where: { id: threadId },
    select: {
      id: true,
      title: true,
      subjectId: true,
      subject: { select: { name: true } },
      resourceId: true,
      resource: { select: { title: true } },
      studentId: true,
      student: { select: { user: { select: { name: true } } } },
      isResolved: true,
      createdAt: true,
      updatedAt: true,
      body: true,
      answeredBy: { select: { user: { select: { name: true } } } },
      replies: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, body: true, createdAt: true, authorUserId: true },
      },
    },
  });
  if (!thread) throw ApiError.notFound('Thread not found');

  const allowed = await doubtSubjectIds(actor);
  if (allowed !== 'ALL' && !allowed.includes(thread.subjectId)) {
    throw ApiError.notFound('Thread not found');
  }

  const summary: DoubtSummary = {
    id: thread.id,
    title: thread.title,
    subjectId: thread.subjectId,
    subjectName: thread.subject.name,
    resourceId: thread.resourceId,
    resourceTitle: thread.resource?.title ?? null,
    askedBy: thread.student.user.name,
    isMine: thread.studentId === actor.studentId,
    isResolved: thread.isResolved,
    replyCount: thread.replies.length,
    createdAt: thread.createdAt.toISOString(),
    lastActivityAt: thread.updatedAt.toISOString(),
  };

  const authorIds = [...new Set(thread.replies.map((reply) => reply.authorUserId))];
  const authors = await prisma.user.findMany({
    where: { id: { in: authorIds } },
    select: { id: true, name: true, roles: { select: { role: true } } },
  });
  const byId = new Map(authors.map((author) => [author.id, author]));

  return {
    ...summary,
    body: thread.body,
    answeredBy: thread.answeredBy?.user.name ?? null,
    replies: thread.replies.map((reply) => {
      const author = byId.get(reply.authorUserId);
      return {
        id: reply.id,
        author: author?.name ?? 'Unknown',
        body: reply.body,
        isStaff: (author?.roles ?? []).some((entry) => entry.role !== 'STUDENT' && entry.role !== 'PARENT'),
        createdAt: reply.createdAt.toISOString(),
      };
    }),
    canResolve: thread.studentId === actor.studentId || can(actor, 'doubt.answer'),
  };
}

export const replySchema = z.object({ body: z.string().min(1).max(10_000) });

/**
 * Adds a reply.
 *
 * A staff reply also stamps the thread as answered, which is what the "unanswered" filter
 * runs on — a teacher's queue that clears itself as they work through it.
 */
export async function replyToDoubt(
  actor: Actor,
  threadId: string,
  input: z.infer<typeof replySchema>,
): Promise<{ id: string }> {
  // Reading the thread is the access check: it throws if this actor may not see it.
  await getDoubt(actor, threadId);

  const isStaff = can(actor, 'doubt.answer') && Boolean(actor.staffId);
  const reply = await prisma.$transaction(async (tx) => {
    const created = await tx.doubtReply.create({
      data: { threadId, authorUserId: actor.userId, body: input.body },
      select: { id: true },
    });
    await tx.doubtThread.update({
      where: { id: threadId },
      data: isStaff
        ? { answeredById: actor.staffId ?? null, answeredAt: new Date() }
        : { updatedAt: new Date() },
    });
    return created;
  });
  return reply;
}

/** Only the asker or a teacher closes a thread — a classmate cannot close someone's question. */
export async function resolveDoubt(
  actor: Actor,
  threadId: string,
  isResolved: boolean,
): Promise<{ isResolved: boolean }> {
  const thread = await getDoubt(actor, threadId);
  if (!thread.canResolve) throw ApiError.notFound('Thread not found');
  await prisma.doubtThread.update({ where: { id: threadId }, data: { isResolved } });
  return { isResolved };
}
