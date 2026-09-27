import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { can, type Actor } from '@/lib/permissions';
import { ApiError } from '@/lib/api/errors';
import type { AuditableEntity } from './audit';

/**
 * The audit log as a feature rather than a table.
 *
 * "When a parent disputes a grade or an attendance record, the admin needs to answer in 30
 * seconds with who changed what and when." Thirty seconds rules out reading JSON: the search
 * has to take the words a coordinator actually has — a child's name, a date, "Chemistry" —
 * and give back rows that say what changed in English.
 *
 * Two things make that work. Entity ids are resolved to labels in batch (a mark row's id is
 * `assessmentId:studentId`, which means nothing to anybody), and a student filter is
 * translated into the set of entity ids that belong to that student, because an attendance
 * record's audit row is keyed by the record, not by the child.
 */

/** The entity types a given reader may see, by capability rather than by role name. */
const ACADEMIC_ENTITIES: readonly AuditableEntity[] = [
  'Mark',
  'BehaviourNote',
  'AttendanceRecord',
  'AttendanceSession',
  'Enrolment',
  'TimetableSlot',
  'LeaveRequest',
  'Society',
  'Event',
  'CareerItem',
  'HousePoint',
  'StudentBadge',
  'DocumentLockerItem',
  'TranscriptRequest',
  'MeetingBooking',
  'Announcement',
];

const FINANCE_ENTITIES: readonly AuditableEntity[] = [
  'Invoice',
  'Payment',
  'CreditNote',
  'FeeHead',
  'FeeStructure',
  'Discount',
];

const ADMINISTRATIVE_ENTITIES: readonly AuditableEntity[] = [
  'Student',
  'Staff',
  'UserRole',
  'ImportJob',
  'School',
];

/**
 * What this reader is allowed to see.
 *
 * The bursar holds `audit.read` and must never see a mark, so the log is filtered by the same
 * capabilities that gate the screens themselves. Otherwise the audit view becomes the way
 * around every other boundary in the app: every mark change carries the mark in `after`.
 */
export function visibleEntityTypes(actor: Actor): AuditableEntity[] {
  const allowed = new Set<AuditableEntity>();

  if (can(actor, 'marks.read.school') || can(actor, 'attendance.read.school')) {
    for (const entity of ACADEMIC_ENTITIES) allowed.add(entity);
  }
  if (can(actor, 'fee.read.school')) {
    for (const entity of FINANCE_ENTITIES) allowed.add(entity);
  }
  if (can(actor, 'user.manage') || can(actor, 'role.manage') || can(actor, 'school.settings.manage')) {
    for (const entity of ADMINISTRATIVE_ENTITIES) allowed.add(entity);
  }

  return [...allowed];
}

export const auditQuerySchema = z.object({
  /** Free text over the actor's name, email or phone. */
  actor: z.string().max(120).optional(),
  entityType: z.string().max(60).optional(),
  /** A prefix, so `marks` matches `marks.enter`, `marks.update` and `marks.moderate`. */
  action: z.string().max(60).optional(),
  /** The child a parent is asking about, by id from a link. */
  studentId: z.string().uuid().optional(),
  /** Or by name, roll number or admission number, which is what an admin is holding. */
  student: z.string().max(120).optional(),
  /** An exact entity, for following one record's whole history. */
  entityId: z.string().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Id of the last row of the previous page. */
  cursor: z.string().uuid().optional(),
});

export type AuditFieldChange = { field: string; before: string | null; after: string | null };

export type AuditRow = {
  id: string;
  at: string;
  actorName: string;
  actorEmail: string | null;
  /** Set when the action was taken while impersonating: both people are named. */
  impersonatedByName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** What the entity is, in words a coordinator recognises. */
  label: string;
  changes: AuditFieldChange[];
  reason: string | null;
  ip: string | null;
};

export type AuditPage = {
  rows: AuditRow[];
  /** Cursor for the next page, or null at the end. */
  nextCursor: string | null;
  /** The entity types this reader may filter by, for the UI's select. */
  entityTypes: string[];
  /** The distinct actions present in the reader's scope, for the UI's select. */
  actions: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function display(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return JSON.stringify(value);
}

/**
 * Before and after as a list of changed fields.
 *
 * A diff rather than two JSON blobs, because "marks: 62 → 71" is the answer and
 * `{"marksObtained":71,"isAbsent":false}` is homework.
 */
export function diffFields(before: unknown, after: unknown): AuditFieldChange[] {
  const left = asRecord(before);
  const right = asRecord(after);
  if (!left && !right) return [];

  const keys = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].sort();
  const changes: AuditFieldChange[] = [];

  for (const key of keys) {
    const from = display(left?.[key]);
    const to = display(right?.[key]);
    if (from === to) continue;
    changes.push({ field: key, before: from, after: to });
  }
  return changes;
}

/**
 * The entity ids that belong to one student.
 *
 * An audit row is keyed by the thing that changed, and for attendance and fees that is a
 * record or an invoice rather than a child — so a student filter has to be resolved into ids
 * before the log can be searched. Bounded by the date window the caller asked for, so this
 * stays a handful of ids rather than a term's worth.
 */
async function entityIdsForStudents(
  studentIds: readonly string[],
  from: Date | undefined,
  to: Date | undefined,
): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const ids = [...studentIds];
  const window = from || to ? { gte: from, lte: to } : undefined;

  const [attendance, invoices, payments, enrolments, notes, leave, requests] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { studentId: { in: ids }, ...(window ? { date: window } : {}) },
      select: { id: true },
      take: 2_000,
    }),
    prisma.invoice.findMany({ where: { studentId: { in: ids } }, select: { id: true }, take: 500 }),
    prisma.payment.findMany({
      where: { invoice: { studentId: { in: ids } } },
      select: { id: true },
      take: 500,
    }),
    prisma.enrolment.findMany({ where: { studentId: { in: ids } }, select: { id: true }, take: 200 }),
    prisma.behaviourNote.findMany({ where: { studentId: { in: ids } }, select: { id: true }, take: 500 }),
    prisma.leaveRequest.findMany({ where: { studentId: { in: ids } }, select: { id: true }, take: 200 }),
    prisma.documentRequest.findMany({
      where: { studentId: { in: ids } },
      select: { id: true },
      take: 200,
    }),
  ]);

  return [
    // The students themselves; marks carry the student's id in the audit id already.
    ...ids,
    ...attendance.map((row) => row.id),
    ...invoices.map((row) => row.id),
    ...payments.map((row) => row.id),
    ...enrolments.map((row) => row.id),
    ...notes.map((row) => row.id),
    ...leave.map((row) => row.id),
    ...requests.map((row) => row.id),
  ];
}

type Labeller = (entityType: string, entityId: string) => string;

/**
 * Human labels for a page of rows, batch-loaded per entity type.
 *
 * Per-row lookups here would be an N+1 on the one screen whose promise is "in 30 seconds".
 */
async function labelsFor(rows: { entityType: string; entityId: string }[]): Promise<Labeller> {
  const byType = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byType.get(row.entityType) ?? new Set<string>();
    set.add(row.entityId);
    byType.set(row.entityType, set);
  }

  const labels = new Map<string, string>();
  const key = (entityType: string, entityId: string) => `${entityType}:${entityId}`;

  const markIds = [...(byType.get('Mark') ?? [])];
  if (markIds.length > 0) {
    // `assessmentId:studentId`, or a series id for a publication.
    const pairs = markIds.map((id) => id.split(':'));
    const assessmentIds = [...new Set(pairs.map((parts) => parts[0]!).filter(Boolean))];
    const studentIds = [...new Set(pairs.flatMap((parts) => (parts[1] ? [parts[1]] : [])))];

    const [assessments, students, series] = await Promise.all([
      prisma.assessment.findMany({
        where: { id: { in: assessmentIds } },
        select: {
          id: true,
          title: true,
          section: { select: { subject: { select: { name: true } } } },
          examSeries: { select: { name: true } },
        },
      }),
      studentIds.length > 0
        ? prisma.student.findMany({
            where: { id: { in: studentIds } },
            select: { id: true, rollNumber: true, user: { select: { name: true } } },
          })
        : [],
      prisma.examSeries.findMany({
        where: { id: { in: assessmentIds } },
        select: { id: true, name: true },
      }),
    ]);

    const assessmentById = new Map(assessments.map((row) => [row.id, row]));
    const studentById = new Map(students.map((row) => [row.id, row]));
    const seriesById = new Map(series.map((row) => [row.id, row]));

    for (const id of markIds) {
      const [first, second] = id.split(':');
      const assessment = first ? assessmentById.get(first) : undefined;
      const student = second ? studentById.get(second) : undefined;
      const wholeSeries = first ? seriesById.get(first) : undefined;

      const what = assessment
        ? `${assessment.section.subject.name} — ${assessment.examSeries.name} (${assessment.title})`
        : (wholeSeries?.name ?? 'Marks');
      labels.set(
        key('Mark', id),
        student ? `${what} · ${student.user.name} (${student.rollNumber})` : what,
      );
    }
  }

  const attendanceIds = [...(byType.get('AttendanceRecord') ?? [])];
  if (attendanceIds.length > 0) {
    const records = await prisma.attendanceRecord.findMany({
      where: { id: { in: attendanceIds } },
      select: {
        id: true,
        date: true,
        student: { select: { rollNumber: true, user: { select: { name: true } } } },
        session: {
          select: { periodIndex: true, section: { select: { subject: { select: { name: true } } } } },
        },
      },
    });
    for (const record of records) {
      labels.set(
        key('AttendanceRecord', record.id),
        `${record.student.user.name} (${record.student.rollNumber}) · ${record.date.toISOString().slice(0, 10)} · period ${record.session.periodIndex} ${record.session.section.subject.name}`,
      );
    }
  }

  const invoiceIds = [...(byType.get('Invoice') ?? [])];
  if (invoiceIds.length > 0) {
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: {
        id: true,
        voucherNumber: true,
        periodLabel: true,
        student: { select: { rollNumber: true, user: { select: { name: true } } } },
      },
    });
    for (const invoice of invoices) {
      labels.set(
        key('Invoice', invoice.id),
        `${invoice.voucherNumber} · ${invoice.periodLabel} · ${invoice.student.user.name} (${invoice.student.rollNumber})`,
      );
    }
  }

  const paymentIds = [...(byType.get('Payment') ?? [])];
  if (paymentIds.length > 0) {
    const payments = await prisma.payment.findMany({
      where: { id: { in: paymentIds } },
      select: {
        id: true,
        amount: true,
        method: true,
        invoice: {
          select: {
            voucherNumber: true,
            student: { select: { rollNumber: true, user: { select: { name: true } } } },
          },
        },
      },
    });
    for (const payment of payments) {
      labels.set(
        key('Payment', payment.id),
        `PKR ${(payment.amount / 100).toLocaleString('en-PK')} ${payment.method} · ${payment.invoice.voucherNumber} · ${payment.invoice.student.user.name}`,
      );
    }
  }

  const studentIds = [...(byType.get('Student') ?? [])];
  if (studentIds.length > 0) {
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, rollNumber: true, user: { select: { name: true } } },
    });
    for (const student of students) {
      labels.set(key('Student', student.id), `${student.user.name} (${student.rollNumber})`);
    }
  }

  const userRoleIds = [...(byType.get('UserRole') ?? [])];
  if (userRoleIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userRoleIds } },
      select: { id: true, name: true, email: true },
    });
    for (const user of users) {
      labels.set(key('UserRole', user.id), `${user.name}${user.email ? ` (${user.email})` : ''}`);
    }
  }

  /*
   * Falls back to the raw id rather than inventing a label: an id nobody recognises is
   * honest, and a wrong label on an audit row is worse than no label.
   */
  return (entityType: string, entityId: string) =>
    labels.get(key(entityType, entityId)) ?? entityId;
}

export async function searchAuditLog(
  actor: Actor,
  query: z.infer<typeof auditQuerySchema>,
): Promise<AuditPage> {
  const allowed = visibleEntityTypes(actor);
  if (allowed.length === 0) throw ApiError.notFound('Not found');

  if (query.entityType && !allowed.includes(query.entityType as AuditableEntity)) {
    // Silently empty rather than an error: the filter is a UI select, and telling a bursar
    // "that type exists but not for you" is itself information.
    return { rows: [], nextCursor: null, entityTypes: allowed.sort(), actions: [] };
  }

  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;

  const actorIds = query.actor
    ? (
        await prisma.user.findMany({
          where: {
            OR: [
              { name: { contains: query.actor, mode: 'insensitive' } },
              { email: { contains: query.actor, mode: 'insensitive' } },
              { phone: { contains: query.actor } },
            ],
          },
          select: { id: true },
          take: 100,
        })
      ).map((row) => row.id)
    : null;

  /*
   * "Who changed my son's Chemistry mark on 14 October" arrives as a name, not a uuid, so a
   * free-text student search resolves to ids first — several of them, because two boys called
   * Ali Raza is the normal case and picking one silently would answer the wrong question.
   */
  const matchedStudents = query.student
    ? await prisma.student.findMany({
        where: {
          OR: [
            { user: { name: { contains: query.student, mode: 'insensitive' } } },
            { rollNumber: { contains: query.student, mode: 'insensitive' } },
            { admissionNumber: { contains: query.student, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 10,
      })
    : [];

  const studentIds = [
    ...(query.studentId ? [query.studentId] : []),
    ...matchedStudents.map((row) => row.id),
  ];

  const studentEntityIds =
    studentIds.length > 0 ? await entityIdsForStudents(studentIds, from, to) : null;

  // A name that matches nobody returns nothing: falling through to "every row" would answer a
  // question the admin did not ask, and look like an answer.
  if (query.student && studentIds.length === 0) {
    return { rows: [], nextCursor: null, entityTypes: allowed.sort(), actions: [] };
  }

  const where: Prisma.AuditLogWhereInput = {
    entityType: query.entityType ? query.entityType : { in: allowed },
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(actorIds ? { actorUserId: { in: actorIds } } : {}),
    ...(from || to ? { createdAt: { gte: from, lte: to } } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(studentEntityIds
      ? {
          OR: [
            { entityId: { in: studentEntityIds } },
            // A mark's audit id ends in the student's id.
            ...studentIds.map((id) => ({ entityId: { endsWith: `:${id}` } })),
          ],
        }
      : {}),
  };

  const [rows, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        beforeJson: true,
        afterJson: true,
        reason: true,
        ip: true,
        actor: { select: { name: true, email: true } },
        impersonatedByUserId: true,
      },
    }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { entityType: { in: allowed } },
      orderBy: { action: 'asc' },
      take: 200,
    }),
  ]);

  const page = rows.slice(0, query.limit);
  const label = await labelsFor(page);

  const impersonatorIds = [
    ...new Set(page.flatMap((row) => (row.impersonatedByUserId ? [row.impersonatedByUserId] : []))),
  ];
  const impersonators = impersonatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: impersonatorIds } },
        select: { id: true, name: true },
      })
    : [];
  const impersonatorById = new Map(impersonators.map((row) => [row.id, row.name]));

  return {
    rows: page.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      actorName: row.actor?.name ?? 'System',
      actorEmail: row.actor?.email ?? null,
      impersonatedByName: row.impersonatedByUserId
        ? (impersonatorById.get(row.impersonatedByUserId) ?? 'Volt staff')
        : null,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      label: label(row.entityType, row.entityId),
      changes: diffFields(row.beforeJson, row.afterJson),
      reason: row.reason,
      ip: row.ip,
    })),
    nextCursor: rows.length > query.limit ? (page[page.length - 1]?.id ?? null) : null,
    entityTypes: allowed.sort(),
    actions: actions.map((row) => row.action),
  };
}
