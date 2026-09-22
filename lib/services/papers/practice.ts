import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import {
  assertCanAccessSection,
  assertCanAccessStudent,
  can,
  requireCapability,
  type Actor,
} from '@/lib/permissions';
import { gradeFor, parseBands, type GradeBand } from '@/lib/services/grading/bands';
import { getStorage } from '@/lib/storage';

/**
 * The practice engine.
 *
 * "What turns a file repository into a product." The grade trend it feeds is the screenshot
 * students send each other, which is why the spec says to build this one carefully.
 *
 * Two rules shape the whole thing:
 *   The mark scheme stays locked while an attempt is open. Without that the timer is
 *   theatre and the score means nothing.
 *   Goals and streaks count papers attempted, never grades. Effort is the thing a student
 *   controls, and ranking on grades is what the spec forbids elsewhere for good reason.
 */

const DEFAULT_DURATION_MINUTES = 90;
/** Late submissions are recorded, not rejected — a student who loses signal has still sat it. */
const LATE_GRACE_MINUTES = 30;

async function defaultBands(): Promise<GradeBand[]> {
  const scale = await prisma.gradingScale.findFirst({
    where: { isDefault: true },
    select: { bandsJson: true },
  });
  if (!scale) throw ApiError.badRequest('noGradingScale', 'This school has no default grading scale.');
  return parseBands(scale.bandsJson);
}

function requireStudent(actor: Actor): string {
  if (!actor.studentId) throw ApiError.notFound('Practice is for students');
  return actor.studentId;
}

export type ActiveAttempt = {
  attemptId: string;
  pastPaperId: string;
  startedAt: string;
  /** When the exam clock runs out, from the paper's own duration. */
  endsAt: string;
  durationMinutes: number;
  secondsRemaining: number;
  paperUrl: string;
  /** Always null while the attempt is open. That is the point. */
  markSchemeUrl: null;
};

/**
 * Starts a timed attempt.
 *
 * Re-entrant on purpose: a student whose phone dies mid-paper reopens the same attempt with
 * the clock where they left it, rather than starting again with a fresh hour.
 */
export async function startAttempt(actor: Actor, pastPaperId: string): Promise<ActiveAttempt> {
  requireCapability(actor, 'attempt.create');
  const studentId = requireStudent(actor);

  const paper = await prisma.pastPaper.findFirst({
    where: { id: pastPaperId },
    select: { id: true, paperUrl: true, durationMinutes: true, totalMarks: true },
  });
  if (!paper) throw ApiError.notFound('Paper not found');

  const existing = await prisma.paperAttempt.findFirst({
    where: { studentId, pastPaperId, submittedAt: null },
    orderBy: { startedAt: 'desc' },
    select: { id: true, startedAt: true },
  });

  const attempt =
    existing ??
    (await prisma.paperAttempt.create({
      data: {
        schoolId: actor.schoolId,
        studentId,
        pastPaperId,
        total: paper.totalMarks,
      },
      select: { id: true, startedAt: true },
    }));

  const durationMinutes = paper.durationMinutes ?? DEFAULT_DURATION_MINUTES;
  const endsAt = new Date(attempt.startedAt.getTime() + durationMinutes * 60_000);

  const paperUrl = await getStorage().createDownloadUrl(paper.paperUrl, {
    expiresInSeconds: (durationMinutes + LATE_GRACE_MINUTES) * 60,
  });

  return {
    attemptId: attempt.id,
    pastPaperId,
    startedAt: attempt.startedAt.toISOString(),
    endsAt: endsAt.toISOString(),
    durationMinutes,
    secondsRemaining: Math.max(0, Math.round((endsAt.getTime() - Date.now()) / 1000)),
    paperUrl,
    // Locked until submission, whatever the client asks for.
    markSchemeUrl: null,
  };
}

export type SubmittedAttempt = {
  attemptId: string;
  timeTakenSeconds: number;
  wasOverTime: boolean;
  total: number | null;
  markSchemeUrl: string | null;
  examinerReportUrl: string | null;
};

/** Submitting is what unlocks the mark scheme. */
export async function submitAttempt(actor: Actor, attemptId: string): Promise<SubmittedAttempt> {
  requireCapability(actor, 'attempt.create');
  const studentId = requireStudent(actor);

  const attempt = await prisma.paperAttempt.findFirst({
    where: { id: attemptId, studentId },
    select: {
      id: true,
      startedAt: true,
      submittedAt: true,
      total: true,
      pastPaper: {
        select: { markSchemeUrl: true, examinerReportUrl: true, durationMinutes: true, totalMarks: true },
      },
    },
  });
  if (!attempt) throw ApiError.notFound('Attempt not found');

  const submittedAt = attempt.submittedAt ?? new Date();
  const timeTakenSeconds = Math.max(
    0,
    Math.round((submittedAt.getTime() - attempt.startedAt.getTime()) / 1000),
  );

  if (!attempt.submittedAt) {
    await prisma.paperAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedAt,
        timeTakenSeconds,
        total: attempt.total ?? attempt.pastPaper.totalMarks,
      },
    });
  }

  const storage = getStorage();
  const sign = (key: string | null) =>
    key === null ? Promise.resolve(null) : storage.createDownloadUrl(key, { expiresInSeconds: 3600 });

  const [markSchemeUrl, examinerReportUrl] = await Promise.all([
    sign(attempt.pastPaper.markSchemeUrl),
    sign(attempt.pastPaper.examinerReportUrl),
  ]);

  const allowedSeconds =
    (attempt.pastPaper.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60;

  return {
    attemptId: attempt.id,
    timeTakenSeconds,
    wasOverTime: timeTakenSeconds > allowedSeconds,
    total: attempt.total ?? attempt.pastPaper.totalMarks,
    markSchemeUrl,
    examinerReportUrl,
  };
}

export const selfMarkSchema = z.object({
  score: z.number().int().min(0),
  total: z.number().int().min(1).max(500),
  notes: z.string().max(2000).optional(),
});

/** "The mark scheme opens side by side and the student enters their score." */
export async function selfMarkAttempt(
  actor: Actor,
  attemptId: string,
  input: z.infer<typeof selfMarkSchema>,
) {
  requireCapability(actor, 'attempt.create');
  const studentId = requireStudent(actor);

  if (input.score > input.total) {
    throw ApiError.badRequest('scoreAboveTotal', 'That score is higher than the paper total.');
  }

  const attempt = await prisma.paperAttempt.findFirst({
    where: { id: attemptId, studentId },
    select: { id: true, submittedAt: true },
  });
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (!attempt.submittedAt) {
    // Marking before submitting means the mark scheme was open during the paper.
    throw ApiError.conflict('notSubmitted', 'Submit the paper before marking it.');
  }

  const bands = await defaultBands();
  const percent = (input.score / input.total) * 100;

  await prisma.paperAttempt.update({
    where: { id: attempt.id },
    data: {
      selfMarkedScore: input.score,
      total: input.total,
      notes: input.notes ?? null,
    },
  });

  return { attemptId: attempt.id, percent, grade: gradeFor(percent, bands) };
}

export type AttemptSummary = {
  id: string;
  pastPaperId: string;
  subjectName: string;
  subjectCode: string;
  componentCode: string | null;
  year: number;
  session: string;
  variant: number;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  total: number | null;
  percent: number | null;
  grade: string | null;
  timeTakenSeconds: number | null;
};

export async function listAttempts(
  actor: Actor,
  options: { studentId?: string; subjectId?: string; limit?: number } = {},
): Promise<AttemptSummary[]> {
  const studentId = options.studentId ?? actor.studentId;
  if (!studentId) throw ApiError.notFound('No student selected');

  const student = await prisma.student.findFirst({
    where: { id: studentId },
    select: { enrolments: { where: { droppedAt: null }, select: { sectionId: true } } },
  });
  if (!student) throw ApiError.notFound('Student not found');

  assertCanAccessStudent(actor, studentId, student.enrolments.map((entry) => entry.sectionId));

  const bands = await defaultBands();

  const attempts = await prisma.paperAttempt.findMany({
    where: {
      studentId,
      ...(options.subjectId ? { pastPaper: { subjectId: options.subjectId } } : {}),
    },
    orderBy: { startedAt: 'desc' },
    take: options.limit ?? 100,
    select: {
      id: true,
      pastPaperId: true,
      startedAt: true,
      submittedAt: true,
      selfMarkedScore: true,
      total: true,
      timeTakenSeconds: true,
      pastPaper: {
        select: {
          year: true,
          session: true,
          variant: true,
          subject: { select: { name: true, code: true } },
          component: { select: { code: true } },
        },
      },
    },
  });

  return attempts.map((attempt) => {
    const percent =
      attempt.selfMarkedScore !== null && attempt.total !== null && attempt.total > 0
        ? (attempt.selfMarkedScore / attempt.total) * 100
        : null;

    return {
      id: attempt.id,
      pastPaperId: attempt.pastPaperId,
      subjectName: attempt.pastPaper.subject.name,
      subjectCode: attempt.pastPaper.subject.code,
      componentCode: attempt.pastPaper.component?.code ?? null,
      year: attempt.pastPaper.year,
      session: attempt.pastPaper.session,
      variant: attempt.pastPaper.variant,
      startedAt: attempt.startedAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      score: attempt.selfMarkedScore,
      total: attempt.total,
      percent,
      grade: percent === null ? null : gradeFor(percent, bands),
      timeTakenSeconds: attempt.timeTakenSeconds,
    };
  });
}

export type PracticeTrend = {
  gradeBands: GradeBand[];
  subjects: {
    subjectCode: string;
    subjectName: string;
    componentCode: string | null;
    points: { attemptId: string; label: string; submittedAt: string; percent: number; grade: string | null }[];
  }[];
};

/**
 * "Attempts plotted over time with the grade boundary bands shaded behind. 'You have moved
 * from a C to a B on P2 across six attempts' is the screenshot students send each other."
 *
 * Grouped by subject *and component*, because that sentence is about a component. A
 * student's P2 trend and their P4 trend are different stories and averaging them hides both.
 */
export async function getPracticeTrend(actor: Actor, studentId?: string): Promise<PracticeTrend> {
  const attempts = await listAttempts(actor, {
    ...(studentId ? { studentId } : {}),
    limit: 300,
  });
  const bands = await defaultBands();

  const grouped = new Map<string, PracticeTrend['subjects'][number]>();

  for (const attempt of [...attempts].reverse()) {
    if (attempt.percent === null || attempt.submittedAt === null) continue;

    const key = `${attempt.subjectCode}:${attempt.componentCode ?? '-'}`;
    const entry =
      grouped.get(key) ??
      ({
        subjectCode: attempt.subjectCode,
        subjectName: attempt.subjectName,
        componentCode: attempt.componentCode,
        points: [],
      } satisfies PracticeTrend['subjects'][number]);

    entry.points.push({
      attemptId: attempt.id,
      label: `${attempt.session === 'MAY_JUNE' ? 'M/J' : attempt.session === 'OCT_NOV' ? 'O/N' : 'F/M'} ${attempt.year}`,
      submittedAt: attempt.submittedAt,
      percent: attempt.percent,
      grade: attempt.grade,
    });
    grouped.set(key, entry);
  }

  return {
    gradeBands: bands,
    // Most-practised first: that is the trend the student came to look at.
    subjects: [...grouped.values()].sort((a, b) => b.points.length - a.points.length),
  };
}

export type PracticeGoal = {
  goalPerWeek: number;
  thisWeek: number;
  /** Consecutive weeks the goal was met, counting back from last week. */
  streakWeeks: number;
  totalAttempts: number;
};

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getUTCDay() || 7; // Monday = 1
  copy.setUTCDate(copy.getUTCDate() - (day - 1));
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/**
 * "Streaks and goals: papers-per-week target set by the student, with a streak counter.
 * Effort-based, never grade-based."
 *
 * The current week is deliberately excluded from the streak: a Monday morning would
 * otherwise break a streak the student has done nothing to lose.
 */
export async function getPracticeGoal(actor: Actor, studentId?: string): Promise<PracticeGoal> {
  const id = studentId ?? requireStudent(actor);

  const student = await prisma.student.findFirst({
    where: { id },
    select: {
      practiceGoalPerWeek: true,
      enrolments: { where: { droppedAt: null }, select: { sectionId: true } },
    },
  });
  if (!student) throw ApiError.notFound('Student not found');
  assertCanAccessStudent(actor, id, student.enrolments.map((entry) => entry.sectionId));

  const now = new Date();
  const currentWeekStart = startOfWeek(now);
  const horizon = new Date(currentWeekStart);
  horizon.setUTCDate(horizon.getUTCDate() - 7 * 26);

  const attempts = await prisma.paperAttempt.findMany({
    where: { studentId: id, submittedAt: { not: null, gte: horizon } },
    select: { submittedAt: true },
  });

  const byWeek = new Map<number, number>();
  for (const attempt of attempts) {
    const week = startOfWeek(attempt.submittedAt!).getTime();
    byWeek.set(week, (byWeek.get(week) ?? 0) + 1);
  }

  const goal = student.practiceGoalPerWeek;
  let streakWeeks = 0;
  for (let offset = 1; offset <= 26; offset += 1) {
    const week = new Date(currentWeekStart);
    week.setUTCDate(week.getUTCDate() - 7 * offset);
    if ((byWeek.get(week.getTime()) ?? 0) >= goal) streakWeeks += 1;
    else break;
  }

  return {
    goalPerWeek: goal,
    thisWeek: byWeek.get(currentWeekStart.getTime()) ?? 0,
    streakWeeks,
    totalAttempts: await prisma.paperAttempt.count({
      where: { studentId: id, submittedAt: { not: null } },
    }),
  };
}

export const goalSchema = z.object({ goalPerWeek: z.number().int().min(1).max(20) });

export async function setPracticeGoal(actor: Actor, input: z.infer<typeof goalSchema>) {
  const studentId = requireStudent(actor);
  await prisma.student.update({
    where: { id: studentId },
    data: { practiceGoalPerWeek: input.goalPerWeek },
  });
  return { goalPerWeek: input.goalPerWeek };
}

export type SectionPracticeRow = {
  studentId: string;
  name: string;
  rollNumber: string;
  attempts: number;
  lastAttemptAt: string | null;
  averagePercent: number | null;
};

/**
 * "A teacher sees how many papers each student has attempted, which is a genuinely new
 * management tool for them."
 *
 * Ordered by effort, not by score — the teacher is looking for who has stopped practising.
 */
export async function getSectionPractice(
  actor: Actor,
  sectionId: string,
): Promise<SectionPracticeRow[]> {
  requireCapability(actor, 'attempt.read.section');
  assertCanAccessSection(actor, sectionId);

  const section = await prisma.section.findFirst({
    where: { id: sectionId },
    select: {
      subjectId: true,
      enrolments: {
        where: { droppedAt: null },
        select: {
          student: { select: { id: true, rollNumber: true, user: { select: { name: true } } } },
        },
      },
    },
  });
  if (!section) throw ApiError.notFound('Section not found');

  const studentIds = section.enrolments.map(({ student }) => student.id);
  const attempts = await prisma.paperAttempt.findMany({
    where: {
      studentId: { in: studentIds },
      submittedAt: { not: null },
      pastPaper: { subjectId: section.subjectId },
    },
    select: { studentId: true, submittedAt: true, selfMarkedScore: true, total: true },
  });

  const byStudent = new Map<string, { count: number; last: Date | null; percents: number[] }>();
  for (const attempt of attempts) {
    const entry = byStudent.get(attempt.studentId) ?? { count: 0, last: null, percents: [] };
    entry.count += 1;
    if (!entry.last || (attempt.submittedAt && attempt.submittedAt > entry.last)) {
      entry.last = attempt.submittedAt;
    }
    if (attempt.selfMarkedScore !== null && attempt.total) {
      entry.percents.push((attempt.selfMarkedScore / attempt.total) * 100);
    }
    byStudent.set(attempt.studentId, entry);
  }

  return section.enrolments
    .map(({ student }) => {
      const entry = byStudent.get(student.id);
      return {
        studentId: student.id,
        name: student.user.name,
        rollNumber: student.rollNumber,
        attempts: entry?.count ?? 0,
        lastAttemptAt: entry?.last?.toISOString() ?? null,
        averagePercent:
          entry && entry.percents.length > 0
            ? entry.percents.reduce((sum, value) => sum + value, 0) / entry.percents.length
            : null,
      };
    })
    .sort((a, b) => a.attempts - b.attempts);
}

export function canSeeSectionPractice(actor: Actor): boolean {
  return can(actor, 'attempt.read.section');
}
