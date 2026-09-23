import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, assertCanAccessStudent, type Actor } from '@/lib/permissions';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { renderVouchers, type VoucherData } from '@/lib/pdf/fee-voucher';
import { dateOnly } from '@/lib/utils/tz';
import { parseLineItems } from './invoices';

/**
 * Turning invoices into printable challans.
 *
 * Bulk is the normal case: a bursar prints a year group in one go and hands the stack to
 * the class teachers. One invoice per page keeps the stack sortable by hand, which is how
 * it actually gets distributed.
 */

/** Printing more than this in one request ties up the process; the UI pages through. */
export const MAX_VOUCHERS_PER_RENDER = 250;

async function voucherDataFor(invoiceIds: readonly string[]): Promise<VoucherData[]> {
  const settings = await getSchoolSettings();
  const school = await prisma.school.findFirstOrThrow({
    select: { name: true, address: true, contactPhone: true, themeJson: true },
  });

  const theme = (school.themeJson ?? {}) as Record<string, unknown>;
  const colors = (theme['colors'] ?? {}) as Record<string, unknown>;
  const brandColour = typeof colors['brandPrimary'] === 'string' ? colors['brandPrimary'] : '#1F3A5F';

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: [...invoiceIds] } },
    orderBy: { voucherNumber: 'asc' },
    select: {
      voucherNumber: true,
      periodLabel: true,
      issueDate: true,
      dueDate: true,
      lineItemsJson: true,
      discount: true,
      total: true,
      student: {
        select: {
          rollNumber: true,
          admissionNumber: true,
          user: { select: { name: true } },
          enrolments: {
            where: { droppedAt: null },
            take: 1,
            select: { section: { select: { yearGroup: { select: { name: true } } } } },
          },
          guardians: {
            where: { isPrimary: true },
            take: 1,
            select: { guardian: { select: { user: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  return invoices.map((invoice) => ({
    school: {
      name: school.name,
      address: school.address,
      contactPhone: school.contactPhone,
      brandColour,
    },
    bank: {
      name: settings.fees.bank.name || 'Bank details not configured',
      accountTitle: settings.fees.bank.accountTitle || school.name,
      accountNumber: settings.fees.bank.accountNumber || '—',
      branch: settings.fees.bank.branch || null,
    },
    student: {
      name: invoice.student.user.name,
      rollNumber: invoice.student.rollNumber,
      admissionNumber: invoice.student.admissionNumber,
      yearGroup: invoice.student.enrolments[0]?.section.yearGroup.name ?? null,
      guardianName: invoice.student.guardians[0]?.guardian.user.name ?? null,
    },
    invoice: {
      voucherNumber: invoice.voucherNumber,
      periodLabel: invoice.periodLabel,
      issueDate: dateOnly(invoice.issueDate),
      dueDate: dateOnly(invoice.dueDate),
      lineItems: parseLineItems(invoice.lineItemsJson),
      discountPaisa: invoice.discount,
      totalPaisa: invoice.total,
      lateFeePaisa: settings.fees.lateFeePaisa > 0 ? settings.fees.lateFeePaisa : null,
    },
  }));
}

/**
 * One family's voucher.
 *
 * A parent downloading their own child's challan is the common case, so this is
 * deliberately reachable without `fee.manage` — scoped, like every other student record,
 * to whoever is entitled to that student.
 */
export async function renderInvoiceVoucher(actor: Actor, invoiceId: string): Promise<Buffer> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId },
    select: { id: true, studentId: true },
  });
  if (!invoice) throw ApiError.notFound('Invoice not found');

  if (!can(actor, 'fee.read.school')) {
    const student = await prisma.student.findFirst({
      where: { id: invoice.studentId },
      select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
    });
    if (!student) throw ApiError.notFound('Invoice not found');
    assertCanAccessStudent(actor, invoice.studentId, student.enrolments.map((entry) => entry.sectionId));
  }

  const data = await voucherDataFor([invoiceId]);
  if (data.length === 0) throw ApiError.notFound('Invoice not found');
  return renderVouchers(data);
}

/** The bursar's stack: a whole period for a year group in one PDF. */
export async function renderVoucherBatch(
  actor: Actor,
  filter: { academicYearId: string; yearGroupId?: string; periodLabel: string },
): Promise<{ pdf: Buffer; count: number }> {
  requireCapability(actor, 'fee.manage');

  const invoices = await prisma.invoice.findMany({
    where: {
      academicYearId: filter.academicYearId,
      periodLabel: filter.periodLabel,
      ...(filter.yearGroupId
        ? { student: { enrolments: { some: { section: { yearGroupId: filter.yearGroupId } } } } }
        : {}),
    },
    orderBy: { voucherNumber: 'asc' },
    take: MAX_VOUCHERS_PER_RENDER,
    select: { id: true },
  });

  if (invoices.length === 0) {
    throw ApiError.notFound('No invoices for that period');
  }

  const data = await voucherDataFor(invoices.map((invoice) => invoice.id));
  return { pdf: await renderVouchers(data), count: data.length };
}
