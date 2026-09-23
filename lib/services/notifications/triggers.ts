import { prisma } from '@/lib/db';
import { requireCapability, type Actor } from '@/lib/permissions';
import { formatPaisa } from '@/lib/services/fees/money';
import { notify, notifyMany } from './notify';

/**
 * The events that actually send something.
 *
 * Kept separate from `notify()` so the fan-out stays generic: this file knows what an
 * absence is and what a fee reminder says, and nothing about channels or preferences.
 *
 * Messages are written in the recipient's own words, not the system's. "Ahmed was marked
 * absent for 2 periods today" is a sentence a parent acts on; "ATTENDANCE_EVENT: ABSENT"
 * is one they mute.
 */

type GuardianTarget = {
  userId: string;
  locale: string;
  studentName: string;
};

/** The guardians who have alerts switched on for a student, primary first. */
async function guardiansFor(studentId: string): Promise<GuardianTarget[]> {
  const links = await prisma.guardianStudent.findMany({
    where: { studentId, receivesAlerts: true },
    orderBy: { isPrimary: 'desc' },
    select: {
      guardian: { select: { user: { select: { id: true, locale: true, isActive: true } } } },
      student: { select: { user: { select: { name: true } } } },
    },
  });

  return links
    .filter((link) => link.guardian.user.isActive)
    .map((link) => ({
      userId: link.guardian.user.id,
      locale: link.guardian.user.locale,
      studentName: link.student.user.name,
    }));
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] ?? full;
}

/**
 * Absence alerts.
 *
 * The spec's acceptance criterion: "marking a student absent produces a WhatsApp message
 * to the primary guardian in Urdu or English per their locale preference, within 30
 * minutes, batched with any other absences that day."
 *
 * Batching is `notify()`'s job — this is called once per absence and the daily batch key
 * collapses them. Calling it four times for four periods is correct and produces one
 * message, which is what makes the trigger safe to wire into the register save.
 */
export async function notifyAbsence(
  schoolId: string,
  studentId: string,
  context: { date: string; periodLabel?: string },
): Promise<{ notified: number }> {
  const guardians = await guardiansFor(studentId);

  for (const guardian of guardians) {
    const name = firstName(guardian.studentName);
    const isUrdu = guardian.locale === 'ur';

    await notify(schoolId, guardian.userId, 'attendance.absent', {
      title: isUrdu ? 'غیر حاضری کی اطلاع' : 'Absence recorded',
      body: isUrdu
        ? `${name} کو آج${context.periodLabel ? ` (${context.periodLabel})` : ''} غیر حاضر درج کیا گیا ہے۔`
        : `${name} was marked absent today${context.periodLabel ? ` (${context.periodLabel})` : ''}.`,
      templateVariables: [name, context.date],
      link: '/attendance',
      studentId,
      date: context.date,
    });
  }

  return { notified: guardians.length };
}

/**
 * Sent when a series is published, so a parent does not learn it from another parent.
 *
 * Whole-school by design: publication is a single moment for everybody, so this resolves
 * every guardian in two queries and hands the fan-out to `notifyMany`. Doing it one family
 * at a time turned publishing into a fifty-second request at two thousand students.
 */
export async function notifyResultsPublished(
  schoolId: string,
  studentIds: readonly string[],
  seriesName: string,
): Promise<{ notified: number }> {
  if (studentIds.length === 0) return { notified: 0 };

  const links = await prisma.guardianStudent.findMany({
    where: { studentId: { in: [...studentIds] }, receivesAlerts: true },
    select: {
      guardian: { select: { user: { select: { id: true, locale: true, isActive: true } } } },
      student: { select: { id: true, user: { select: { name: true } } } },
    },
  });

  const recipients = links
    .filter((link) => link.guardian.user.isActive)
    .map((link) => {
      const name = firstName(link.student.user.name);
      const isUrdu = link.guardian.user.locale === 'ur';
      return {
        userId: link.guardian.user.id,
        payload: {
          title: isUrdu ? 'نتیجہ جاری ہو گیا' : 'Result published',
          body: isUrdu
            ? `${name} کا ${seriesName} کا نتیجہ اب دستیاب ہے۔`
            : `${name}'s ${seriesName} result is now available.`,
          templateVariables: [name, seriesName],
          link: '/results',
          studentId: link.student.id,
        },
      };
    });

  await notifyMany(schoolId, 'result.published', recipients);
  return { notified: recipients.length };
}

/** A receipt the moment money is recorded, so a family has proof before they leave. */
export async function notifyPaymentReceived(
  schoolId: string,
  studentId: string,
  context: { voucherNumber: string; amountPaisa: number; outstandingPaisa: number },
): Promise<{ notified: number }> {
  const guardians = await guardiansFor(studentId);

  for (const guardian of guardians) {
    const isUrdu = guardian.locale === 'ur';
    const amount = formatPaisa(context.amountPaisa);
    await notify(schoolId, guardian.userId, 'fee.receipt', {
      title: isUrdu ? 'فیس موصول ہوئی' : 'Payment received',
      body: isUrdu
        ? `واؤچر ${context.voucherNumber} کے لیے ${amount} روپے موصول ہوئے۔` +
          (context.outstandingPaisa > 0
            ? ` باقی: ${formatPaisa(context.outstandingPaisa)} روپے۔`
            : ' مکمل ادائیگی ہو گئی۔')
        : `PKR ${amount} received against voucher ${context.voucherNumber}.` +
          (context.outstandingPaisa > 0
            ? ` Outstanding: PKR ${formatPaisa(context.outstandingPaisa)}.`
            : ' Paid in full.'),
      templateVariables: [amount, context.voucherNumber],
      link: '/fees',
      studentId,
    });
  }

  return { notified: guardians.length };
}

export type ReminderResult = {
  /** Guardians messaged. One per family, not one per unpaid invoice. */
  notified: number;
  /** Families with an outstanding balance but nobody to message. */
  unreachable: number;
  totalOutstanding: number;
};

/**
 * The one-click reminder to every defaulter.
 *
 * Aggregated per family before anything is sent: a parent with three children and two
 * unpaid months gets one message naming a single total, which is both cheaper (WhatsApp
 * is charged per message) and the only version a parent reads.
 *
 * Nothing is sent to a family with no guardian on file; they are counted and reported, so
 * the bursar knows to pick up the phone rather than assuming it went out.
 */
export async function remindDefaulters(
  actor: Actor,
  options: { minDaysOverdue?: number; yearGroupId?: string } = {},
): Promise<ReminderResult> {
  requireCapability(actor, 'fee.manage');

  const now = new Date();
  const cutoff = new Date(now.getTime() - (options.minDaysOverdue ?? 1) * 86_400_000);

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      dueDate: { lt: cutoff },
      ...(options.yearGroupId
        ? { student: { enrolments: { some: { section: { yearGroupId: options.yearGroupId } } } } }
        : {}),
    },
    select: {
      studentId: true,
      total: true,
      dueDate: true,
      payments: { select: { amount: true } },
      creditNotes: { select: { amount: true } },
      student: { select: { user: { select: { name: true } } } },
    },
  });

  // Roll up to one figure per student first, then to one message per guardian.
  const perStudent = new Map<string, { outstanding: number; name: string; oldestDue: Date }>();
  for (const invoice of invoices) {
    const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const credited = invoice.creditNotes.reduce((sum, note) => sum + note.amount, 0);
    const outstanding = Math.max(0, invoice.total - paid - credited);
    if (outstanding <= 0) continue;

    const existing = perStudent.get(invoice.studentId);
    if (existing) {
      existing.outstanding += outstanding;
      if (invoice.dueDate < existing.oldestDue) existing.oldestDue = invoice.dueDate;
    } else {
      perStudent.set(invoice.studentId, {
        outstanding,
        name: invoice.student.user.name,
        oldestDue: invoice.dueDate,
      });
    }
  }

  const perGuardian = new Map<
    string,
    { locale: string; outstanding: number; students: string[]; oldestDue: Date }
  >();
  let unreachable = 0;
  let totalOutstanding = 0;

  for (const [studentId, summary] of perStudent) {
    totalOutstanding += summary.outstanding;
    const guardians = await guardiansFor(studentId);
    if (guardians.length === 0) {
      unreachable += 1;
      continue;
    }

    for (const guardian of guardians) {
      const existing = perGuardian.get(guardian.userId);
      if (existing) {
        existing.outstanding += summary.outstanding;
        existing.students.push(firstName(summary.name));
        if (summary.oldestDue < existing.oldestDue) existing.oldestDue = summary.oldestDue;
      } else {
        perGuardian.set(guardian.userId, {
          locale: guardian.locale,
          outstanding: summary.outstanding,
          students: [firstName(summary.name)],
          oldestDue: summary.oldestDue,
        });
      }
    }
  }

  await notifyMany(
    actor.schoolId,
    'fee.reminder',
    [...perGuardian.entries()].map(([userId, summary]) => {
      const isUrdu = summary.locale === 'ur';
      const amount = formatPaisa(summary.outstanding);
      const names = summary.students.join(', ');
      const due = summary.oldestDue.toISOString().slice(0, 10);
      return {
        userId,
        payload: {
          title: isUrdu ? 'فیس کی یاد دہانی' : 'Fee reminder',
          body: isUrdu
            ? `${names} کی واجب الادا فیس ${amount} روپے ہے (${due} سے)۔`
            : `PKR ${amount} is outstanding for ${names} (due since ${due}).`,
          templateVariables: [names, amount, due],
          link: '/fees',
        },
      };
    }),
  );

  return { notified: perGuardian.size, unreachable, totalOutstanding };
}
