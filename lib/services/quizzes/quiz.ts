import { z } from 'zod';
import type { Prisma, QuestionType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { assertCanAccessSection, can, requireCapability, type Actor } from '@/lib/permissions';
import { parseOptions, type QuestionOption } from './bank';
import { markAnswer, seededShuffle, summarise, type MarkedAnswer, type QuestionSpec } from './marking';
import { recordQuizMastery } from './mastery';

/**
 * Quiz lifecycle: author, take, mark, analyse.
 *
 * The invariant that everything else hangs off: a student's payload never contains a
 * correct answer, not once, not even for a question they have already answered. The answer
 * key crosses the wire only after the attempt is submitted and only when the quiz says it
 * may. Anything less and the first student to open dev tools ends the feature.
 */

/** A submission arriving after the clock plus this grace is still accepted, still marked. */
const LATE_SUBMIT_GRACE_SECONDS = 30;

export const quizInputSchema = z
  .object({
    sectionId: z.string().uuid(),
    title: z.string().min(1).max(200),
    timeLimitSeconds: z.number().int().min(60).max(4 * 60 * 60).nullable().default(null),
    attemptsAllowed: z.number().int().min(1).max(10).default(1),
    shuffleQuestions: z.boolean().default(true),
    shuffleOptions: z.boolean().default(true),
    negativeMarking: z.boolean().default(false),
    availableFrom: z.coerce.date().nullable().default(null),
    availableTo: z.coerce.date().nullable().default(null),
    showAnswersAfter: z.boolean().default(true),
    questionIds: z.array(z.string().uuid()).min(1).max(100),
  })
  .refine(
    (value) => !value.availableFrom || !value.availableTo || value.availableTo > value.availableFrom,
    { path: ['availableTo'], message: 'The closing time must be after the opening time.' },
  );

export type QuizInput = z.infer<typeof quizInputSchema>;

export async function createQuiz(actor: Actor, raw: QuizInput): Promise<{ id: string }> {
  requireCapability(actor, 'quiz.manage');
  const input = quizInputSchema.parse(raw);
  assertCanAccessSection(actor, input.sectionId);

  const section = await prisma.section.findFirst({
    where: { id: input.sectionId },
    select: { subjectId: true },
  });
  if (!section) throw ApiError.notFound('Section not found');
  if (!actor.staffId) throw ApiError.notFound('Only staff create quizzes');

  // Every question must belong to this section's subject: a chemistry quiz built from
  // physics questions is a typo that only surfaces once thirty students have sat it.
  const questions = await prisma.question.findMany({
    where: { id: { in: input.questionIds } },
    select: { id: true, subjectId: true },
  });
  if (questions.length !== new Set(input.questionIds).size) {
    throw ApiError.badRequest('unknownQuestion', 'One of those questions no longer exists.');
  }
  const foreign = questions.filter((question) => question.subjectId !== section.subjectId);
  if (foreign.length > 0) {
    throw ApiError.badRequest(
      'subjectMismatch',
      'Every question must come from this section’s subject.',
      { questionIds: ['Some questions belong to another subject.'] },
    );
  }

  const quiz = await prisma.quiz.create({
    data: {
      schoolId: actor.schoolId,
      sectionId: input.sectionId,
      createdById: actor.staffId,
      title: input.title,
      timeLimitSeconds: input.timeLimitSeconds,
      attemptsAllowed: input.attemptsAllowed,
      shuffleQuestions: input.shuffleQuestions,
      shuffleOptions: input.shuffleOptions,
      negativeMarking: input.negativeMarking,
      availableFrom: input.availableFrom,
      availableTo: input.availableTo,
      showAnswersAfter: input.showAnswersAfter,
      questions: {
        create: input.questionIds.map((questionId, order) => ({ questionId, order })),
      },
    },
    select: { id: true },
  });
  return quiz;
}

export type QuizSummary = {
  id: string;
  title: string;
  sectionId: string;
  sectionName: string;
  /** Carried so a client can link straight to the subject's resources or question bank. */
  subjectId: string;
  subjectName: string;
  questionCount: number;
  totalMarks: number;
  timeLimitSeconds: number | null;
  attemptsAllowed: number;
  availableFrom: string | null;
  availableTo: string | null;
  /** Student view. Null for staff. */
  attemptsUsed: number | null;
  bestScore: number | null;
  status: 'UPCOMING' | 'OPEN' | 'CLOSED';
  /** Staff view. Null for students. */
  submissionCount: number | null;
  pendingManualMarking: number | null;
};

function quizStatus(from: Date | null, to: Date | null, now: Date): QuizSummary['status'] {
  if (from && now < from) return 'UPCOMING';
  if (to && now > to) return 'CLOSED';
  return 'OPEN';
}

export async function listQuizzes(actor: Actor, sectionId?: string): Promise<QuizSummary[]> {
  const isStudent = can(actor, 'quiz.take') && !can(actor, 'quiz.manage');
  const scopeSections = isStudent ? actor.enrolledSectionIds : actor.sectionIds;

  let sectionIds: string[];
  if (sectionId) {
    assertCanAccessSection(actor, sectionId);
    sectionIds = [sectionId];
  } else if (can(actor, 'quiz.manage') && can(actor, 'structure.manage')) {
    sectionIds = [];
  } else {
    sectionIds = [...scopeSections];
    if (sectionIds.length === 0) return [];
  }

  const now = new Date();
  const quizzes = await prisma.quiz.findMany({
    where: sectionIds.length > 0 ? { sectionId: { in: sectionIds } } : {},
    orderBy: [{ availableFrom: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    select: {
      id: true,
      title: true,
      sectionId: true,
      timeLimitSeconds: true,
      attemptsAllowed: true,
      availableFrom: true,
      availableTo: true,
      section: { select: { name: true, subjectId: true, subject: { select: { name: true } } } },
      questions: { select: { question: { select: { marks: true } } } },
      attempts: {
        where: isStudent && actor.studentId ? { studentId: actor.studentId } : {},
        select: {
          id: true,
          studentId: true,
          score: true,
          submittedAt: true,
          answers: { where: { needsManualMarking: true }, select: { id: true } },
        },
      },
    },
  });

  return quizzes.map((quiz) => {
    const totalMarks = quiz.questions.reduce((sum, entry) => sum + entry.question.marks, 0);
    const submitted = quiz.attempts.filter((attempt) => attempt.submittedAt !== null);
    const scores = submitted.flatMap((attempt) => (attempt.score === null ? [] : [attempt.score]));
    return {
      id: quiz.id,
      title: quiz.title,
      sectionId: quiz.sectionId,
      sectionName: quiz.section.name,
      subjectId: quiz.section.subjectId,
      subjectName: quiz.section.subject.name,
      questionCount: quiz.questions.length,
      totalMarks,
      timeLimitSeconds: quiz.timeLimitSeconds,
      attemptsAllowed: quiz.attemptsAllowed,
      availableFrom: quiz.availableFrom?.toISOString() ?? null,
      availableTo: quiz.availableTo?.toISOString() ?? null,
      attemptsUsed: isStudent ? quiz.attempts.length : null,
      bestScore: isStudent && scores.length > 0 ? Math.max(...scores) : null,
      status: quizStatus(quiz.availableFrom, quiz.availableTo, now),
      submissionCount: isStudent ? null : submitted.length,
      pendingManualMarking: isStudent
        ? null
        : submitted.reduce((sum, attempt) => sum + attempt.answers.length, 0),
    };
  });
}

/** What a student sees while sitting the quiz. No `correct`, no `explanation`, by construction. */
export type SittingQuestion = {
  id: string;
  type: QuestionType;
  body: string;
  options: QuestionOption[];
  marks: number;
  negativeMarks: number;
  /** The answer already saved for this question, if any. */
  saved: unknown;
};

export type Sitting = {
  attemptId: string;
  quizId: string;
  title: string;
  startedAt: string;
  endsAt: string | null;
  secondsRemaining: number | null;
  negativeMarking: boolean;
  totalMarks: number;
  questions: SittingQuestion[];
};

function toSpec(row: {
  id: string;
  type: QuestionType;
  optionsJson: Prisma.JsonValue;
  correctJson: Prisma.JsonValue;
  marks: number;
  negativeMarks: number;
  toleranceBp: number | null;
}): QuestionSpec {
  return {
    id: row.id,
    type: row.type,
    options: parseOptions(row.optionsJson).map((option) => option.id),
    correct: row.correctJson,
    marks: row.marks,
    negativeMarks: row.negativeMarks,
    toleranceBp: row.toleranceBp,
  };
}

function requireStudent(actor: Actor): string {
  if (!actor.studentId) throw ApiError.notFound('Quizzes are taken by students');
  return actor.studentId;
}

/**
 * Opens or resumes an attempt.
 *
 * Re-entrant like paper practice: a dropped connection must not cost an attempt out of the
 * one the teacher allowed. The clock keeps running, which is the honest trade — the time
 * limit is on the quiz, not on the browser tab.
 */
export async function startQuizAttempt(actor: Actor, quizId: string): Promise<Sitting> {
  requireCapability(actor, 'quiz.take');
  const studentId = requireStudent(actor);

  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId },
    select: {
      id: true,
      title: true,
      sectionId: true,
      timeLimitSeconds: true,
      attemptsAllowed: true,
      shuffleQuestions: true,
      shuffleOptions: true,
      negativeMarking: true,
      availableFrom: true,
      availableTo: true,
      questions: {
        orderBy: { order: 'asc' },
        select: {
          question: {
            select: {
              id: true,
              type: true,
              body: true,
              optionsJson: true,
              marks: true,
              negativeMarks: true,
            },
          },
        },
      },
    },
  });
  if (!quiz) throw ApiError.notFound('Quiz not found');
  if (!actor.enrolledSectionIds.includes(quiz.sectionId)) throw ApiError.notFound('Quiz not found');

  const now = new Date();
  const status = quizStatus(quiz.availableFrom, quiz.availableTo, now);
  if (status === 'UPCOMING') throw ApiError.locked('notOpenYet', 'This quiz has not opened yet.');
  if (status === 'CLOSED') throw ApiError.locked('closed', 'This quiz has closed.');

  const attempts = await prisma.quizAttempt.findMany({
    where: { quizId, studentId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      startedAt: true,
      submittedAt: true,
      answers: { select: { questionId: true, answerJson: true } },
    },
  });

  const open = attempts.find((attempt) => attempt.submittedAt === null);
  if (!open && attempts.length >= quiz.attemptsAllowed) {
    throw ApiError.conflict('noAttemptsLeft', 'You have used all your attempts at this quiz.');
  }

  const attempt =
    open ??
    (await prisma.quizAttempt.create({
      data: { schoolId: actor.schoolId, quizId, studentId },
      select: {
        id: true,
        startedAt: true,
        submittedAt: true,
        answers: { select: { questionId: true, answerJson: true } },
      },
    }));

  const saved = new Map(attempt.answers.map((answer) => [answer.questionId, answer.answerJson]));
  const ordered = quiz.shuffleQuestions
    ? seededShuffle(quiz.questions, attempt.id)
    : [...quiz.questions];

  const questions: SittingQuestion[] = ordered.map((entry) => {
    const options = parseOptions(entry.question.optionsJson);
    return {
      id: entry.question.id,
      type: entry.question.type,
      body: entry.question.body,
      options: quiz.shuffleOptions ? seededShuffle(options, `${attempt.id}:${entry.question.id}`) : options,
      marks: entry.question.marks,
      negativeMarks: entry.question.negativeMarks,
      saved: saved.get(entry.question.id) ?? null,
    };
  });

  const endsAt =
    quiz.timeLimitSeconds === null
      ? quiz.availableTo
      : new Date(attempt.startedAt.getTime() + quiz.timeLimitSeconds * 1000);
  const hardEnd =
    endsAt && quiz.availableTo && quiz.availableTo < endsAt ? quiz.availableTo : endsAt;

  return {
    attemptId: attempt.id,
    quizId: quiz.id,
    title: quiz.title,
    startedAt: attempt.startedAt.toISOString(),
    endsAt: hardEnd?.toISOString() ?? null,
    secondsRemaining: hardEnd ? Math.max(0, Math.round((hardEnd.getTime() - now.getTime()) / 1000)) : null,
    negativeMarking: quiz.negativeMarking,
    totalMarks: questions.reduce((sum, question) => sum + question.marks, 0),
    questions,
  };
}

export const saveAnswerSchema = z.object({
  questionId: z.string().uuid(),
  answer: z.union([z.string(), z.array(z.string()), z.number(), z.null()]),
});

/**
 * Saves one answer mid-attempt.
 *
 * Marked as answers arrive rather than in a burst at submit, so a student whose phone dies
 * at question 30 keeps the first 29. `isCorrect` is stored but never returned here.
 */
export async function saveQuizAnswer(
  actor: Actor,
  attemptId: string,
  input: z.infer<typeof saveAnswerSchema>,
): Promise<{ saved: true }> {
  requireCapability(actor, 'quiz.take');
  const studentId = requireStudent(actor);

  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: attemptId, studentId },
    select: {
      id: true,
      submittedAt: true,
      startedAt: true,
      quiz: {
        select: {
          negativeMarking: true,
          timeLimitSeconds: true,
          availableTo: true,
          questions: { select: { questionId: true } },
        },
      },
    },
  });
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.submittedAt) throw ApiError.conflict('alreadySubmitted', 'This attempt is already submitted.');
  if (!attempt.quiz.questions.some((entry) => entry.questionId === input.questionId)) {
    throw ApiError.badRequest('notOnThisQuiz', 'That question is not on this quiz.');
  }

  const question = await prisma.question.findFirst({
    where: { id: input.questionId },
    select: {
      id: true,
      type: true,
      optionsJson: true,
      correctJson: true,
      marks: true,
      negativeMarks: true,
      toleranceBp: true,
    },
  });
  if (!question) throw ApiError.notFound('Question not found');

  const marked = markAnswer(toSpec(question), input.answer, attempt.quiz.negativeMarking);
  const answerJson = (input.answer ?? null) as Prisma.InputJsonValue;

  await prisma.quizAnswer.upsert({
    where: { attemptId_questionId: { attemptId, questionId: input.questionId } },
    create: {
      attemptId,
      questionId: input.questionId,
      answerJson,
      isCorrect: marked.isCorrect,
      marksAwarded: marked.marksAwarded,
      needsManualMarking: marked.needsManualMarking,
    },
    update: {
      answerJson,
      isCorrect: marked.isCorrect,
      marksAwarded: marked.marksAwarded,
      needsManualMarking: marked.needsManualMarking,
    },
  });

  return { saved: true };
}

/**
 * Proportionate anti-cheating.
 *
 * A counter the teacher can see, nothing more. The spec is explicit that Volt does not do
 * webcam proctoring; a tab-switch count gives a teacher a reason to ask a question, which
 * is what a school actually needs.
 */
export async function recordTabSwitch(actor: Actor, attemptId: string): Promise<{ tabSwitches: number }> {
  requireCapability(actor, 'quiz.take');
  const studentId = requireStudent(actor);
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: attemptId, studentId, submittedAt: null },
    select: { id: true },
  });
  if (!attempt) throw ApiError.notFound('Attempt not found');
  const updated = await prisma.quizAttempt.update({
    where: { id: attemptId },
    data: { tabSwitches: { increment: 1 } },
    select: { tabSwitches: true },
  });
  return updated;
}

export type AttemptResult = {
  attemptId: string;
  quizId: string;
  title: string;
  score: number;
  total: number;
  submittedAt: string;
  pendingManualMarking: number;
  /** Null until the quiz allows the key to be shown. */
  questions:
    | {
        id: string;
        body: string;
        options: QuestionOption[];
        yourAnswer: unknown;
        correct: unknown;
        isCorrect: boolean | null;
        marksAwarded: number | null;
        explanation: string | null;
        topicTag: string | null;
      }[]
    | null;
};

/**
 * Submits the attempt and finalises the score.
 *
 * Marking happens again over the whole paper rather than trusting the per-answer values,
 * so an edited question or a fixed answer key cannot leave a stale mark behind.
 */
export async function submitQuizAttempt(actor: Actor, attemptId: string): Promise<AttemptResult> {
  requireCapability(actor, 'quiz.take');
  const studentId = requireStudent(actor);

  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: attemptId, studentId },
    select: {
      id: true,
      startedAt: true,
      submittedAt: true,
      quizId: true,
      quiz: {
        select: {
          id: true,
          title: true,
          negativeMarking: true,
          timeLimitSeconds: true,
          availableTo: true,
          showAnswersAfter: true,
          section: { select: { subjectId: true } },
          questions: {
            orderBy: { order: 'asc' },
            select: {
              question: {
                select: {
                  id: true,
                  type: true,
                  body: true,
                  optionsJson: true,
                  correctJson: true,
                  marks: true,
                  negativeMarks: true,
                  toleranceBp: true,
                  explanation: true,
                  topicTag: true,
                },
              },
            },
          },
        },
      },
      answers: { select: { questionId: true, answerJson: true } },
    },
  });
  if (!attempt) throw ApiError.notFound('Attempt not found');
  if (attempt.submittedAt) throw ApiError.conflict('alreadySubmitted', 'This attempt is already submitted.');

  const given = new Map(attempt.answers.map((answer) => [answer.questionId, answer.answerJson]));
  const specs = attempt.quiz.questions.map((entry) => toSpec(entry.question));
  const marked = new Map<string, MarkedAnswer>();
  for (const spec of specs) {
    marked.set(spec.id, markAnswer(spec, given.get(spec.id) ?? null, attempt.quiz.negativeMarking));
  }
  const summary = summarise(specs, marked);
  const submittedAt = new Date();

  await prisma.$transaction(async (tx) => {
    for (const spec of specs) {
      const result = marked.get(spec.id);
      if (!result) continue;
      await tx.quizAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: spec.id } },
        create: {
          attemptId,
          questionId: spec.id,
          answerJson: (given.get(spec.id) ?? null) as Prisma.InputJsonValue,
          isCorrect: result.isCorrect,
          marksAwarded: result.marksAwarded,
          needsManualMarking: result.needsManualMarking,
        },
        update: {
          isCorrect: result.isCorrect,
          marksAwarded: result.marksAwarded,
          needsManualMarking: result.needsManualMarking,
        },
      });
    }
    await tx.quizAttempt.update({
      where: { id: attemptId },
      data: { submittedAt, score: summary.score },
    });
  });

  await recordQuizMastery(actor.schoolId, studentId, attempt.quiz.section.subjectId, specs, marked, {
    topicOf: new Map(attempt.quiz.questions.map((entry) => [entry.question.id, entry.question.topicTag])),
  });

  return buildResult(attempt.quiz, attemptId, summary.score, summary.total, submittedAt, given, marked);
}

type QuizForResult = {
  id: string;
  title: string;
  showAnswersAfter: boolean;
  questions: {
    question: {
      id: string;
      body: string;
      optionsJson: Prisma.JsonValue;
      correctJson: Prisma.JsonValue;
      explanation: string | null;
      topicTag: string | null;
    };
  }[];
};

function buildResult(
  quiz: QuizForResult,
  attemptId: string,
  score: number,
  total: number,
  submittedAt: Date,
  given: ReadonlyMap<string, unknown>,
  marked: ReadonlyMap<string, MarkedAnswer>,
): AttemptResult {
  const pending = [...marked.values()].filter((result) => result.needsManualMarking).length;
  return {
    attemptId,
    quizId: quiz.id,
    title: quiz.title,
    score,
    total,
    submittedAt: submittedAt.toISOString(),
    pendingManualMarking: pending,
    questions: quiz.showAnswersAfter
      ? quiz.questions.map((entry) => {
          const result = marked.get(entry.question.id);
          return {
            id: entry.question.id,
            body: entry.question.body,
            options: parseOptions(entry.question.optionsJson),
            yourAnswer: given.get(entry.question.id) ?? null,
            correct: entry.question.correctJson,
            isCorrect: result?.isCorrect ?? null,
            marksAwarded: result?.marksAwarded ?? null,
            explanation: entry.question.explanation,
            topicTag: entry.question.topicTag,
          };
        })
      : null,
  };
}

/** Re-reads a submitted attempt. Same rule: the key only travels if the quiz allows it. */
export async function getAttemptResult(actor: Actor, attemptId: string): Promise<AttemptResult> {
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: attemptId },
    select: {
      id: true,
      studentId: true,
      score: true,
      submittedAt: true,
      quiz: {
        select: {
          id: true,
          title: true,
          sectionId: true,
          showAnswersAfter: true,
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
                  explanation: true,
                  topicTag: true,
                },
              },
            },
          },
        },
      },
      answers: {
        select: {
          questionId: true,
          answerJson: true,
          isCorrect: true,
          marksAwarded: true,
          needsManualMarking: true,
        },
      },
    },
  });
  if (!attempt) throw ApiError.notFound('Attempt not found');

  const isOwner = actor.studentId === attempt.studentId;
  const isMarker = can(actor, 'quiz.manage') && actor.sectionIds.includes(attempt.quiz.sectionId);
  const isGuardian = actor.childStudentIds.includes(attempt.studentId);
  if (!isOwner && !isMarker && !isGuardian) throw ApiError.notFound('Attempt not found');
  if (!attempt.submittedAt) throw ApiError.conflict('notSubmitted', 'This attempt is still open.');

  const given = new Map(attempt.answers.map((answer) => [answer.questionId, answer.answerJson]));
  const marked = new Map<string, MarkedAnswer>(
    attempt.answers.map((answer) => [
      answer.questionId,
      {
        isCorrect: answer.isCorrect,
        marksAwarded: answer.marksAwarded,
        needsManualMarking: answer.needsManualMarking,
      },
    ]),
  );
  const total = attempt.quiz.questions.reduce((sum, entry) => sum + entry.question.marks, 0);

  // A teacher marking the paper sees the key regardless of the student-facing setting.
  const quiz = isMarker ? { ...attempt.quiz, showAnswersAfter: true } : attempt.quiz;
  return buildResult(quiz, attempt.id, attempt.score ?? 0, total, attempt.submittedAt, given, marked);
}
