import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessStudent, can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { tally } from '@/lib/services/attendance/policy';
import { balanceOf, daysOverdue } from '@/lib/services/fees/money';
import { checkFeeGate } from '@/lib/services/fees/reports';
import { notify } from '@/lib/services/notifications/notify';
import { dateOnly, toDateOnly } from '@/lib/utils/tz';

/**
 * The parent portal.
 *
 * "Parents drive renewals more than students do. Keep it simple and make it work in Urdu."
 *
 * The scope discipline is the whole design: a parent sees exactly their own children, and
 * everything here derives the student id from `actor.childStudentIds` rather than trusting
 * one off the wire. A parent has **no write access to anything academic** — the only
 * things they can create are a leave request, a meeting booking, and a reply to an
 * announcement the school opened for replies.
 */

export type Child = {
  id: string;
  name: string;
  rollNumber: string;
  yearGroupName: string | null;
  photoUrl: string | null;
  isPrimaryGuardian: boolean;
};

/** The child switcher. One login, several children, in a fixed order. */
export async function getChildren(actor: Actor): Promise<Child[]> {
  if (actor.childStudentIds.length === 0) return [];

  const links = await prisma.guardianStudent.findMany({
    where: {
      studentId: { in: [...actor.childStudentIds] },
      guardian: { userId: actor.userId },
    },
    select: {
      isPrimary: true,
      student: {
        select: {
          id: true,
          rollNumber: true,
          photoUrl: true,
          user: { select: { name: true } },
          enrolments: {
            where: { droppedAt: null },
            take: 1,
            select: { section: { select: { yearGroup: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  return links
    .map((link) => ({
      id: link.student.id,
      name: link.student.user.name,
      rollNumber: link.student.rollNumber,
      yearGroupName: link.student.enrolments[0]?.section.yearGroup.name ?? null,
      photoUrl: link.student.photoUrl,
      isPrimaryGuardian: link.isPrimary,
    }))
    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));
}

/** Resolves which child a request is about, refusing anything outside this parent's set. */
export function resolveChild(actor: Actor, studentId?: string): string {
  if (studentId) {
    if (!actor.childStudentIds.includes(studentId)) throw ApiError.notFound('Student not found');
    return studentId;
  }
  const first = actor.childStudentIds[0];
  if (!first) throw ApiError.notFound('No children linked to this account');
  return first;
}

export type ParentHome = {
  child: Child;
  attendance: {
    todayStatus: string | null;
    percent: number | null;
    windowDays: number;
  };
  fees: {
    outstanding: number;
    overdueDays: number;
    nextDueDate: string | null;
    voucherNumber: string | null;
    invoiceId: string | null;
  };
  latestResult: {
    seriesName: string;
    publishedAt: string;
    /** Withheld when the school's fee gate is on and this family is behind. */
    isGated: boolean;
  } | null;
  unreadAnnouncements: number;
};

/**
 * The parent home screen.
 *
 * "Today's attendance, fee status, latest result, unread announcements. Nothing else."
 * Taken literally — four facts, each of which answers a question a parent actually has at
 * 8am, and no dashboard of charts nobody asked for.
 */
export async function getParentHome(actor: Actor, studentId?: string): Promise<ParentHome> {
  requireCapability(actor, 'fee.read.children');
  const childId = resolveChild(actor, studentId);

  const children = await getChildren(actor);
  const child = children.find((entry) => entry.id === childId);
  if (!child) throw ApiError.notFound('Student not found');

  const today = new Date();
  const windowStart = new Date(today.getTime() - 30 * 86_400_000);

  const [records, todayRecord, invoices, resultCard, unread] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { studentId: childId, session: { date: { gte: toDateOnly(dateOnly(windowStart)) } } },
      select: { status: true },
    }),
    prisma.attendanceRecord.findFirst({
      where: { studentId: childId, session: { date: toDateOnly(dateOnly(today)) } },
      orderBy: { session: { periodIndex: 'desc' } },
      select: { status: true },
    }),
    prisma.invoice.findMany({
      where: { studentId: childId, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
      orderBy: { dueDate: 'asc' },
      select: {
        id: true,
        voucherNumber: true,
        dueDate: true,
        total: true,
        payments: { select: { amount: true } },
        creditNotes: { select: { amount: true } },
      },
    }),
    prisma.resultCard.findFirst({
      // Only a published card: an unpublished one is a draft the school has not released.
      where: { studentId: childId, publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      select: { publishedAt: true, examSeries: { select: { name: true } } },
    }),
    prisma.notification.count({
      where: { userId: actor.userId, channel: 'IN_APP', readAt: null, type: 'announcement.published' },
    }),
  ]);

  let outstanding = 0;
  let worstOverdue = 0;
  for (const invoice of invoices) {
    const balance = balanceOf(invoice.total, invoice.payments, invoice.creditNotes);
    outstanding += balance.outstanding;
    if (balance.outstanding > 0) {
      worstOverdue = Math.max(worstOverdue, daysOverdue(invoice.dueDate, today));
    }
  }

  const gate = await checkFeeGate(childId);
  const counts = tally(records.map((record) => record.status));
  const first = invoices[0];

  return {
    child,
    attendance: {
      todayStatus: todayRecord?.status ?? null,
      percent: counts.percent,
      windowDays: 30,
    },
    fees: {
      outstanding,
      overdueDays: worstOverdue,
      nextDueDate: first ? dateOnly(first.dueDate) : null,
      voucherNumber: first?.voucherNumber ?? null,
      invoiceId: first?.id ?? null,
    },
    latestResult: resultCard
      ? {
          seriesName: resultCard.examSeries.name,
          publishedAt: (resultCard.publishedAt ?? new Date()).toISOString(),
          isGated: gate.isBlocked,
        }
      : null,
    unreadAnnouncements: unread,
  };
}

export type ParentRemark = {
  id: string;
  type: 'MERIT' | 'DEMERIT';
  severity: number;
  body: string;
  staffName: string;
  createdAt: string;
};

/**
 * Behaviour notes a parent may read.
 *
 * Only those the staff member marked visible to parents. A teacher's private note about a
 * child is a working note, and a portal that exposes them stops teachers writing anything
 * useful — which costs the school more than the transparency gains.
 */
export async function getParentRemarks(actor: Actor, studentId?: string): Promise<ParentRemark[]> {
  requireCapability(actor, 'remark.read.children');
  const childId = resolveChild(actor, studentId);

  const notes = await prisma.behaviourNote.findMany({
    where: { studentId: childId, isVisibleToParent: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      type: true,
      severity: true,
      body: true,
      createdAt: true,
      staff: { select: { user: { select: { name: true } } } },
    },
  });

  return notes.map((note) => ({
    id: note.id,
    type: note.type,
    severity: note.severity,
    body: note.body,
    staffName: note.staff.user.name,
    createdAt: note.createdAt.toISOString(),
  }));
}

export const leaveRequestSchema = z.object({
  studentId: z.string().uuid().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(3).max(1000),
  documentUrl: z.string().max(1000).nullable().default(null),
});

/**
 * A leave application on the child's behalf.
 *
 * One of the three things a parent may write, and it is a request rather than a fact: it
 * lands as PENDING and a coordinator decides. A parent who could mark their own child's
 * absence as authorised would make the attendance percentage meaningless.
 */
export async function requestLeave(
  actor: Actor,
  raw: z.infer<typeof leaveRequestSchema>,
): Promise<{ id: string; status: string }> {
  requireCapability(actor, 'leave.request');
  const input = leaveRequestSchema.parse(raw);

  const childId = actor.studentId ?? resolveChild(actor, input.studentId);
  if (actor.studentId && input.studentId && input.studentId !== actor.studentId) {
    throw ApiError.notFound('Student not found');
  }

  const from = toDateOnly(input.fromDate);
  const to = toDateOnly(input.toDate);
  if (to < from) {
    throw ApiError.badRequest('endBeforeStart', 'The last day cannot be before the first.', {
      toDate: ['Must be on or after the first day.'],
    });
  }

  // Overlapping requests are a duplicate submission, not two separate absences.
  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      studentId: childId,
      status: { in: ['PENDING', 'APPROVED'] },
      fromDate: { lte: to },
      toDate: { gte: from },
    },
    select: { id: true },
  });
  if (overlapping) {
    throw ApiError.conflict('overlapping', 'A request already covers those dates.');
  }

  const request = await prisma.leaveRequest.create({
    data: {
      schoolId: actor.schoolId,
      studentId: childId,
      fromDate: from,
      toDate: to,
      reason: input.reason,
      documentUrl: input.documentUrl,
      status: 'PENDING',
    },
    select: { id: true, status: true },
  });

  await writeAudit(actor, {
    action: 'leave.request',
    entityType: 'LeaveRequest',
    entityId: request.id,
    after: { studentId: childId, fromDate: input.fromDate, toDate: input.toDate },
    reason: input.reason,
  });

  return request;
}

export type LeaveRow = {
  id: string;
  studentId: string;
  studentName: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: string;
  decidedAt: string | null;
  decidedBy: string | null;
};

export async function listLeaveRequests(
  actor: Actor,
  options: { studentId?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' } = {},
): Promise<LeaveRow[]> {
  const isApprover = can(actor, 'leave.approve');

  const scope = isApprover
    ? options.studentId
      ? { studentId: options.studentId }
      : {}
    : { studentId: { in: actor.studentId ? [actor.studentId] : [...actor.childStudentIds] } };

  const rows = await prisma.leaveRequest.findMany({
    where: { ...scope, ...(options.status ? { status: options.status } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      studentId: true,
      fromDate: true,
      toDate: true,
      reason: true,
      status: true,
      decidedAt: true,
      student: { select: { user: { select: { name: true } } } },
      approvedBy: { select: { user: { select: { name: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    studentName: row.student.user.name,
    fromDate: dateOnly(row.fromDate),
    toDate: dateOnly(row.toDate),
    reason: row.reason,
    status: row.status,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.approvedBy?.user.name ?? null,
  }));
}

export const leaveDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(500).optional(),
});

/** The coordinator's decision, which the parent is told about. */
export async function decideLeave(
  actor: Actor,
  requestId: string,
  raw: z.infer<typeof leaveDecisionSchema>,
): Promise<{ id: string; status: string }> {
  requireCapability(actor, 'leave.approve');
  const input = leaveDecisionSchema.parse(raw);

  const request = await prisma.leaveRequest.findFirst({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      studentId: true,
      fromDate: true,
      toDate: true,
      student: { select: { user: { select: { name: true } } } },
    },
  });
  if (!request) throw ApiError.notFound('Request not found');
  if (request.status !== 'PENDING') {
    throw ApiError.conflict('alreadyDecided', 'That request has already been decided.');
  }

  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: {
      status: input.status,
      approvedById: actor.staffId ?? null,
      decidedAt: new Date(),
    },
  });

  await writeAudit(actor, {
    action: 'leave.decide',
    entityType: 'LeaveRequest',
    entityId: requestId,
    before: { status: 'PENDING' },
    after: { status: input.status },
    ...(input.note ? { reason: input.note } : {}),
  });

  // Tell whoever asked. A decision nobody hears about is a parent ringing the office.
  const guardians = await prisma.guardianStudent.findMany({
    where: { studentId: request.studentId, receivesAlerts: true },
    select: { guardian: { select: { user: { select: { id: true, locale: true } } } } },
  });

  const name = request.student.user.name.split(/\s+/)[0] ?? request.student.user.name;
  const approved = input.status === 'APPROVED';
  for (const link of guardians) {
    const isUrdu = link.guardian.user.locale === 'ur';
    await notify(actor.schoolId, link.guardian.user.id, 'leave.decided', {
      title: isUrdu ? 'چھٹی کی درخواست' : 'Leave request',
      body: isUrdu
        ? `${name} کی چھٹی کی درخواست ${approved ? 'منظور' : 'مسترد'} کر دی گئی ہے۔`
        : `${name}'s leave request was ${approved ? 'approved' : 'declined'}.`,
      templateVariables: [name, input.status],
      link: '/leave',
    });
  }

  return { id: requestId, status: input.status };
}
