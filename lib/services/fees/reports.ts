import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireCapability, type Actor } from '@/lib/permissions';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { AGING_BUCKETS, agingBucket, balanceOf, daysOverdue, type AgingBucket } from './money';
import { parseLineItems } from './invoices';

/**
 * What the bursar looks at.
 *
 * Aggregations run in Postgres wherever the row count makes that matter. Counting a year's
 * invoices in JavaScript works fine at two thousand students and stops working at the
 * first school that has been on Volt for three years.
 */

export type DefaulterRow = {
  studentId: string;
  studentName: string;
  rollNumber: string;
  yearGroupName: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  invoiceCount: number;
  outstanding: number;
  oldestDueDate: string;
  daysOverdue: number;
  bucket: AgingBucket;
};

export const defaulterQuerySchema = z.object({
  academicYearId: z.string().uuid().optional(),
  yearGroupId: z.string().uuid().optional(),
  bucket: z.enum(AGING_BUCKETS).optional(),
  /** Paisa — hides the family who owes eleven rupees from a chase list. */
  minOutstanding: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

/**
 * The chase list, one row per family rather than per invoice.
 *
 * A student with four unpaid months is one conversation, not four, and the aging bucket is
 * taken from the **oldest** unpaid invoice — which is the one that decides how serious the
 * conversation is.
 */
export async function getDefaulters(
  actor: Actor,
  query: z.infer<typeof defaulterQuerySchema>,
): Promise<{ rows: DefaulterRow[]; totals: Record<AgingBucket, { students: number; outstanding: number }> }> {
  requireCapability(actor, 'fee.read.school');

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      /*
       * Past the due date only.
       *
       * A family whose current month is issued but not yet due is not a defaulter, and a
       * chase list that says otherwise is one the accounts office stops trusting by the
       * second week. The stored status cannot express this — it has no clock — so the
       * cutoff is applied here.
       */
      dueDate: { lt: new Date() },
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.yearGroupId
        ? { student: { enrolments: { some: { section: { yearGroupId: query.yearGroupId } } } } }
        : {}),
    },
    select: {
      id: true,
      studentId: true,
      dueDate: true,
      total: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
      student: {
        select: {
          rollNumber: true,
          user: { select: { name: true } },
          enrolments: {
            where: { droppedAt: null },
            take: 1,
            select: { section: { select: { yearGroup: { select: { name: true } } } } },
          },
          guardians: {
            where: { isPrimary: true },
            take: 1,
            select: { guardian: { select: { user: { select: { name: true, phone: true } } } } },
          },
        },
      },
    },
  });

  const now = new Date();
  const byStudent = new Map<string, DefaulterRow>();

  for (const invoice of invoices) {
    const outstanding = balanceOf(invoice.total, invoice.payments, invoice.creditNotes).outstanding;
    if (outstanding <= 0) continue;

    const existing = byStudent.get(invoice.studentId);
    const primary = invoice.student.guardians[0]?.guardian.user;

    if (!existing) {
      byStudent.set(invoice.studentId, {
        studentId: invoice.studentId,
        studentName: invoice.student.user.name,
        rollNumber: invoice.student.rollNumber,
        yearGroupName: invoice.student.enrolments[0]?.section.yearGroup.name ?? null,
        guardianName: primary?.name ?? null,
        guardianPhone: primary?.phone ?? null,
        invoiceCount: 1,
        outstanding,
        oldestDueDate: invoice.dueDate.toISOString().slice(0, 10),
        daysOverdue: daysOverdue(invoice.dueDate, now),
        bucket: agingBucket(invoice.dueDate, now),
      });
      continue;
    }

    existing.invoiceCount += 1;
    existing.outstanding += outstanding;
    if (invoice.dueDate.toISOString().slice(0, 10) < existing.oldestDueDate) {
      existing.oldestDueDate = invoice.dueDate.toISOString().slice(0, 10);
      existing.daysOverdue = daysOverdue(invoice.dueDate, now);
      existing.bucket = agingBucket(invoice.dueDate, now);
    }
  }

  const totals = Object.fromEntries(
    AGING_BUCKETS.map((bucket) => [bucket, { students: 0, outstanding: 0 }]),
  ) as Record<AgingBucket, { students: number; outstanding: number }>;

  for (const row of byStudent.values()) {
    const bucket = totals[row.bucket];
    bucket.students += 1;
    bucket.outstanding += row.outstanding;
  }

  const rows = [...byStudent.values()]
    .filter(
      (row) =>
        row.outstanding >= query.minOutstanding && (!query.bucket || row.bucket === query.bucket),
    )
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding)
    .slice(0, query.limit);

  return { rows, totals };
}

/** The exportable form. CSV rather than XLSX: it opens in everything, including Excel. */
export function defaultersToCsv(rows: readonly DefaulterRow[]): string {
  const header = [
    'Roll number',
    'Student',
    'Year group',
    'Guardian',
    'Guardian phone',
    'Invoices',
    'Outstanding (PKR)',
    'Oldest due',
    'Days overdue',
    'Bucket',
  ];
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

  const lines = rows.map((row) =>
    [
      row.rollNumber,
      row.studentName,
      row.yearGroupName ?? '',
      row.guardianName ?? '',
      // Kept as text: a leading + is stripped by Excel if the cell looks numeric.
      row.guardianPhone ?? '',
      String(row.invoiceCount),
      String(Math.round(row.outstanding / 100)),
      row.oldestDueDate,
      String(row.daysOverdue),
      row.bucket,
    ]
      .map(escape)
      .join(','),
  );

  return [header.join(','), ...lines].join('\n');
}

export type CollectionReport = {
  /** One row per period label, oldest first. */
  byPeriod: {
    periodLabel: string;
    billed: number;
    collected: number;
    outstanding: number;
    rate: number;
    /** False while the period is issued but not yet due. */
    isDue: boolean;
  }[];
  byYearGroup: { yearGroupName: string; billed: number; collected: number; rate: number }[];
  byFeeHead: { label: string; billed: number }[];
  byMethod: { method: string; count: number; amount: number }[];
  totals: {
    billed: number;
    /** The part of `billed` whose due date has passed. The denominator that matters. */
    due: number;
    collected: number;
    credited: number;
    outstanding: number;
    /** Collected against what is due — the number a bursar is judged on. */
    rate: number;
    /** Collected against everything billed, including the month still being collected. */
    rateOfBilled: number;
  };
};

/**
 * Collection against expectation.
 *
 * Two deliberate choices about the denominator, both of which change the headline number:
 *
 * "Billed" is what was invoiced **after discounts** — the money the school actually
 * expects, not the list price. A rate measured against the list price makes every school
 * with a scholarship programme look like it is failing to collect.
 *
 * The headline rate is measured against what is **due**, not against everything billed.
 * The current month is issued and still inside its collection window; counting it as
 * uncollected reports an 80% school as a 70% one every time somebody opens the report
 * before the tenth, and the bursar learns to ignore the number.
 */
export async function getCollectionReport(
  actor: Actor,
  academicYearId?: string,
): Promise<CollectionReport> {
  requireCapability(actor, 'fee.read.school');

  /*
   * Aggregated in Postgres, not in JavaScript.
   *
   * The first version of this pulled every invoice for the year with its payments and
   * credit notes and summed them here: correct, and 1.4 seconds at twelve thousand
   * invoices — for a screen the accounts office opens several times a day. This is the
   * same fix the daily attendance report needed in M1.
   *
   * The year filter is bound as a parameter rather than interpolated, and every query is
   * additionally scoped by school_id: these are raw statements, so the tenancy extension
   * is not in the path and the isolation has to be written out.
   */
  const schoolId = actor.schoolId;
  const now = new Date();
  const yearFilter = academicYearId ?? null;

  type PeriodAggregate = {
    period_label: string;
    billed: bigint;
    collected: bigint;
    credited: bigint;
    first_issue: Date;
    first_due: Date;
  };

  const periodRows = await prisma.$queryRaw<PeriodAggregate[]>`
    SELECT i.period_label,
           SUM(i.total)                        AS billed,
           COALESCE(SUM(p.paid), 0)            AS collected,
           COALESCE(SUM(c.credited), 0)        AS credited,
           MIN(i.issue_date)                   AS first_issue,
           MIN(i.due_date)                     AS first_due
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS credited FROM credit_notes GROUP BY invoice_id
    ) c ON c.invoice_id = i.id
    WHERE i.school_id = ${schoolId}
      AND (${yearFilter}::text IS NULL OR i.academic_year_id = ${yearFilter})
    GROUP BY i.period_label
    ORDER BY MIN(i.issue_date) ASC
  `;

  type GroupAggregate = { year_group_name: string | null; billed: bigint; collected: bigint };

  const groupRows = await prisma.$queryRaw<GroupAggregate[]>`
    SELECT yg.name                    AS year_group_name,
           SUM(i.total)               AS billed,
           COALESCE(SUM(p.paid), 0)   AS collected
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    -- One year group per student: the section they are currently enrolled in.
    LEFT JOIN LATERAL (
      SELECT s.year_group_id
      FROM enrolments e
      JOIN sections s ON s.id = e.section_id
      WHERE e.student_id = i.student_id AND e.dropped_at IS NULL
      LIMIT 1
    ) cur ON true
    LEFT JOIN year_groups yg ON yg.id = cur.year_group_id
    WHERE i.school_id = ${schoolId}
      AND (${yearFilter}::text IS NULL OR i.academic_year_id = ${yearFilter})
    GROUP BY yg.name
    ORDER BY yg.name ASC
  `;

  type HeadAggregate = { label: string; billed: bigint };

  const headRows = await prisma.$queryRaw<HeadAggregate[]>`
    SELECT item->>'label'                        AS label,
           SUM((item->>'amountPaisa')::bigint)   AS billed
    FROM invoices i
    CROSS JOIN LATERAL jsonb_array_elements(i.line_items_json) AS item
    WHERE i.school_id = ${schoolId}
      AND (${yearFilter}::text IS NULL OR i.academic_year_id = ${yearFilter})
    GROUP BY item->>'label'
    ORDER BY SUM((item->>'amountPaisa')::bigint) DESC
  `;

  type TotalsAggregate = { billed: bigint; due: bigint; collected: bigint; credited: bigint };

  const [totalsRow] = await prisma.$queryRaw<TotalsAggregate[]>`
    SELECT COALESCE(SUM(i.total), 0)                                          AS billed,
           COALESCE(SUM(i.total) FILTER (WHERE i.due_date <= ${now}), 0)      AS due,
           COALESCE(SUM(p.paid), 0)                                           AS collected,
           COALESCE(SUM(c.credited), 0)                                       AS credited
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS credited FROM credit_notes GROUP BY invoice_id
    ) c ON c.invoice_id = i.id
    WHERE i.school_id = ${schoolId}
      AND (${yearFilter}::text IS NULL OR i.academic_year_id = ${yearFilter})
  `;

  const methods = await prisma.payment.groupBy({
    by: ['method'],
    _count: { _all: true },
    _sum: { amount: true },
    ...(academicYearId ? { where: { invoice: { academicYearId } } } : {}),
  });

  const rate = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
  const num = (value: bigint | number | null | undefined): number => Number(value ?? 0);

  const billed = num(totalsRow?.billed);
  const due = num(totalsRow?.due);
  const collected = num(totalsRow?.collected);
  const credited = num(totalsRow?.credited);

  return {
    byPeriod: periodRows.map((row) => ({
      periodLabel: row.period_label,
      billed: num(row.billed),
      collected: num(row.collected),
      outstanding: Math.max(0, num(row.billed) - num(row.collected) - num(row.credited)),
      rate: rate(num(row.collected), num(row.billed)),
      isDue: row.first_due <= now,
    })),
    byYearGroup: groupRows.map((row) => ({
      yearGroupName: row.year_group_name ?? 'Unassigned',
      billed: num(row.billed),
      collected: num(row.collected),
      rate: rate(num(row.collected), num(row.billed)),
    })),
    byFeeHead: headRows.map((row) => ({ label: row.label, billed: num(row.billed) })),
    byMethod: methods.map((row) => ({
      method: row.method,
      count: row._count._all,
      amount: row._sum.amount ?? 0,
    })),
    totals: {
      billed,
      due,
      collected,
      credited,
      outstanding: Math.max(0, billed - collected - credited),
      rate: rate(collected, due),
      rateOfBilled: rate(collected, billed),
    },
  };
}

export type FeeGate = {
  /** False when the school has the gate turned off, which is the default. */
  isEnabled: boolean;
  /** True when this student is actually blocked. */
  isBlocked: boolean;
  overdueDays: number;
  outstanding: number;
};

/**
 * The optional result-card gate.
 *
 * "Schools ask for this. Make it a setting, default off, and let the school own the
 * decision." So it is off unless a school turns it on, it is checked at the point of use
 * rather than baked into a query, and when it blocks someone it says what would unblock
 * them — a child who cannot see their result and is not told why learns nothing except
 * that the school is arbitrary.
 */
export async function checkFeeGate(studentId: string): Promise<FeeGate> {
  const settings = await getSchoolSettings();
  if (!settings.fees.gateResultsOnOverdue) {
    return { isEnabled: false, isBlocked: false, overdueDays: 0, outstanding: 0 };
  }

  const invoices = await prisma.invoice.findMany({
    where: { studentId, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
    select: {
      dueDate: true,
      total: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
    },
  });

  const now = new Date();
  let worstDays = 0;
  let outstanding = 0;

  for (const invoice of invoices) {
    const balance = balanceOf(invoice.total, invoice.payments, invoice.creditNotes);
    if (balance.outstanding <= 0) continue;
    outstanding += balance.outstanding;
    worstDays = Math.max(worstDays, daysOverdue(invoice.dueDate, now));
  }

  return {
    isEnabled: true,
    isBlocked: worstDays >= settings.fees.gateOverdueDays,
    overdueDays: worstDays,
    outstanding,
  };
}
