import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import {
  assertCanAccessStudent,
  can,
  hasRole,
  requireCapability,
  type Actor,
} from '@/lib/permissions';
import { writeAudit } from './audit';
import { notify } from './notifications/notify';

/**
 * Behaviour notes — merits and demerits.
 *
 * The capability has existed since M0 and the parent portal has read these since M4; this is
 * the writing end, which nothing implemented. A note is a working note by default: a teacher
 * writes what they need to remember, and only ticks "tell the family" when the family should
 * hear it. A portal that published every private note would teach teachers to write nothing
 * useful, which costs the school more than the transparency gains.
 */

export const remarkQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  type: z.enum(['MERIT', 'DEMERIT']).optional(),
  /** Only the ones the family can see, which is what a pastoral conversation needs. */
  visibleToParentOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type RemarkRow = {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  type: 'MERIT' | 'DEMERIT';
  severity: number;
  body: string;
  isVisibleToParent: boolean;
  staffName: string;
  createdAt: string;
  /** True when this actor wrote it, so the UI can say "you". */
  isMine: boolean;
};

/**
 * The notes this actor may read.
 *
 * A teacher sees the students they teach — pastoral care needs the whole child, not just
 * their own subject's notes about them. A coordinator sees the campus. A student sees their
 * own, and only the ones marked visible: a demerit a teacher has not chosen to share is not
 * withheld from the family and shown to the child.
 */
export async function listRemarks(
  actor: Actor,
  query: z.infer<typeof remarkQuerySchema>,
): Promise<RemarkRow[]> {
  const scope: Prisma.BehaviourNoteWhereInput = (() => {
    if (can(actor, 'remark.read.own') && actor.studentId) {
      return { studentId: actor.studentId, isVisibleToParent: true };
    }
    if (hasRole(actor, 'ADMIN') || can(actor, 'report.school')) return {};
    if (can(actor, 'remark.write')) {
      // The students in this teacher's sections.
      return { student: { enrolments: { some: { sectionId: { in: [...actor.sectionIds] } } } } };
    }
    if (can(actor, 'remark.read.children') && actor.childStudentIds.length > 0) {
      return { studentId: { in: [...actor.childStudentIds] }, isVisibleToParent: true };
    }
    throw ApiError.notFound('Not found');
  })();

  if (query.studentId) {
    const student = await prisma.student.findFirst({
      where: { id: query.studentId },
      select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
    });
    if (!student) throw ApiError.notFound('Student not found');
    assertCanAccessStudent(
      actor,
      query.studentId,
      student.enrolments.map((entry) => entry.sectionId),
    );
  }

  const notes = await prisma.behaviourNote.findMany({
    where: {
      ...scope,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.sectionId
        ? { student: { enrolments: { some: { sectionId: query.sectionId } } } }
        : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.visibleToParentOnly ? { isVisibleToParent: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      studentId: true,
      type: true,
      severity: true,
      body: true,
      isVisibleToParent: true,
      createdAt: true,
      staffId: true,
      student: { select: { rollNumber: true, user: { select: { name: true } } } },
      staff: { select: { user: { select: { name: true } } } },
    },
  });

  return notes.map((note) => ({
    id: note.id,
    studentId: note.studentId,
    studentName: note.student.user.name,
    rollNumber: note.student.rollNumber,
    type: note.type,
    severity: note.severity,
    body: note.body,
    isVisibleToParent: note.isVisibleToParent,
    staffName: note.staff.user.name,
    createdAt: note.createdAt.toISOString(),
    isMine: note.staffId === actor.staffId,
  }));
}

export const remarkInputSchema = z.object({
  studentId: z.string().uuid(),
  type: z.enum(['MERIT', 'DEMERIT']),
  /** 1–5. A demerit at 5 is the one a head of year needs to see. */
  severity: z.number().int().min(1).max(5).default(1),
  body: z.string().min(3).max(2_000),
  isVisibleToParent: z.boolean().default(false),
});

export async function createRemark(
  actor: Actor,
  raw: z.infer<typeof remarkInputSchema>,
): Promise<{ id: string }> {
  requireCapability(actor, 'remark.write');
  const input = remarkInputSchema.parse(raw);

  if (!actor.staffId) {
    throw ApiError.badRequest('noStaffRecord', 'Only a member of staff can write a note.');
  }

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    select: {
      id: true,
      userId: true,
      user: { select: { name: true } },
      enrolments: { where: { droppedAt: null }, select: { sectionId: true } },
      guardians: {
        where: { receivesAlerts: true },
        select: { guardian: { select: { userId: true } } },
      },
    },
  });
  if (!student) throw ApiError.notFound('Student not found');
  assertCanAccessStudent(
    actor,
    student.id,
    student.enrolments.map((entry) => entry.sectionId),
  );

  const note = await prisma.behaviourNote.create({
    data: {
      schoolId: actor.schoolId,
      studentId: student.id,
      staffId: actor.staffId,
      type: input.type,
      severity: input.severity,
      body: input.body,
      isVisibleToParent: input.isVisibleToParent,
    },
    select: { id: true },
  });

  await writeAudit(actor, {
    action: input.type === 'MERIT' ? 'remark.merit' : 'remark.demerit',
    entityType: 'BehaviourNote',
    entityId: note.id,
    after: {
      studentId: student.id,
      type: input.type,
      severity: input.severity,
      isVisibleToParent: input.isVisibleToParent,
    },
  });

  /*
   * Only a note the teacher chose to share reaches the family, and only in-app and by push.
   * Not WhatsApp: business-initiated messages need a template approved by Meta, the school's
   * approved list does not have one for behaviour, and sending outside it is how a school's
   * WhatsApp number gets restricted.
   */
  if (input.isVisibleToParent) {
    for (const link of student.guardians) {
      await notify(actor.schoolId, link.guardian.userId, 'remark.published', {
        title: input.type === 'MERIT' ? 'Merit' : 'Note from school',
        body: `${student.user.name}: ${input.body.slice(0, 160)}`,
        link: '/dashboard',
      });
    }
  }

  return note;
}
