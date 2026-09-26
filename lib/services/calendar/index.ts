import { z } from 'zod';
import { prisma } from '@/lib/db';
import { type Actor } from '@/lib/permissions';
import { dateOnly } from '@/lib/utils/tz';

/**
 * The campus calendar.
 *
 * "Aggregating academic dates, exams, holidays and society events in one view, with a
 * personal filter." Five sources, one list, sorted by date — which is the only shape in
 * which a student can answer "what is happening this term".
 *
 * The personal filter is the part that matters: a student wants *their* exams and the
 * societies they are in, not the whole campus's. Unfiltered, an A Level calendar with
 * twelve subjects' worth of assessment dates is unreadable.
 */

export const CALENDAR_KINDS = ['HOLIDAY', 'EXAM', 'ASSIGNMENT', 'EVENT', 'FEE'] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export type CalendarEntry = {
  id: string;
  kind: CalendarKind;
  title: string;
  /** `YYYY-MM-DD`. All-day entries have no time; timed ones carry `startsAt`. */
  date: string;
  startsAt: string | null;
  endsAt: string | null;
  detail: string | null;
  /** True where this entry is this person's own rather than the campus's. */
  isMine: boolean;
  link: string | null;
};

export const calendarQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** The personal filter: only what involves this person. */
  mineOnly: z.coerce.boolean().default(false),
  kinds: z.string().optional(),
});

function parseKinds(raw: string | undefined): CalendarKind[] {
  if (!raw) return [...CALENDAR_KINDS];
  const wanted = raw.split(',').map((entry) => entry.trim().toUpperCase());
  const kinds = CALENDAR_KINDS.filter((kind) => wanted.includes(kind));
  return kinds.length > 0 ? kinds : [...CALENDAR_KINDS];
}

export async function getCalendar(
  actor: Actor,
  query: z.infer<typeof calendarQuerySchema>,
): Promise<CalendarEntry[]> {
  const from = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(Date.now() - 7 * 86_400_000);
  const to = query.to
    ? new Date(`${query.to}T23:59:59.999Z`)
    : new Date(Date.now() + 90 * 86_400_000);

  const kinds = parseKinds(query.kinds);
  const sectionIds = actor.studentId ? [...actor.enrolledSectionIds] : [...actor.sectionIds];

  const [holidays, assessments, assignments, events, invoices] = await Promise.all([
    kinds.includes('HOLIDAY')
      ? prisma.holiday.findMany({
          where: { date: { gte: from, lte: to } },
          select: { id: true, date: true, label: true },
        })
      : [],

    // Exams: only the student's own papers when the personal filter is on.
    kinds.includes('EXAM')
      ? prisma.assessment.findMany({
          where: {
            date: { gte: from, lte: to },
            ...(query.mineOnly && sectionIds.length > 0 ? { sectionId: { in: sectionIds } } : {}),
          },
          take: 200,
          select: {
            id: true,
            date: true,
            title: true,
            sectionId: true,
            examSeries: { select: { name: true } },
            section: { select: { subject: { select: { name: true } } } },
          },
        })
      : [],

    kinds.includes('ASSIGNMENT')
      ? prisma.assignment.findMany({
          where: {
            deletedAt: null,
            isPublished: true,
            dueAt: { gte: from, lte: to },
            ...(query.mineOnly && sectionIds.length > 0 ? { sectionId: { in: sectionIds } } : {}),
          },
          take: 200,
          select: {
            id: true,
            dueAt: true,
            title: true,
            sectionId: true,
            section: { select: { subject: { select: { name: true } } } },
          },
        })
      : [],

    kinds.includes('EVENT')
      ? prisma.event.findMany({
          where: {
            startsAt: { gte: from, lte: to },
            // Personal filter on events means the societies this student belongs to, plus
            // anything campus-wide — a society they are not in is not their business.
            ...(query.mineOnly && actor.studentId
              ? {
                  OR: [
                    { societyId: null },
                    { society: { members: { some: { studentId: actor.studentId } } } },
                  ],
                }
              : {}),
          },
          take: 200,
          select: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            venue: true,
            societyId: true,
            society: {
              select: {
                name: true,
                members: actor.studentId
                  ? { where: { studentId: actor.studentId }, select: { id: true } }
                  : { where: { studentId: '' }, select: { id: true } },
              },
            },
          },
        })
      : [],

    // Fee due dates, for whoever the invoice belongs to.
    kinds.includes('FEE') && (actor.studentId || actor.childStudentIds.length > 0)
      ? prisma.invoice.findMany({
          where: {
            dueDate: { gte: from, lte: to },
            studentId: actor.studentId
              ? actor.studentId
              : { in: [...actor.childStudentIds] },
            status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
          },
          take: 50,
          select: { id: true, dueDate: true, periodLabel: true, voucherNumber: true },
        })
      : [],
  ]);

  const mySections = new Set(sectionIds);
  const entries: CalendarEntry[] = [];

  for (const holiday of holidays) {
    entries.push({
      id: `holiday:${holiday.id}`,
      kind: 'HOLIDAY',
      title: holiday.label,
      date: dateOnly(holiday.date),
      startsAt: null,
      endsAt: null,
      detail: null,
      // A holiday is everybody's.
      isMine: true,
      link: null,
    });
  }

  for (const assessment of assessments) {
    entries.push({
      id: `exam:${assessment.id}`,
      kind: 'EXAM',
      title: `${assessment.section.subject.name} — ${assessment.title}`,
      date: dateOnly(assessment.date),
      startsAt: null,
      endsAt: null,
      detail: assessment.examSeries.name,
      isMine: mySections.has(assessment.sectionId),
      link: '/results',
    });
  }

  for (const assignment of assignments) {
    entries.push({
      id: `assignment:${assignment.id}`,
      kind: 'ASSIGNMENT',
      title: `${assignment.section.subject.name} — ${assignment.title}`,
      date: dateOnly(assignment.dueAt),
      startsAt: assignment.dueAt.toISOString(),
      endsAt: null,
      detail: null,
      isMine: mySections.has(assignment.sectionId),
      link: `/assignments/${assignment.id}`,
    });
  }

  for (const event of events) {
    entries.push({
      id: `event:${event.id}`,
      kind: 'EVENT',
      title: event.title,
      date: dateOnly(event.startsAt),
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      detail: [event.society?.name, event.venue].filter(Boolean).join(' · ') || null,
      isMine: event.societyId === null || (event.society?.members.length ?? 0) > 0,
      link: '/events',
    });
  }

  for (const invoice of invoices) {
    entries.push({
      id: `fee:${invoice.id}`,
      kind: 'FEE',
      title: `Fee due — ${invoice.periodLabel}`,
      date: dateOnly(invoice.dueDate),
      startsAt: null,
      endsAt: null,
      detail: invoice.voucherNumber,
      isMine: true,
      link: `/fees/${invoice.id}`,
    });
  }

  return entries
    .filter((entry) => !query.mineOnly || entry.isMine)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
