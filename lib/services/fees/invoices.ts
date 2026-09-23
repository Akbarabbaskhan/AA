import { z } from 'zod';
import type { InvoiceStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessStudent, can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit, writeAuditMany } from '@/lib/services/audit';
import { dateOnly, toDateOnly } from '@/lib/utils/tz';
import {
  agingBucket,
  applyDiscounts,
  balanceOf,
  daysOverdue,
  statusFor,
  subtotalOf,
  voucherNumber,
  type AgingBucket,
  type DiscountRule,
  type LineItem,
} from './money';
import { lineItemsFor, parseHeads } from './structures';

/**
 * Invoicing.
 *
 * The rule the whole module is built around: **an invoice is never edited once a payment
 * is recorded against it.** A correction is a credit note — a new record with an approver
 * and a reason — so the history a family sees and the history the ledger shows are the
 * same history. Everything below either enforces that or makes it unnecessary.
 */

export function parseLineItems(value: Prisma.JsonValue): LineItem[] {
  if (!Array.isArray(value)) return [];
  const out: LineItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record['feeHeadId'] === 'string' &&
      typeof record['label'] === 'string' &&
      typeof record['amountPaisa'] === 'number'
    ) {
      out.push({
        feeHeadId: record['feeHeadId'],
        label: record['label'],
        amountPaisa: record['amountPaisa'],
      });
    }
  }
  return out;
}

/** The discounts in force for a student on a given date. */
export async function activeDiscounts(studentId: string, on: Date): Promise<DiscountRule[]> {
  const rows = await prisma.discount.findMany({
    where: {
      studentId,
      validFrom: { lte: on },
      OR: [{ validTo: null }, { validTo: { gte: on } }],
    },
    select: { type: true, value: true, reason: true },
  });
  return rows.map((row) => ({ type: row.type, value: row.value, reason: row.reason }));
}

export const bulkInvoiceSchema = z.object({
  academicYearId: z.string().uuid(),
  yearGroupId: z.string().uuid(),
  frequency: z.enum(['MONTHLY', 'TERMLY', 'ANNUAL', 'ONE_OFF']),
  /** What a family sees on the voucher: "September 2026", "Term 1". */
  periodLabel: z.string().min(1).max(60),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Voucher prefix, e.g. "LGS". Falls back to the school slug. */
  prefix: z.string().min(1).max(10).optional(),
});

export type BulkInvoiceResult = {
  created: number;
  /** Students who already had an invoice for this period — skipped, never duplicated. */
  skipped: number;
  totalPaisa: number;
  firstVoucher: string | null;
  lastVoucher: string | null;
};

/**
 * Raises invoices for a whole year group in one action.
 *
 * Idempotent on (student, period, frequency): running it twice because the first run
 * seemed slow must not bill a family twice. That is the single most damaging bug this
 * module could ship, so it is a uniqueness check rather than a convention.
 *
 * Voucher numbers come from one counting query inside the transaction. Two bursars
 * pressing the button at the same moment is a real scenario in an accounts office.
 */
export async function generateInvoices(actor: Actor, raw: z.infer<typeof bulkInvoiceSchema>): Promise<BulkInvoiceResult> {
  requireCapability(actor, 'fee.manage');
  const input = bulkInvoiceSchema.parse(raw);

  const issueDate = toDateOnly(input.issueDate);
  const dueDate = toDateOnly(input.dueDate);
  if (dueDate < issueDate) {
    throw ApiError.badRequest('dueBeforeIssue', 'The due date cannot be before the issue date.', {
      dueDate: ['Must be on or after the issue date.'],
    });
  }

  const structure = await prisma.feeStructure.findFirst({
    where: {
      academicYearId: input.academicYearId,
      yearGroupId: input.yearGroupId,
      frequency: input.frequency,
    },
    select: { id: true, yearGroup: { select: { name: true } } },
  });
  if (!structure) {
    throw ApiError.badRequest(
      'noStructure',
      'Set a fee structure for this year group and frequency first.',
    );
  }

  const items = await lineItemsFor(structure.id);
  const subtotal = subtotalOf(items);

  // Students currently enrolled in that year group, by their sections.
  const enrolments = await prisma.enrolment.findMany({
    where: {
      academicYearId: input.academicYearId,
      droppedAt: null,
      section: { yearGroupId: input.yearGroupId },
      student: { status: 'ACTIVE', deletedAt: null },
    },
    select: { studentId: true },
    distinct: ['studentId'],
  });
  const studentIds = enrolments.map((entry) => entry.studentId);
  if (studentIds.length === 0) {
    return { created: 0, skipped: 0, totalPaisa: 0, firstVoucher: null, lastVoucher: null };
  }

  const already = await prisma.invoice.findMany({
    where: {
      academicYearId: input.academicYearId,
      periodLabel: input.periodLabel,
      studentId: { in: studentIds },
    },
    select: { studentId: true },
  });
  const billed = new Set(already.map((invoice) => invoice.studentId));
  const targets = studentIds.filter((studentId) => !billed.has(studentId));

  if (targets.length === 0) {
    return {
      created: 0,
      skipped: studentIds.length,
      totalPaisa: 0,
      firstVoucher: null,
      lastVoucher: null,
    };
  }

  const school = await prisma.school.findFirstOrThrow({ select: { slug: true } });
  const prefix = (input.prefix ?? school.slug.slice(0, 6)).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const year = issueDate.getUTCFullYear();

  // Discounts, in one query rather than one per student.
  const discountRows = await prisma.discount.findMany({
    where: {
      studentId: { in: targets },
      validFrom: { lte: issueDate },
      OR: [{ validTo: null }, { validTo: { gte: issueDate } }],
    },
    select: { studentId: true, type: true, value: true, reason: true },
  });
  const discountsByStudent = new Map<string, DiscountRule[]>();
  for (const row of discountRows) {
    discountsByStudent.set(row.studentId, [
      ...(discountsByStudent.get(row.studentId) ?? []),
      { type: row.type, value: row.value, reason: row.reason },
    ]);
  }

  const result = await prisma.$transaction(async (tx) => {
    // The next number, read inside the transaction so two bursars cannot collide.
    const highest = await tx.invoice.findFirst({
      where: { voucherNumber: { startsWith: `${prefix}-${year}-` } },
      orderBy: { voucherNumber: 'desc' },
      select: { voucherNumber: true },
    });
    const lastSequence = highest
      ? Number(highest.voucherNumber.slice(`${prefix}-${year}-`.length)) || 0
      : 0;

    const rows: Prisma.InvoiceCreateManyInput[] = [];
    let totalPaisa = 0;

    targets.forEach((studentId, index) => {
      const discounts = discountsByStudent.get(studentId) ?? [];
      const { discountPaisa, totalPaisa: total } = applyDiscounts(subtotal, discounts);
      totalPaisa += total;

      rows.push({
        schoolId: actor.schoolId,
        academicYearId: input.academicYearId,
        studentId,
        periodLabel: input.periodLabel,
        issueDate,
        dueDate,
        lineItemsJson: items,
        total,
        discount: discountPaisa,
        status: total === 0 ? 'WAIVED' : 'UNPAID',
        voucherNumber: voucherNumber(prefix, year, lastSequence + index + 1),
      });
    });

    await tx.invoice.createMany({ data: rows });

    return {
      created: rows.length,
      totalPaisa,
      firstVoucher: rows[0]?.voucherNumber ?? null,
      lastVoucher: rows.at(-1)?.voucherNumber ?? null,
    };
  });

  const created = await prisma.invoice.findMany({
    where: { periodLabel: input.periodLabel, studentId: { in: targets } },
    select: { id: true, voucherNumber: true, total: true, studentId: true },
  });
  await writeAuditMany(
    actor,
    created.map((invoice) => ({
      action: 'invoice.create',
      entityType: 'Invoice' as const,
      entityId: invoice.id,
      after: {
        voucherNumber: invoice.voucherNumber,
        total: invoice.total,
        studentId: invoice.studentId,
        periodLabel: input.periodLabel,
      },
    })),
  );

  return { ...result, skipped: billed.size };
}

export type InvoiceRow = {
  id: string;
  voucherNumber: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  yearGroupName: string | null;
  periodLabel: string;
  issueDate: string;
  dueDate: string;
  total: number;
  discount: number;
  paid: number;
  credited: number;
  outstanding: number;
  status: InvoiceStatus;
  bucket: AgingBucket;
  daysOverdue: number;
};

export const invoiceQuerySchema = z.object({
  studentId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  periodLabel: z.string().max(60).optional(),
  status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'WAIVED']).optional(),
  bucket: z.enum(['CURRENT', '0-30', '31-60', '61-90', '90+']).optional(),
  search: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Lists invoices.
 *
 * Status and aging are computed from the balance and the clock rather than read from the
 * stored column, so an invoice that fell overdue at midnight is overdue at 9am without a
 * nightly job having had to run successfully.
 */
export async function listInvoices(
  actor: Actor,
  query: z.infer<typeof invoiceQuerySchema>,
): Promise<InvoiceRow[]> {
  const scope = await invoiceScope(actor, query.studentId);

  const rows = await prisma.invoice.findMany({
    where: {
      ...scope,
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.periodLabel ? { periodLabel: query.periodLabel } : {}),
      ...(query.yearGroupId
        ? { student: { enrolments: { some: { section: { yearGroupId: query.yearGroupId } } } } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { voucherNumber: { contains: query.search, mode: 'insensitive' as const } },
              { student: { rollNumber: { contains: query.search, mode: 'insensitive' as const } } },
              { student: { user: { name: { contains: query.search, mode: 'insensitive' as const } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ dueDate: 'desc' }, { voucherNumber: 'asc' }],
    take: query.limit,
    select: {
      id: true,
      voucherNumber: true,
      studentId: true,
      periodLabel: true,
      issueDate: true,
      dueDate: true,
      total: true,
      discount: true,
      status: true,
      student: {
        select: {
          rollNumber: true,
          user: { select: { name: true } },
          enrolments: {
            where: { droppedAt: null },
            take: 1,
            select: { section: { select: { yearGroup: { select: { name: true } } } } },
          },
        },
      },
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });

  const now = new Date();
  const mapped = rows.map((row): InvoiceRow => {
    const balance = balanceOf(row.total, row.payments, row.creditNotes);
    return {
      id: row.id,
      voucherNumber: row.voucherNumber,
      studentId: row.studentId,
      studentName: row.student.user.name,
      rollNumber: row.student.rollNumber,
      yearGroupName: row.student.enrolments[0]?.section.yearGroup.name ?? null,
      periodLabel: row.periodLabel,
      issueDate: dateOnly(row.issueDate),
      dueDate: dateOnly(row.dueDate),
      total: row.total,
      discount: row.discount,
      paid: balance.paid,
      credited: balance.credited,
      outstanding: balance.outstanding,
      status: statusFor(balance, row.dueDate, now, { isWaived: row.status === 'WAIVED' }),
      bucket: balance.outstanding === 0 ? 'CURRENT' : agingBucket(row.dueDate, now),
      daysOverdue: balance.outstanding === 0 ? 0 : daysOverdue(row.dueDate, now),
    };
  });

  // Status and bucket are derived, so they are filtered after the query rather than in it.
  return mapped.filter(
    (row) =>
      (!query.status || row.status === query.status) && (!query.bucket || row.bucket === query.bucket),
  );
}

/**
 * The tenant-safe row filter for whoever is asking.
 *
 * A student sees their own invoices, a parent sees their children's, the bursar sees the
 * school's. The scope is a query predicate rather than a filter over results, so it holds
 * on a list endpoint and on every page of it.
 */
async function invoiceScope(actor: Actor, studentId?: string): Promise<Prisma.InvoiceWhereInput> {
  if (studentId) {
    const student = await prisma.student.findFirst({
      where: { id: studentId },
      select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
    });
    if (!student) throw ApiError.notFound('Student not found');
    assertCanAccessStudent(actor, studentId, student.enrolments.map((entry) => entry.sectionId));
    return { studentId };
  }

  if (can(actor, 'fee.read.school')) return {};
  if (can(actor, 'fee.read.children') && actor.childStudentIds.length > 0) {
    return { studentId: { in: [...actor.childStudentIds] } };
  }
  if (can(actor, 'fee.read.own') && actor.studentId) return { studentId: actor.studentId };
  throw ApiError.notFound('No invoices');
}

export type InvoiceDetail = InvoiceRow & {
  lineItems: LineItem[];
  payments: {
    id: string;
    amount: number;
    method: string;
    reference: string | null;
    paidAt: string;
  }[];
  creditNotes: { id: string; amount: number; reason: string; createdAt: string }[];
  /** True once anything has been recorded against it — the point of no edits. */
  isLocked: boolean;
};

export async function getInvoice(actor: Actor, invoiceId: string): Promise<InvoiceDetail> {
  const row = await prisma.invoice.findFirst({
    where: { id: invoiceId },
    select: {
      id: true,
      voucherNumber: true,
      studentId: true,
      periodLabel: true,
      issueDate: true,
      dueDate: true,
      total: true,
      discount: true,
      status: true,
      lineItemsJson: true,
      student: {
        select: {
          rollNumber: true,
          user: { select: { name: true } },
          enrolments: {
            where: { droppedAt: null },
            take: 1,
            select: { section: { select: { yearGroup: { select: { name: true } } } } },
          },
        },
      },
      payments: {
        orderBy: { paidAt: 'desc' },
        select: { id: true, amount: true, method: true, reference: true, paidAt: true },
      },
      creditNotes: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, amount: true, reason: true, createdAt: true },
      },
    },
  });
  if (!row) throw ApiError.notFound('Invoice not found');

  // Authorised against this invoice's own student, not against a page of the list.
  const student = await prisma.student.findFirst({
    where: { id: row.studentId },
    select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
  });
  if (!student) throw ApiError.notFound('Invoice not found');
  if (!can(actor, 'fee.read.school')) {
    assertCanAccessStudent(actor, row.studentId, student.enrolments.map((entry) => entry.sectionId));
  }

  const now = new Date();
  const balance = balanceOf(row.total, row.payments, row.creditNotes);

  return {
    id: row.id,
    voucherNumber: row.voucherNumber,
    studentId: row.studentId,
    studentName: row.student.user.name,
    rollNumber: row.student.rollNumber,
    yearGroupName: row.student.enrolments[0]?.section.yearGroup.name ?? null,
    periodLabel: row.periodLabel,
    issueDate: dateOnly(row.issueDate),
    dueDate: dateOnly(row.dueDate),
    total: row.total,
    discount: row.discount,
    paid: balance.paid,
    credited: balance.credited,
    outstanding: balance.outstanding,
    status: statusFor(balance, row.dueDate, now, { isWaived: row.status === 'WAIVED' }),
    bucket: balance.outstanding === 0 ? 'CURRENT' : agingBucket(row.dueDate, now),
    daysOverdue: balance.outstanding === 0 ? 0 : daysOverdue(row.dueDate, now),
    lineItems: parseLineItems(row.lineItemsJson),
    payments: row.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt.toISOString(),
    })),
    creditNotes: row.creditNotes.map((note) => ({
      id: note.id,
      amount: note.amount,
      reason: note.reason,
      createdAt: note.createdAt.toISOString(),
    })),
    isLocked: row.payments.length > 0 || row.creditNotes.length > 0,
  };
}

export const creditNoteSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().int().min(1),
  reason: z.string().min(3).max(500),
});

/**
 * The correction mechanism.
 *
 * Because an invoice is immutable once money has moved, every "we billed them wrong" is a
 * credit note: an amount, a reason and an approver, on the record for good. A school that
 * wants a mistake to vanish is asking for exactly the thing an auditor looks for.
 */
export async function issueCreditNote(
  actor: Actor,
  raw: z.infer<typeof creditNoteSchema>,
): Promise<{ id: string; outstanding: number }> {
  requireCapability(actor, 'fee.manage');
  const input = creditNoteSchema.parse(raw);

  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId },
    select: {
      id: true,
      total: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const before = balanceOf(invoice.total, invoice.payments, invoice.creditNotes);
  if (input.amount > before.outstanding) {
    throw ApiError.badRequest(
      'aboveOutstanding',
      `Only ${before.outstanding / 100} rupees are outstanding on this invoice.`,
      { amount: ['More than the outstanding balance.'] },
    );
  }

  const note = await prisma.creditNote.create({
    data: {
      schoolId: actor.schoolId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      reason: input.reason,
      approvedById: actor.userId,
    },
    select: { id: true },
  });

  const after = balanceOf(invoice.total, invoice.payments, [
    ...invoice.creditNotes,
    { amount: input.amount },
  ]);
  await syncStatus(input.invoiceId);

  await writeAudit(actor, {
    action: 'creditnote.issue',
    entityType: 'CreditNote',
    entityId: note.id,
    after: { invoiceId: input.invoiceId, amount: input.amount },
    reason: input.reason,
  });

  return { id: note.id, outstanding: after.outstanding };
}

/**
 * Writes the stored status back after money moves.
 *
 * Reads compute status from the balance, so this is for the bursar's filters and for
 * anything querying the column directly. OVERDUE is deliberately not written here: it is a
 * function of today's date, and a stale stored value is worse than no value.
 */
export async function syncStatus(invoiceId: string): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId },
    select: {
      id: true,
      total: true,
      status: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });
  if (!invoice || invoice.status === 'WAIVED') return;

  const balance = balanceOf(invoice.total, invoice.payments, invoice.creditNotes);
  const next: InvoiceStatus =
    balance.outstanding === 0 ? 'PAID' : balance.paid + balance.credited > 0 ? 'PARTIAL' : 'UNPAID';

  if (next !== invoice.status) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: next } });
  }
}

export { parseHeads };
