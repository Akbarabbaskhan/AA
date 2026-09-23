import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Rng } from './random';

/**
 * The finance demo data.
 *
 * "Demo to the bursar. This is the budget holder." So the numbers have to look like a real
 * accounts office: most families paid, some paid late, a few are months behind, a handful
 * have concessions, and the aging buckets all have somebody in them. A dataset where
 * everyone has paid makes every screen in the module look empty.
 *
 * Amounts are integer paisa throughout, exactly as the running system stores them.
 */

export type FeeSeedOptions = {
  schoolId: string;
  /** Staff who take parent–teacher meetings, for the seeded sitting. */
  meetingStaffIds?: readonly string[];
  academicYearId: string;
  /** `YYYY-MM-DD` — today, as the seed sees it. */
  today: string;
  yearGroups: { id: string; name: string; studentIds: string[] }[];
  voucherPrefix: string;
  /** How many monthly billing periods of history to raise. */
  months: number;
};

export type FeeSeedResult = {
  feeHeads: number;
  structures: number;
  invoices: number;
  payments: number;
  creditNotes: number;
  discounts: number;
  billedPaisa: number;
  /** The part of `billedPaisa` whose due date has passed. */
  duePaisa: number;
  collectedPaisa: number;
  defaulters: number;
  meetingSlots: number;
};

/** Real heads from a Lahore A Level campus's voucher, in the order they print. */
const FEE_HEADS = [
  { name: 'Tuition fee', isRecurring: true, monthly: 2_500_000 },
  { name: 'Examination fee', isRecurring: false, monthly: 400_000 },
  { name: 'Laboratory charges', isRecurring: true, monthly: 300_000 },
  { name: 'Activity fund', isRecurring: true, monthly: 150_000 },
  { name: 'IT and library', isRecurring: true, monthly: 200_000 },
] as const;

/** A2 costs more than AS: more practicals, more past papers, more examination entries. */
const YEAR_GROUP_MULTIPLIER: Record<string, number> = { 'A2 Level': 1.15 };

function monthLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return date.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function shiftMonths(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  return date.toISOString().slice(0, 10);
}

export async function seedFees(
  prisma: PrismaClient,
  rng: Rng,
  options: FeeSeedOptions,
): Promise<FeeSeedResult> {
  const t0 = Date.now();
  const mark = (label: string) => {
    if (process.env['SEED_TIMING']) console.log(`    [fees] ${label} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  };

  const result: FeeSeedResult = {
    feeHeads: 0,
    structures: 0,
    invoices: 0,
    payments: 0,
    creditNotes: 0,
    discounts: 0,
    billedPaisa: 0,
    duePaisa: 0,
    collectedPaisa: 0,
    defaulters: 0,
    meetingSlots: 0,
  };

  // -------------------------------------------------------------------------
  // Heads and structures
  // -------------------------------------------------------------------------
  const headRows = FEE_HEADS.map((head) => ({
    id: randomUUID(),
    schoolId: options.schoolId,
    name: head.name,
    isRecurring: head.isRecurring,
    defaultAmount: head.monthly,
  }));
  await prisma.feeHead.createMany({ data: headRows });
  result.feeHeads = headRows.length;
  mark('heads');

  const structures: Prisma.FeeStructureCreateManyInput[] = [];
  const monthlyTotal = new Map<string, number>();

  for (const group of options.yearGroups) {
    const multiplier = YEAR_GROUP_MULTIPLIER[group.name] ?? 1;
    const heads = headRows.map((head) => ({
      feeHeadId: head.id,
      amountPaisa: Math.round(head.defaultAmount * multiplier),
    }));
    monthlyTotal.set(group.id, heads.reduce((sum, head) => sum + head.amountPaisa, 0));

    structures.push({
      schoolId: options.schoolId,
      academicYearId: options.academicYearId,
      yearGroupId: group.id,
      frequency: 'MONTHLY',
      headsJson: heads,
    });
  }
  await prisma.feeStructure.createMany({ data: structures });
  result.structures = structures.length;
  mark('structures');

  const headLabels = new Map(headRows.map((head) => [head.id, head.name]));

  // -------------------------------------------------------------------------
  // Concessions
  //
  // Around one family in twelve: siblings, a scholarship, a staff child. Enough that the
  // discount screen and the "billed after concessions" figure both have something in them.
  // -------------------------------------------------------------------------
  const allStudentIds = options.yearGroups.flatMap((group) => group.studentIds);
  const concessionHolders = rng.sample(allStudentIds, Math.round(allStudentIds.length / 12));
  const discountByStudent = new Map<string, { type: 'PERCENT' | 'FIXED'; value: number }>();

  const discountRows: Prisma.DiscountCreateManyInput[] = concessionHolders.map((studentId) => {
    const kind = rng.int(1, 3);
    const spec =
      kind === 1
        ? { type: 'PERCENT' as const, value: 1_000, reason: 'Sibling concession' }
        : kind === 2
          ? { type: 'PERCENT' as const, value: 2_500, reason: 'Merit scholarship' }
          : { type: 'FIXED' as const, value: 500_000, reason: 'Staff child concession' };

    discountByStudent.set(studentId, { type: spec.type, value: spec.value });
    return {
      schoolId: options.schoolId,
      studentId,
      type: spec.type,
      value: spec.value,
      reason: spec.reason,
      approvedById: '',
      validFrom: new Date(`${shiftMonths(options.today, -options.months)}T00:00:00.000Z`),
      validTo: null,
    };
  });

  /*
   * The approver is the bursar, because `discount.approve` is a bursar capability — a
   * concession signed off by somebody who could not have granted it is exactly the kind of
   * inconsistency an auditor pulls on.
   */
  const approver = await prisma.user.findFirst({
    where: { schoolId: options.schoolId, email: 'bursar@volt-demo.test' },
    select: { id: true },
  });
  for (const row of discountRows) row.approvedById = approver?.id ?? '';

  if (discountRows.length > 0 && approver) {
    await prisma.discount.createMany({ data: discountRows });
    result.discounts = discountRows.length;
  }

  // -------------------------------------------------------------------------
  // Invoices, month by month
  //
  // Each student gets a payment temperament that holds across the year: most families pay
  // on time every month, a few are always a fortnight late, and a small group stops paying
  // partway through. That is what puts somebody in every aging bucket without the data
  // looking randomly scattered.
  // -------------------------------------------------------------------------
  type Temperament = 'PROMPT' | 'LATE' | 'ERRATIC' | 'DEFAULTING';
  const temperament = new Map<string, Temperament>();
  for (const studentId of allStudentIds) {
    const roll = rng.next();
    /*
     * Weighted to what a fee-paying Lahore campus actually collects: around nine tenths of
     * the year's billing, with a tail that the accounts office chases every month. A
     * demo where a third of the school is in arrears makes the collection report look
     * broken rather than useful.
     */
    temperament.set(
      studentId,
      roll < 0.82 ? 'PROMPT' : roll < 0.94 ? 'LATE' : roll < 0.975 ? 'ERRATIC' : 'DEFAULTING',
    );
  }
  /** The month a defaulting family stopped paying, counted back from today. */
  const stoppedAfter = new Map<string, number>();
  for (const [studentId, kind] of temperament) {
    if (kind === 'DEFAULTING') stoppedAfter.set(studentId, rng.int(1, 4));
  }

  const invoiceRows: Prisma.InvoiceCreateManyInput[] = [];
  const paymentRows: Prisma.PaymentCreateManyInput[] = [];
  let sequence = 0;
  const year = Number(options.today.slice(0, 4));

  for (let offset = options.months - 1; offset >= 0; offset -= 1) {
    const issue = shiftMonths(options.today, -offset);
    const issueDate = new Date(`${issue}T00:00:00.000Z`);
    /*
     * Issued on the first, due on the tenth of the following month.
     *
     * Dating both in the same month makes the current invoice overdue the moment the seed
     * runs after the tenth, which would put most of the school in the chase list on day
     * one — and is not how a school bills anyway.
     */
    const dueDate = new Date(issueDate);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 1, 10);
    const label = monthLabel(issue);
    const monthsAgo = offset;

    for (const group of options.yearGroups) {
      const subtotal = monthlyTotal.get(group.id) ?? 0;
      const lineItems = headRows.map((head) => ({
        feeHeadId: head.id,
        label: headLabels.get(head.id) ?? 'Fee',
        amountPaisa: Math.round(head.defaultAmount * (YEAR_GROUP_MULTIPLIER[group.name] ?? 1)),
      }));

      for (const studentId of group.studentIds) {
        const concession = discountByStudent.get(studentId);
        const discountPaisa = concession
          ? concession.type === 'PERCENT'
            ? Math.round((subtotal * concession.value) / 10_000)
            : Math.min(concession.value, subtotal)
          : 0;
        const total = subtotal - discountPaisa;

        sequence += 1;
        const invoiceId = randomUUID();
        invoiceRows.push({
          id: invoiceId,
          schoolId: options.schoolId,
          academicYearId: options.academicYearId,
          studentId,
          periodLabel: label,
          issueDate,
          dueDate,
          lineItemsJson: lineItems,
          total,
          discount: discountPaisa,
          status: 'UNPAID',
          voucherNumber: `${options.voucherPrefix}-${year}-${String(sequence).padStart(6, '0')}`,
        });
        result.billedPaisa += total;
        // The current month is issued but not due, so it is deliberately not counted
        // towards the collection rate the banner prints.
        if (dueDate.getTime() <= new Date(`${options.today}T23:59:59.000Z`).getTime()) {
          result.duePaisa += total;
        }

        // Did this family pay this month, and when?
        const kind = temperament.get(studentId) ?? 'PROMPT';
        const stopped = stoppedAfter.get(studentId);
        const hasStopped = stopped !== undefined && monthsAgo < stopped;

        if (hasStopped) continue;
        if (kind === 'ERRATIC' && rng.bool(0.22)) continue;
        // The current month is not due yet, so most families have not paid it. Those are
        // not defaulters — they are simply inside the billing cycle.
        if (monthsAgo === 0 && rng.bool(0.6)) continue;
        // Last month has just come due; a few are still a week or two late with it.
        if (monthsAgo === 1 && rng.bool(0.08)) continue;

        // A "late" family is late by days, not by months: they pay inside the fortnight
        // after the due date, which is what a reminder run is for.
        const daysLate = kind === 'PROMPT' ? rng.int(-8, 1) : kind === 'LATE' ? rng.int(2, 14) : rng.int(0, 30);
        const paidAt = new Date(dueDate.getTime() + daysLate * 86_400_000);
        if (paidAt.getTime() > new Date(`${options.today}T23:59:59.000Z`).getTime()) continue;

        // A few families pay in two instalments, which is what exercises PARTIAL.
        const splits = rng.bool(0.06) ? 2 : 1;
        const first = splits === 2 ? Math.round(total * 0.6) : total;

        paymentRows.push({
          schoolId: options.schoolId,
          invoiceId,
          amount: first,
          method: rng.pick(['BANK', 'BANK', 'BANK', 'CASH', 'JAZZCASH', 'EASYPAISA'] as const),
          reference: `TRX${String(rng.int(100_000, 999_999))}`,
          paidAt,
        });
        result.collectedPaisa += first;

        if (splits === 2 && rng.bool(0.7)) {
          const second = total - first;
          const secondAt = new Date(paidAt.getTime() + rng.int(5, 20) * 86_400_000);
          if (secondAt.getTime() <= new Date(`${options.today}T23:59:59.000Z`).getTime()) {
            paymentRows.push({
              schoolId: options.schoolId,
              invoiceId,
              amount: second,
              method: 'BANK',
              reference: `TRX${String(rng.int(100_000, 999_999))}`,
              paidAt: secondAt,
            });
            result.collectedPaisa += second;
          }
        }
      }
    }
  }

  /*
   * Set-based inserts rather than `createMany`.
   *
   * Twelve thousand invoices and eleven thousand payments is where the seed crossed its
   * 60-second budget: Prisma's createMany sends every column of every row, and the round
   * trips dominate. One statement per batch with array parameters is roughly an order of
   * magnitude faster, which is the same fix the attendance and exam seeds needed.
   *
   * `id` and `updated_at` are supplied explicitly because Prisma generates both
   * client-side and neither column has a database default.
   */
  const FLUSH = 5_000;

  for (let index = 0; index < invoiceRows.length; index += FLUSH) {
    const batch = invoiceRows.slice(index, index + FLUSH);
    await prisma.$executeRaw`
      INSERT INTO invoices
        (id, school_id, academic_year_id, student_id, period_label, issue_date, due_date,
         line_items_json, total, discount, status, voucher_number, created_at, updated_at)
      SELECT t.id, ${options.schoolId}, ${options.academicYearId}, t.student_id,
             t.period_label, t.issue_date, t.due_date, t.line_items::jsonb,
             t.total, t.discount, 'UNPAID'::"InvoiceStatus", t.voucher_number, now(), now()
      FROM unnest(
        ${batch.map((row) => row.id as string)}::text[],
        ${batch.map((row) => row.studentId)}::text[],
        ${batch.map((row) => row.periodLabel)}::text[],
        ${batch.map((row) => row.issueDate as Date)}::date[],
        ${batch.map((row) => row.dueDate as Date)}::date[],
        ${batch.map((row) => JSON.stringify(row.lineItemsJson))}::text[],
        ${batch.map((row) => row.total)}::int[],
        ${batch.map((row) => row.discount ?? 0)}::int[],
        ${batch.map((row) => row.voucherNumber)}::text[]
      ) AS t(id, student_id, period_label, issue_date, due_date, line_items,
             total, discount, voucher_number)
    `;
  }
  result.invoices = invoiceRows.length;
  mark('invoices');

  for (let index = 0; index < paymentRows.length; index += FLUSH) {
    const batch = paymentRows.slice(index, index + FLUSH);
    await prisma.$executeRaw`
      INSERT INTO payments
        (id, school_id, invoice_id, amount, method, reference, paid_at, created_at)
      SELECT gen_random_uuid()::text, ${options.schoolId}, t.invoice_id, t.amount,
             t.method::"PaymentMethod", t.reference, t.paid_at, now()
      FROM unnest(
        ${batch.map((row) => row.invoiceId)}::text[],
        ${batch.map((row) => row.amount)}::int[],
        ${batch.map((row) => String(row.method))}::text[],
        ${batch.map((row) => row.reference ?? null)}::text[],
        ${batch.map((row) => row.paidAt as Date)}::timestamptz[]
      ) AS t(invoice_id, amount, method, reference, paid_at)
    `;
  }
  result.payments = paymentRows.length;
  mark('payments');

  // -------------------------------------------------------------------------
  // Statuses, computed in one statement rather than one query per invoice.
  // -------------------------------------------------------------------------
  await prisma.$executeRaw`
    UPDATE invoices SET status = sub.next_status
    FROM (
      SELECT i.id,
             CASE
               WHEN COALESCE(p.paid, 0) >= i.total THEN 'PAID'::"InvoiceStatus"
               WHEN COALESCE(p.paid, 0) > 0        THEN 'PARTIAL'::"InvoiceStatus"
               ELSE 'UNPAID'::"InvoiceStatus"
             END AS next_status
      FROM invoices i
      LEFT JOIN (
        SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id
      ) p ON p.invoice_id = i.id
      WHERE i.school_id = ${options.schoolId}
    ) AS sub
    WHERE invoices.id = sub.id AND invoices.status <> sub.next_status
  `;

  // -------------------------------------------------------------------------
  // A couple of credit notes, so the correction path is visible in the demo.
  // -------------------------------------------------------------------------
  if (approver) {
    const overbilled = await prisma.invoice.findMany({
      where: { schoolId: options.schoolId, status: 'UNPAID' },
      take: 6,
      select: { id: true, total: true },
    });
    const notes = overbilled.slice(0, 4).map((invoice) => ({
      schoolId: options.schoolId,
      invoiceId: invoice.id,
      amount: Math.min(invoice.total, 400_000),
      reason: 'Examination fee billed in error — corrected by credit note.',
      approvedById: approver.id,
    }));
    if (notes.length > 0) {
      await prisma.creditNote.createMany({ data: notes });
      result.creditNotes = notes.length;
    }
  }

  // Counted the way the chase list counts: past the due date, not merely unpaid. The
  // current month is issued and still being collected, and those families are not behind.
  const defaulting = await prisma.invoice.groupBy({
    by: ['studentId'],
    where: {
      schoolId: options.schoolId,
      status: { in: ['UNPAID', 'PARTIAL'] },
      dueDate: { lt: new Date(`${options.today}T00:00:00.000Z`) },
    },
  });
  result.defaulters = defaulting.length;
  mark('statuses+notes');

  // -------------------------------------------------------------------------
  // A parents' evening
  //
  // Next month, six teachers, ten-minute slots across an afternoon. Without a published
  // grid the meetings screen is empty on first open, and a booking flow nobody can try is
  // a feature the school takes on trust.
  // -------------------------------------------------------------------------
  const meetingStaff = (options.meetingStaffIds ?? []).slice(0, 6);
  if (meetingStaff.length > 0) {
    const sitting = shiftMonths(options.today, 1);
    const slots: Prisma.BookingSlotCreateManyInput[] = [];

    for (const staffId of meetingStaff) {
      // 16:00 to 18:00 local, which is 11:00 to 13:00 UTC.
      for (let minute = 0; minute < 120; minute += 10) {
        const startsAt = new Date(`${sitting}T11:00:00.000Z`);
        startsAt.setUTCMinutes(startsAt.getUTCMinutes() + minute);
        slots.push({
          schoolId: options.schoolId,
          staffId,
          type: 'PARENT_TEACHER',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 10 * 60_000),
          status: 'OPEN',
        });
      }
    }

    await prisma.bookingSlot.createMany({ data: slots });
    result.meetingSlots = slots.length;
  }

  return result;
}
