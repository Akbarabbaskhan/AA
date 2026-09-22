import { z } from 'zod';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessSection, requireCapability, type Actor } from '@/lib/permissions';
import { parseOptions, type QuestionOption } from './bank';
import { getSectionTopicMastery, type SectionTopicMastery } from './mastery';

/**
 * What the teacher gets back from a quiz.
 *
 * The spec's line is that per-question analysis is what makes a quiz worth setting: a score
 * tells a teacher the class did badly, the distractor breakdown tells them why. Everything
 * here is aimed at one decision — what to reteach.
 */

async function assertMarker(actor: Actor, quizId: string): Promise<{ sectionId: string; subjectId: string }> {
  requireCapability(actor, 'quiz.manage');
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId },
    select: { sectionId: true, section: { select: { subjectId: true } } },
  });
  if (!quiz) throw ApiError.notFound('Quiz not found');
  assertCanAccessSection(actor, quiz.sectionId);
  return { sectionId: quiz.sectionId, subjectId: quiz.section.subjectId };
}

export type QuestionAnalysis = {
  questionId: string;
  body: string;
  topicTag: string | null;
  marks: number;
  /** Share of submitted attempts that got it right, 0–100. */
  facility: number | null;
  answered: number;
  pendingManual: number;
  /**
   * How often each option was chosen. A distractor pulling 40% is a misconception with a
   * name, which is more useful to a teacher than the facility number alone.
   */
  optionCounts: { option: QuestionOption; count: number; isCorrect: boolean }[];
};

export type QuizAnalysis = {
  quizId: string;
  title: string;
  submitted: number;
  enrolled: number;
  averagePercent: number | null;
  medianPercent: number | null;
  totalMarks: number;
  pendingManualMarking: number;
  questions: QuestionAnalysis[];
  /** Weakest first — the reteach list. */
  topics: SectionTopicMastery[];
  /** Flagged for a conversation, never for an automatic penalty. */
  highTabSwitches: { studentId: string; studentName: string; tabSwitches: number }[];
};

/** Enough switches to be a pattern rather than a notification or an accidental swipe. */
const TAB_SWITCH_FLAG = 5;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) return null;
  return (low + high) / 2;
}

export async function getQuizAnalysis(actor: Actor, quizId: string): Promise<QuizAnalysis> {
  const { sectionId, subjectId } = await assertMarker(actor, quizId);

  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId },
    select: {
      id: true,
      title: true,
      questions: {
        orderBy: { order: 'asc' },
        select: {
          question: {
            select: {
              id: true,
              body: true,
              optionsJson: true,
              correctJson: true,
              marks: true,
              topicTag: true,
            },
          },
        },
      },
      attempts: {
        where: { submittedAt: { not: null } },
        select: {
          id: true,
          score: true,
          tabSwitches: true,
          studentId: true,
          student: { select: { user: { select: { name: true } } } },
          answers: {
            select: {
              questionId: true,
              answerJson: true,
              isCorrect: true,
              needsManualMarking: true,
            },
          },
        },
      },
    },
  });
  if (!quiz) throw ApiError.notFound('Quiz not found');

  const totalMarks = quiz.questions.reduce((sum, entry) => sum + entry.question.marks, 0);
  const percents =
    totalMarks === 0
      ? []
      : quiz.attempts.flatMap((attempt) =>
          attempt.score === null ? [] : [(attempt.score / totalMarks) * 100],
        );

  const enrolled = await prisma.enrolment.count({ where: { sectionId, droppedAt: null } });

  const questions: QuestionAnalysis[] = quiz.questions.map((entry) => {
    const question = entry.question;
    const options = parseOptions(question.optionsJson);
    const correctIds = new Set(
      Array.isArray(question.correctJson)
        ? question.correctJson.filter((value): value is string => typeof value === 'string')
        : typeof question.correctJson === 'string'
          ? [question.correctJson]
          : [],
    );

    const counts = new Map<string, number>();
    let answered = 0;
    let correct = 0;
    let pending = 0;

    for (const attempt of quiz.attempts) {
      const answer = attempt.answers.find((row) => row.questionId === question.id);
      if (!answer) continue;
      if (answer.needsManualMarking) {
        pending += 1;
        continue;
      }
      answered += 1;
      if (answer.isCorrect) correct += 1;
      const chosen = Array.isArray(answer.answerJson)
        ? answer.answerJson.filter((value): value is string => typeof value === 'string')
        : typeof answer.answerJson === 'string'
          ? [answer.answerJson]
          : [];
      for (const id of chosen) counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    return {
      questionId: question.id,
      body: question.body,
      topicTag: question.topicTag,
      marks: question.marks,
      facility: answered === 0 ? null : Math.round((correct / answered) * 100),
      answered,
      pendingManual: pending,
      optionCounts: options.map((option) => ({
        option,
        count: counts.get(option.id) ?? 0,
        isCorrect: correctIds.has(option.id),
      })),
    };
  });

  return {
    quizId: quiz.id,
    title: quiz.title,
    submitted: quiz.attempts.length,
    enrolled,
    averagePercent:
      percents.length === 0
        ? null
        : Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length),
    medianPercent: percents.length === 0 ? null : Math.round(median(percents) ?? 0),
    totalMarks,
    pendingManualMarking: questions.reduce((sum, question) => sum + question.pendingManual, 0),
    questions,
    topics: await getSectionTopicMastery(sectionId, subjectId),
    highTabSwitches: quiz.attempts
      .filter((attempt) => attempt.tabSwitches >= TAB_SWITCH_FLAG)
      .map((attempt) => ({
        studentId: attempt.studentId,
        studentName: attempt.student.user.name,
        tabSwitches: attempt.tabSwitches,
      }))
      .sort((a, b) => b.tabSwitches - a.tabSwitches),
  };
}

export type ManualMarkingItem = {
  answerId: string;
  attemptId: string;
  studentId: string;
  studentName: string;
  questionId: string;
  questionBody: string;
  marks: number;
  acceptedAnswers: string[];
  givenAnswer: string;
};

/**
 * The manual queue.
 *
 * Grouped by question rather than by student on purpose: marking thirty answers to the
 * same question in a row is consistent, and jumping between questions is how two identical
 * answers end up with different marks.
 */
export async function getManualMarkingQueue(actor: Actor, quizId: string): Promise<ManualMarkingItem[]> {
  await assertMarker(actor, quizId);

  const answers = await prisma.quizAnswer.findMany({
    where: { needsManualMarking: true, attempt: { quizId, submittedAt: { not: null } } },
    select: {
      id: true,
      attemptId: true,
      answerJson: true,
      questionId: true,
      question: { select: { body: true, marks: true, correctJson: true } },
      attempt: {
        select: { studentId: true, student: { select: { user: { select: { name: true } } } } },
      },
    },
  });

  return answers
    .map((answer) => ({
      answerId: answer.id,
      attemptId: answer.attemptId,
      studentId: answer.attempt.studentId,
      studentName: answer.attempt.student.user.name,
      questionId: answer.questionId,
      questionBody: answer.question.body,
      marks: answer.question.marks,
      acceptedAnswers: Array.isArray(answer.question.correctJson)
        ? answer.question.correctJson.filter((value): value is string => typeof value === 'string')
        : [],
      givenAnswer: typeof answer.answerJson === 'string' ? answer.answerJson : '',
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId) || a.studentName.localeCompare(b.studentName));
}

export const manualMarkSchema = z.object({
  answerId: z.string().uuid(),
  marksAwarded: z.number().int().min(0).max(100),
});

/**
 * Records a human mark and re-totals the attempt.
 *
 * The attempt's score is recomputed from its answers rather than incremented, so marking
 * the same answer twice (a double-click, a retried request) cannot inflate a score.
 */
export async function markManually(
  actor: Actor,
  quizId: string,
  input: z.infer<typeof manualMarkSchema>,
): Promise<{ attemptId: string; score: number }> {
  await assertMarker(actor, quizId);

  const answer = await prisma.quizAnswer.findFirst({
    where: { id: input.answerId, attempt: { quizId } },
    select: { id: true, attemptId: true, question: { select: { marks: true } } },
  });
  if (!answer) throw ApiError.notFound('Answer not found');
  if (input.marksAwarded > answer.question.marks) {
    throw ApiError.badRequest(
      'aboveMaximum',
      `That question is out of ${answer.question.marks}.`,
      { marksAwarded: [`Maximum ${answer.question.marks}.`] },
    );
  }

  const score = await prisma.$transaction(async (tx) => {
    await tx.quizAnswer.update({
      where: { id: answer.id },
      data: {
        marksAwarded: input.marksAwarded,
        isCorrect: input.marksAwarded >= answer.question.marks,
        needsManualMarking: false,
      },
    });
    const remaining = await tx.quizAnswer.findMany({
      where: { attemptId: answer.attemptId, needsManualMarking: false },
      select: { marksAwarded: true },
    });
    const total = Math.max(
      0,
      remaining.reduce((sum, row) => sum + (row.marksAwarded ?? 0), 0),
    );
    await tx.quizAttempt.update({ where: { id: answer.attemptId }, data: { score: total } });
    return total;
  });

  return { attemptId: answer.attemptId, score };
}
