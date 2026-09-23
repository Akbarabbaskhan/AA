import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { balanceOf } from './money';
import { syncStatus } from './invoices';
import { notifyPaymentReceived } from '@/lib/services/notifications/triggers';

/**
 * Recording money.
 *
 * Manual first, deliberately: "Schools in Pakistan collect fees at the bank counter, and
 * the accounts office will not trust an online rail on day one." The payment method is an
 * attribute rather than a branch in the code, so adding a gateway later is a new enum
 * value and a webhook, not a second payment path with its own bugs.
 */

export const PAYMENT_METHODS = ['CASH', 'BANK', 'JAZZCASH', 'EASYPAISA', 'CARD', 'CHEQUE'] as const;

export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().int().min(1),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().max(120).nullable().default(null),
  paidAt: z.coerce.date().optional(),
});

export type PaymentResult = {
  id: string;
  outstanding: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  /** Set when the family has paid more than the invoice — the bursar must see it, not find it. */
  overpaidBy: number;
};

/**
 * Records a payment.
 *
 * Overpayment is allowed and reported rather than refused. A family that paid 15,000 at
 * the counter against a 12,500 voucher has done so, and a system that refuses to record it
 * forces the accounts office into a spreadsheet — which is exactly where the errors live.
 *
 * A reference is required for everything except cash: a bank transfer with no reference
 * cannot be reconciled against a statement later, and that is the reconciliation screen's
 * biggest source of unmatched rows.
 */
export async function recordPayment(actor: Actor, raw: z.infer<typeof paymentSchema>): Promise<PaymentResult> {
  requireCapability(actor, 'payment.record');
  const input = paymentSchema.parse(raw);

  if (input.method !== 'CASH' && !input.reference?.trim()) {
    throw ApiError.badRequest('referenceRequired', 'Record the transaction reference.', {
      reference: ['Required for anything other than cash.'],
    });
  }

  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId },
    select: {
      id: true,
      total: true,
      voucherNumber: true,
      status: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (invoice.status === 'WAIVED') {
    throw ApiError.conflict('waived', 'This invoice was waived. Nothing is owed on it.');
  }

  const paidAt = input.paidAt ?? new Date();
  if (paidAt.getTime() > Date.now() + 60_000) {
    throw ApiError.badRequest('futureDate', 'A payment cannot be dated in the future.', {
      paidAt: ['Not in the future.'],
    });
  }

  // A duplicated reference on the same invoice is a double-entered receipt, not a second
  // payment. This is the mistake a busy counter makes, and it is silent without this check.
  if (input.reference?.trim()) {
    const duplicate = await prisma.payment.findFirst({
      where: { invoiceId: input.invoiceId, reference: input.reference.trim() },
      select: { id: true },
    });
    if (duplicate) {
      throw ApiError.conflict(
        'duplicateReference',
        'That reference is already recorded against this voucher.',
      );
    }
  }

  const payment = await prisma.payment.create({
    data: {
      schoolId: actor.schoolId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      reference: input.reference?.trim() || null,
      paidAt,
      recordedById: actor.userId,
    },
    select: { id: true },
  });

  await syncStatus(input.invoiceId);

  const after = balanceOf(invoice.total, [...invoice.payments, { amount: input.amount }], invoice.creditNotes);

  await writeAudit(actor, {
    action: 'payment.record',
    entityType: 'Payment',
    entityId: payment.id,
    after: {
      invoiceId: input.invoiceId,
      voucherNumber: invoice.voucherNumber,
      amount: input.amount,
      method: input.method,
      reference: input.reference ?? null,
    },
  });

  /*
   * The receipt.
   *
   * Sent immediately rather than batched — a family at the counter wants proof before they
   * leave, and a receipt that arrives tomorrow morning is a phone call today. A send
   * failure never fails the payment: the money is recorded, and the attempt is in the log.
   */
  try {
    const invoiceStudent = await prisma.invoice.findFirst({
      where: { id: input.invoiceId },
      select: { studentId: true },
    });
    if (invoiceStudent) {
      await notifyPaymentReceived(actor.schoolId, invoiceStudent.studentId, {
        voucherNumber: invoice.voucherNumber,
        amountPaisa: input.amount,
        outstandingPaisa: after.outstanding,
      });
    }
  } catch {
    // Recording the money is the transaction that matters.
  }

  return {
    id: payment.id,
    outstanding: after.outstanding,
    status: after.outstanding === 0 ? 'PAID' : 'PARTIAL',
    overpaidBy: after.overpaid,
  };
}

/**
 * Reverses a payment.
 *
 * A bounced cheque is the case this exists for. The payment row is deleted rather than
 * negated because it never represented money — but the audit log keeps what it was, who
 * recorded it and who reversed it, which is the part that matters in a dispute.
 */
export const reversalSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().min(3).max(500),
});

export async function reversePayment(
  actor: Actor,
  raw: z.infer<typeof reversalSchema>,
): Promise<{ invoiceId: string; outstanding: number }> {
  requireCapability(actor, 'fee.manage');
  const input = reversalSchema.parse(raw);

  const payment = await prisma.payment.findFirst({
    where: { id: input.paymentId },
    select: {
      id: true,
      invoiceId: true,
      amount: true,
      method: true,
      reference: true,
      paidAt: true,
    },
  });
  if (!payment) throw ApiError.notFound('Payment not found');

  await prisma.payment.delete({ where: { id: payment.id } });
  await syncStatus(payment.invoiceId);

  await writeAudit(actor, {
    action: 'payment.reverse',
    entityType: 'Payment',
    entityId: payment.id,
    before: {
      invoiceId: payment.invoiceId,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      paidAt: payment.paidAt.toISOString(),
    },
    reason: input.reason,
  });

  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { id: payment.invoiceId },
    select: { total: true, payments: { select: { amount: true } }, creditNotes: { select: { amount: true } } },
  });
  return {
    invoiceId: payment.invoiceId,
    outstanding: balanceOf(invoice.total, invoice.payments, invoice.creditNotes).outstanding,
  };
}

export const discountSchema = z.object({
  studentId: z.string().uuid(),
  type: z.enum(['PERCENT', 'FIXED']),
  /** Basis points when PERCENT (1250 = 12.5%), paisa when FIXED. */
  value: z.number().int().min(1),
  reason: z.string().min(3).max(300),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
});

/**
 * Grants a discount or waiver.
 *
 * Sibling discounts, scholarships and staff-child concessions all land here, and all carry
 * an approver and a reason. A concession with nobody's name on it is the thing that turns
 * up in an audit two years later with nobody willing to own it.
 *
 * A discount applies to invoices raised while it is valid. It never reaches back and
 * rewrites an invoice already issued — that is a credit note.
 */
export async function grantDiscount(actor: Actor, raw: z.infer<typeof discountSchema>): Promise<{ id: string }> {
  requireCapability(actor, 'discount.approve');
  const input = discountSchema.parse(raw);

  if (input.type === 'PERCENT' && input.value > 10_000) {
    throw ApiError.badRequest('above100', 'A percentage discount cannot exceed 100%.', {
      value: ['At most 100%.'],
    });
  }

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    select: { id: true },
  });
  if (!student) throw ApiError.notFound('Student not found');

  const discount = await prisma.discount.create({
    data: {
      schoolId: actor.schoolId,
      studentId: input.studentId,
      type: input.type,
      value: input.value,
      reason: input.reason,
      approvedById: actor.userId,
      validFrom: new Date(`${input.validFrom}T00:00:00.000Z`),
      validTo: input.validTo ? new Date(`${input.validTo}T00:00:00.000Z`) : null,
    },
    select: { id: true },
  });

  await writeAudit(actor, {
    action: 'discount.grant',
    entityType: 'Discount',
    entityId: discount.id,
    after: {
      studentId: input.studentId,
      type: input.type,
      value: input.value,
      validFrom: input.validFrom,
      validTo: input.validTo,
    },
    reason: input.reason,
  });

  return discount;
}

export type DiscountRow = {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  reason: string;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
};

export async function listDiscounts(actor: Actor, studentId?: string): Promise<DiscountRow[]> {
  requireCapability(actor, 'fee.read.school');
  const now = new Date();

  const rows = await prisma.discount.findMany({
    where: studentId ? { studentId } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      studentId: true,
      type: true,
      value: true,
      reason: true,
      validFrom: true,
      validTo: true,
      student: { select: { rollNumber: true, user: { select: { name: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    studentId: row.studentId,
    studentName: row.student.user.name,
    rollNumber: row.student.rollNumber,
    type: row.type,
    value: row.value,
    reason: row.reason,
    validFrom: row.validFrom.toISOString().slice(0, 10),
    validTo: row.validTo?.toISOString().slice(0, 10) ?? null,
    isActive: row.validFrom <= now && (row.validTo === null || row.validTo >= now),
  }));
}
