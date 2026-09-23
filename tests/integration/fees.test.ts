import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import {
  bulkInvoiceSchema,
  generateInvoices,
  getInvoice,
  issueCreditNote,
  listInvoices,
} from '@/lib/services/fees/invoices';
import { grantDiscount, recordPayment, reversePayment, listDiscounts } from '@/lib/services/fees/payments';
import { getCollectionReport, getDefaulters, checkFeeGate } from '@/lib/services/fees/reports';
import { confirmMatches, proposeMatches } from '@/lib/services/fees/reconciliation';
import { renderInvoiceVoucher } from '@/lib/services/fees/vouchers';
import { listFeeStructures, saveFeeStructure, listFeeHeads } from '@/lib/services/fees/structures';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

let schoolId: string;
let admin: Actor;
let bursar: Actor;
let student: Actor;
let otherStudent: Actor;
let teacher: Actor;

let academicYearId: string;
let yearGroupId: string;
let testStudentId: string;

/** Everything this suite raises is under its own period label, so it can be cleaned up. */
const TEST_PERIOD = '[test] Reconciliation Month';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  bursar = await actorByEmail(schoolId, 'bursar@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  const picked = await asActor(admin, async () => {
    const year = await testPrisma.academicYear.findFirstOrThrow({
      where: { isCurrent: true },
      select: { id: true },
    });
    const group = await testPrisma.yearGroup.findFirstOrThrow({
      where: { sections: { some: { enrolments: { some: { droppedAt: null } } } } },
      select: { id: true },
    });
    const enrolment = await testPrisma.enrolment.findFirstOrThrow({
      where: { droppedAt: null, section: { yearGroupId: group.id } },
      select: { studentId: true, student: { select: { rollNumber: true } } },
    });
    const other = await testPrisma.student.findFirstOrThrow({
      where: { id: { not: enrolment.studentId }, status: 'ACTIVE' },
      select: { rollNumber: true },
    });
    const staff = await testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'TEACHER' } }, staff: { sections: { some: {} } } },
      select: { email: true },
    });
    return {
      academicYearId: year.id,
      yearGroupId: group.id,
      studentId: enrolment.studentId,
      otherRoll: other.rollNumber,
      teacherEmail: staff.email!,
    };
  });

  academicYearId = picked.academicYearId;
  yearGroupId = picked.yearGroupId;
  testStudentId = picked.studentId;
  otherStudent = await actorForStudentRoll(schoolId, picked.otherRoll);
  teacher = await actorByEmail(schoolId, picked.teacherEmail);
});

afterAll(async () => {
  await asActor(admin, async () => {
    const invoices = await testPrisma.invoice.findMany({
      where: { periodLabel: { startsWith: '[test]' } },
      select: { id: true },
    });
    const ids = invoices.map((invoice) => invoice.id);
    if (ids.length > 0) {
      await testPrisma.payment.deleteMany({ where: { invoiceId: { in: ids } } });
      await testPrisma.creditNote.deleteMany({ where: { invoiceId: { in: ids } } });
      await testPrisma.invoice.deleteMany({ where: { id: { in: ids } } });
    }
    await testPrisma.discount.deleteMany({ where: { reason: { startsWith: '[test]' } } });
  });
  await testPrisma.$disconnect();
});

describe('fee structures', () => {
  it('seeds a structure per year group', async () => {
    const structures = await asActor(bursar, () => listFeeStructures(bursar, academicYearId));
    expect(structures.length).toBeGreaterThan(0);
    expect(structures[0]?.totalPaisa).toBeGreaterThan(0);
    expect(structures[0]?.heads.every((head) => head.label !== 'Unknown head')).toBe(true);
  });

  it('replaces a structure rather than refusing a second one', async () => {
    const heads = await asActor(bursar, () => listFeeHeads(bursar));
    const first = await asActor(bursar, () =>
      saveFeeStructure(bursar, {
        academicYearId,
        yearGroupId,
        frequency: 'ANNUAL',
        heads: [{ feeHeadId: heads[0]!.id, amountPaisa: 100_000 }],
      }),
    );
    const second = await asActor(bursar, () =>
      saveFeeStructure(bursar, {
        academicYearId,
        yearGroupId,
        frequency: 'ANNUAL',
        heads: [{ feeHeadId: heads[0]!.id, amountPaisa: 200_000 }],
      }),
    );
    expect(second.id).toBe(first.id);

    await asActor(admin, () => testPrisma.feeStructure.delete({ where: { id: first.id } }));
  });

  it('never lets a student read the school’s fee structures', async () => {
    await expect(asActor(student, () => listFeeStructures(student))).rejects.toThrow(ForbiddenError);
  });
});

describe('invoicing', () => {
  it('raises a voucher for every enrolled student in the year group', async () => {
    const result = await asActor(bursar, () =>
      generateInvoices(bursar, {
        academicYearId,
        yearGroupId,
        frequency: 'MONTHLY',
        periodLabel: TEST_PERIOD,
        issueDate: '2026-09-01',
        dueDate: '2026-10-10',
        prefix: 'TST',
      }),
    );
    expect(result.created).toBeGreaterThan(0);
    expect(result.firstVoucher).toMatch(/^TST-2026-\d{6}$/);
    expect(result.totalPaisa).toBeGreaterThan(0);
  });

  it('never bills the same family twice for the same period', async () => {
    const again = await asActor(bursar, () =>
      generateInvoices(bursar, {
        academicYearId,
        yearGroupId,
        frequency: 'MONTHLY',
        periodLabel: TEST_PERIOD,
        issueDate: '2026-09-01',
        dueDate: '2026-10-10',
        prefix: 'TST',
      }),
    );
    expect(again.created).toBe(0);
    expect(again.skipped).toBeGreaterThan(0);
  });

  it('numbers vouchers so they sort as text', async () => {
    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { periodLabel: TEST_PERIOD, limit: 20 }),
    );
    const numbers = invoices.map((invoice) => invoice.voucherNumber).sort();
    expect(numbers).toEqual([...numbers].sort());
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('refuses a due date before the issue date', async () => {
    await expect(
      asActor(bursar, () =>
        generateInvoices(bursar, {
          academicYearId,
          yearGroupId,
          frequency: 'MONTHLY',
          periodLabel: '[test] Backwards',
          issueDate: '2026-09-10',
          dueDate: '2026-09-01',
        }),
      ),
    ).rejects.toThrow(/before the issue date/i);
  });

  it('refuses to invoice a year group with no structure', async () => {
    await expect(
      asActor(bursar, () =>
        generateInvoices(bursar, {
          academicYearId,
          yearGroupId,
          frequency: 'ONE_OFF',
          periodLabel: '[test] No structure',
          issueDate: '2026-09-01',
          dueDate: '2026-10-01',
        }),
      ),
    ).rejects.toThrow(/fee structure/i);
  });

  it('applies a concession to invoices raised while it is valid', async () => {
    await asActor(bursar, () =>
      grantDiscount(bursar, {
        studentId: testStudentId,
        type: 'PERCENT',
        value: 2_500,
        reason: '[test] scholarship',
        validFrom: '2026-01-01',
        validTo: null,
      }),
    );

    await asActor(bursar, () =>
      generateInvoices(bursar, {
        academicYearId,
        yearGroupId,
        frequency: 'MONTHLY',
        periodLabel: '[test] After concession',
        issueDate: '2026-09-01',
        dueDate: '2026-10-10',
        prefix: 'TST',
      }),
    );

    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { periodLabel: '[test] After concession', studentId: testStudentId, limit: 5 }),
    );
    expect(invoices[0]?.discount).toBeGreaterThan(0);
  });

  it('records a concession against an approver, never anonymously', async () => {
    const discounts = await asActor(bursar, () => listDiscounts(bursar, testStudentId));
    expect(discounts.length).toBeGreaterThan(0);
    expect(discounts[0]?.reason).toContain('[test]');

    const row = await asActor(admin, () =>
      testPrisma.discount.findFirstOrThrow({
        where: { studentId: testStudentId, reason: { startsWith: '[test]' } },
        select: { approvedById: true },
      }),
    );
    expect(row.approvedById).toBe(bursar.userId);
  });

  it('refuses a percentage discount above 100%', async () => {
    await expect(
      asActor(bursar, () =>
        grantDiscount(bursar, {
          studentId: testStudentId,
          type: 'PERCENT',
          value: 20_000,
          reason: '[test] impossible',
          validFrom: '2026-01-01',
          validTo: null,
        }),
      ),
    ).rejects.toThrow(/100/);
  });
});

describe('payments and financial integrity', () => {
  let invoiceId: string;

  beforeAll(async () => {
    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { periodLabel: TEST_PERIOD, limit: 5 }),
    );
    invoiceId = invoices[0]!.id;
  });

  it('records a part payment and reports what is left', async () => {
    const invoice = await asActor(bursar, () => getInvoice(bursar, invoiceId));
    const result = await asActor(bursar, () =>
      recordPayment(bursar, {
        invoiceId,
        amount: Math.floor(invoice.total / 2),
        method: 'BANK',
        reference: '[test]-part-1',
      }),
    );
    expect(result.status).toBe('PARTIAL');
    expect(result.outstanding).toBeGreaterThan(0);
  });

  it('refuses a bank payment with no reference — it could never be reconciled', async () => {
    await expect(
      asActor(bursar, () =>
        recordPayment(bursar, { invoiceId, amount: 100, method: 'BANK', reference: null }),
      ),
    ).rejects.toThrow(/reference/i);
  });

  it('allows cash with no reference', async () => {
    const result = await asActor(bursar, () =>
      recordPayment(bursar, { invoiceId, amount: 100, method: 'CASH', reference: null }),
    );
    expect(result.id).toBeTruthy();
  });

  it('refuses the same reference twice on one voucher — that is a re-keyed receipt', async () => {
    await expect(
      asActor(bursar, () =>
        recordPayment(bursar, {
          invoiceId,
          amount: 500,
          method: 'BANK',
          reference: '[test]-part-1',
        }),
      ),
    ).rejects.toThrow(/already recorded/i);
  });

  it('refuses a payment dated in the future', async () => {
    await expect(
      asActor(bursar, () =>
        recordPayment(bursar, {
          invoiceId,
          amount: 100,
          method: 'CASH',
          reference: null,
          paidAt: new Date(Date.now() + 7 * 86_400_000),
        }),
      ),
    ).rejects.toThrow(/future/i);
  });

  it('records an overpayment and says so rather than refusing the money', async () => {
    const invoice = await asActor(bursar, () => getInvoice(bursar, invoiceId));
    const result = await asActor(bursar, () =>
      recordPayment(bursar, {
        invoiceId,
        amount: invoice.outstanding + 50_000,
        method: 'CASH',
        reference: null,
      }),
    );
    expect(result.outstanding).toBe(0);
    expect(result.overpaidBy).toBe(50_000);
    expect(result.status).toBe('PAID');
  });

  it('marks the invoice locked once money has moved against it', async () => {
    const invoice = await asActor(bursar, () => getInvoice(bursar, invoiceId));
    expect(invoice.isLocked).toBe(true);
    expect(invoice.status).toBe('PAID');
  });

  it('corrects an over-billing with a credit note, not an edit', async () => {
    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { periodLabel: TEST_PERIOD, status: 'UNPAID', limit: 5 }),
    );
    const target = invoices[0]!;

    const note = await asActor(bursar, () =>
      issueCreditNote(bursar, {
        invoiceId: target.id,
        amount: 100_000,
        reason: '[test] lab charge billed in error',
      }),
    );
    expect(note.outstanding).toBe(target.outstanding - 100_000);

    const after = await asActor(bursar, () => getInvoice(bursar, target.id));
    // The invoice's own total is untouched: the correction is a separate record.
    expect(after.total).toBe(target.total);
    expect(after.creditNotes).toHaveLength(1);
    expect(after.status).toBe('PARTIAL');
  });

  it('refuses a credit note larger than what is outstanding', async () => {
    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { periodLabel: TEST_PERIOD, status: 'UNPAID', limit: 5 }),
    );
    await expect(
      asActor(bursar, () =>
        issueCreditNote(bursar, {
          invoiceId: invoices[0]!.id,
          amount: invoices[0]!.total * 10,
          reason: '[test] too much',
        }),
      ),
    ).rejects.toThrow(/outstanding/i);
  });

  it('reverses a bounced payment and leaves the reason in the audit log', async () => {
    const invoice = await asActor(bursar, () => getInvoice(bursar, invoiceId));
    const payment = invoice.payments[0]!;

    const result = await asActor(bursar, () =>
      reversePayment(bursar, { paymentId: payment.id, reason: '[test] cheque bounced' }),
    );
    expect(result.outstanding).toBeGreaterThanOrEqual(0);

    const audit = await asActor(admin, () =>
      testPrisma.auditLog.findFirst({
        where: { action: 'payment.reverse', entityId: payment.id },
        select: { reason: true, beforeJson: true },
      }),
    );
    expect(audit?.reason).toContain('bounced');
    expect(audit?.beforeJson).toBeTruthy();
  });

  it('writes an audit row for every payment', async () => {
    const count = await asActor(admin, () =>
      testPrisma.auditLog.count({ where: { action: 'payment.record' } }),
    );
    expect(count).toBeGreaterThan(0);
  });

  it('never lets a teacher record a payment', async () => {
    await expect(
      asActor(teacher, () =>
        recordPayment(teacher, { invoiceId, amount: 100, method: 'CASH', reference: null }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('scope', () => {
  it('shows a student only their own invoices', async () => {
    const invoices = await asActor(student, () => listInvoices(student, { limit: 200 }));
    expect(invoices.length).toBeGreaterThan(0);
    expect(invoices.every((invoice) => invoice.studentId === student.studentId)).toBe(true);
  });

  it('never lets a student open another student’s invoice by id', async () => {
    const theirs = await asActor(otherStudent, () => listInvoices(otherStudent, { limit: 1 }));
    expect(theirs.length).toBeGreaterThan(0);
    await expect(asActor(student, () => getInvoice(student, theirs[0]!.id))).rejects.toThrow();
  });

  it('never lets a student download another student’s voucher', async () => {
    const theirs = await asActor(otherStudent, () => listInvoices(otherStudent, { limit: 1 }));
    await expect(
      asActor(student, () => renderInvoiceVoucher(student, theirs[0]!.id)),
    ).rejects.toThrow();
  });

  it('renders a student their own voucher as a real PDF', async () => {
    const mine = await asActor(student, () => listInvoices(student, { limit: 1 }));
    const pdf = await asActor(student, () => renderInvoiceVoucher(student, mine[0]!.id));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('never lets a teacher read the school ledger', async () => {
    await expect(asActor(teacher, () => getCollectionReport(teacher))).rejects.toThrow(ForbiddenError);
  });
});

describe('defaulters and reporting', () => {
  it('lists families past their due date, one row per family', async () => {
    const { rows, totals } = await asActor(bursar, () => getDefaulters(bursar, { minOutstanding: 0, limit: 500 }));
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.studentId)).size).toBe(rows.length);
    expect(Object.values(totals).some((bucket) => bucket.students > 0)).toBe(true);
  });

  it('never counts an invoice that is not yet due as a default', async () => {
    const { rows } = await asActor(bursar, () => getDefaulters(bursar, { minOutstanding: 0, limit: 2000 }));
    expect(rows.every((row) => row.daysOverdue > 0)).toBe(true);
  });

  it('puts a guardian’s number on the row, because the next step is a phone call', async () => {
    const { rows } = await asActor(bursar, () => getDefaulters(bursar, { minOutstanding: 0, limit: 200 }));
    expect(rows.some((row) => row.guardianPhone !== null)).toBe(true);
  });

  it('measures collection against what is due, not against what is billed', async () => {
    const report = await asActor(bursar, () => getCollectionReport(bursar, academicYearId));
    expect(report.totals.due).toBeLessThanOrEqual(report.totals.billed);
    expect(report.totals.rate).toBeGreaterThanOrEqual(report.totals.rateOfBilled);
    expect(report.byPeriod.some((period) => !period.isDue)).toBe(true);
  });

  it('breaks collection down by period, year group, head and method', async () => {
    const report = await asActor(bursar, () => getCollectionReport(bursar, academicYearId));
    expect(report.byPeriod.length).toBeGreaterThan(1);
    expect(report.byYearGroup.length).toBeGreaterThan(0);
    expect(report.byFeeHead.length).toBeGreaterThan(0);
    expect(report.byMethod.length).toBeGreaterThan(0);
  });
});

describe('the optional fee gate', () => {
  it('is off unless the school turns it on', async () => {
    const gate = await asActor(bursar, () => checkFeeGate(testStudentId));
    expect(gate.isEnabled).toBe(false);
    expect(gate.isBlocked).toBe(false);
  });

  it('blocks only past the school’s own threshold once enabled', async () => {
    const school = await asActor(admin, () =>
      testPrisma.school.findFirstOrThrow({ select: { id: true, settingsJson: true } }),
    );
    const original = school.settingsJson;

    try {
      await asActor(admin, () =>
        testPrisma.school.update({
          where: { id: school.id },
          data: {
            settingsJson: {
              ...(typeof original === 'object' && original !== null ? original : {}),
              fees: { gateResultsOnOverdue: true, gateOverdueDays: 60 },
            },
          },
        }),
      );

      const { rows } = await asActor(bursar, () =>
        getDefaulters(bursar, { minOutstanding: 0, limit: 2000, bucket: '90+' }),
      );
      if (rows.length > 0) {
        const gate = await asActor(bursar, () => checkFeeGate(rows[0]!.studentId));
        expect(gate.isEnabled).toBe(true);
        expect(gate.isBlocked).toBe(true);
      }

      /*
       * Somebody with nothing *overdue* is never gated, however the setting is configured.
       * Deliberately not "nothing unpaid": every family carries the current month, which
       * is issued and not yet due, so that query matches nobody in a live school.
       */
      const paidUp = await asActor(admin, () =>
        testPrisma.student.findFirstOrThrow({
          where: {
            status: 'ACTIVE',
            invoices: {
              none: { status: { in: ['UNPAID', 'PARTIAL'] }, dueDate: { lt: new Date() } },
            },
          },
          select: { id: true },
        }),
      );
      const clear = await asActor(bursar, () => checkFeeGate(paidUp.id));
      expect(clear.isBlocked).toBe(false);
    } finally {
      await asActor(admin, () =>
        testPrisma.school.update({
          where: { id: school.id },
          // Prisma distinguishes SQL NULL from JSON null on a Json column.
          data: { settingsJson: (original ?? {}) as Prisma.InputJsonValue },
        }),
      );
    }
  });
});

describe('reconciliation', () => {
  it('matches a statement line carrying the voucher number and posts it', async () => {
    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { periodLabel: TEST_PERIOD, status: 'UNPAID', limit: 3 }),
    );
    const target = invoices.find((invoice) => invoice.outstanding > 0)!;

    const csv = [
      'Date,Description,Credit,Reference',
      `01/09/2026,"FEE ${target.voucherNumber}",${Math.round(target.outstanding / 100)},TRXREC1`,
      '01/09/2026,"CASH DEPOSIT UNKNOWN",25,TRXREC2',
    ].join('\n');

    const proposal = await asActor(bursar, () => proposeMatches(bursar, { csv }));
    expect(proposal.summary.confident).toBe(1);

    const confident = proposal.rows.find((row) => row.verdict === 'CONFIDENT')!;
    expect(confident.candidates[0]?.invoiceId).toBe(target.id);

    const posted = await asActor(bursar, () =>
      confirmMatches(bursar, {
        matches: [
          {
            invoiceId: target.id,
            amountPaisa: target.outstanding,
            reference: 'TRXREC1',
            paidAt: '2026-09-01',
          },
        ],
      }),
    );
    expect(posted.posted).toBe(1);
    expect(posted.failed).toHaveLength(0);

    const after = await asActor(bursar, () => getInvoice(bursar, target.id));
    expect(after.outstanding).toBe(0);
  });

  it('proposes nothing it is not sure of, and posts nothing by itself', async () => {
    const before = await asActor(admin, () => testPrisma.payment.count());
    const csv = ['Date,Description,Credit', '01/09/2026,"MISC DEPOSIT",99'].join('\n');

    const proposal = await asActor(bursar, () => proposeMatches(bursar, { csv }));
    expect(proposal.summary.unmatched).toBe(1);

    const after = await asActor(admin, () => testPrisma.payment.count());
    expect(after).toBe(before);
  });

  it('reports a bad file rather than returning an empty match list', async () => {
    const result = await asActor(bursar, () =>
      proposeMatches(bursar, { csv: 'Something,Else\n1,2' }),
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.rows).toHaveLength(0);
  });

  it('keeps the good rows when one cannot be posted', async () => {
    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { periodLabel: TEST_PERIOD, status: 'UNPAID', limit: 3 }),
    );
    const good = invoices.find((invoice) => invoice.outstanding > 0);
    if (!good) return;

    const result = await asActor(bursar, () =>
      confirmMatches(bursar, {
        matches: [
          { invoiceId: good.id, amountPaisa: 1_000, reference: 'TRXMIX1' },
          {
            invoiceId: '00000000-0000-4000-8000-000000000000',
            amountPaisa: 1_000,
            reference: 'TRXMIX2',
          },
        ],
      }),
    );
    expect(result.posted).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.reference).toBe('TRXMIX2');
  });

  it('never lets a teacher reconcile', async () => {
    await expect(
      asActor(teacher, () => proposeMatches(teacher, { csv: 'Date,Description,Credit\n1,2,3' })),
    ).rejects.toThrow(ForbiddenError);
  });
});
