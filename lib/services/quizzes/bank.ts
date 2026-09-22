import { z } from 'zod';
import type { QuestionType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { requireCapability, type Actor } from '@/lib/permissions';
import { parseCsv } from '@/lib/services/import/csv';
import { normaliseText, TOLERANCE_SCALE } from './marking';

/**
 * The question bank.
 *
 * Per subject rather than per quiz, because the thing that makes a quiz engine worth using
 * in year two is that year one's questions are still there. A teacher who has to retype
 * forty MCQs every September stops using it in October.
 *
 * Bodies and options carry LaTeX and image references verbatim; rendering is the client's
 * job. Nothing is interpolated into HTML here.
 */

export const QUESTION_TYPES = ['MCQ', 'MULTI', 'SHORT', 'NUMERIC'] as const;

/** Option ids are stable per question so an answer keeps meaning if the text is corrected. */
export type QuestionOption = { id: string; text: string };

const optionSchema = z.object({
  id: z.string().min(1).max(16),
  text: z.string().min(1).max(2000),
});

export const questionInputSchema = z
  .object({
    subjectId: z.string().uuid(),
    type: z.enum(QUESTION_TYPES),
    body: z.string().min(1).max(8000),
    options: z.array(optionSchema).max(12).default([]),
    /** MCQ: option id. MULTI: option ids. NUMERIC: number. SHORT: accepted answers. */
    correct: z.union([z.string(), z.array(z.string()), z.number()]),
    marks: z.number().int().min(1).max(100).default(1),
    negativeMarks: z.number().int().min(0).max(100).default(0),
    topicTag: z.string().min(1).max(120).nullable().default(null),
    difficulty: z.number().int().min(1).max(5).nullable().default(null),
    explanation: z.string().max(4000).nullable().default(null),
    /** Basis points. 250 = ±2.5%. */
    toleranceBp: z.number().int().min(0).max(TOLERANCE_SCALE).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    const ids = new Set(value.options.map((option) => option.id));
    if (ids.size !== value.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Option ids must be unique.' });
    }

    if (value.type === 'MCQ' || value.type === 'MULTI') {
      if (value.options.length < 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Give at least two options.' });
      }
      const answers = value.type === 'MCQ' ? [value.correct] : value.correct;
      if (!Array.isArray(answers) && value.type === 'MULTI') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correct'], message: 'Select the correct options.' });
        return;
      }
      const list = Array.isArray(answers) ? answers : answers;
      for (const answer of Array.isArray(list) ? list : [list]) {
        if (typeof answer !== 'string' || !ids.has(answer)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['correct'],
            message: 'The correct answer must be one of the options.',
          });
        }
      }
      if (value.type === 'MULTI' && Array.isArray(value.correct) && value.correct.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correct'], message: 'Select at least one option.' });
      }
      return;
    }

    if (value.type === 'NUMERIC' && typeof value.correct !== 'number') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['correct'], message: 'Give a numeric answer.' });
      return;
    }

    if (value.type === 'SHORT') {
      const accepted = Array.isArray(value.correct) ? value.correct : [String(value.correct)];
      if (accepted.length === 0 || accepted.some((entry) => entry.trim() === '')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correct'],
          message: 'Give at least one accepted answer.',
        });
      }
    }
  });

export type QuestionInput = z.infer<typeof questionInputSchema>;

export type BankQuestion = {
  id: string;
  subjectId: string;
  subjectName: string;
  type: QuestionType;
  body: string;
  options: QuestionOption[];
  marks: number;
  negativeMarks: number;
  topicTag: string | null;
  difficulty: number | null;
  /** Withheld from students by every caller; included here because only staff read the bank. */
  correct: unknown;
  explanation: string | null;
  toleranceBp: number | null;
  usedInQuizzes: number;
};

function assertSubjectTaught(actor: Actor, subjectId: string, taught: ReadonlySet<string>): void {
  if (taught.has(subjectId)) return;
  // Heads and admins hold quiz.manage across the school; a class teacher does not.
  throw ApiError.notFound('Subject not found');
}

async function subjectsActorMayAuthorFor(actor: Actor): Promise<ReadonlySet<string>> {
  // A coordinator authors for any subject; a teacher or head only for what they teach or head.
  if (actor.roles.some((role) => role === 'ADMIN' || role === 'SUPERADMIN')) {
    const all = await prisma.subject.findMany({ select: { id: true } });
    return new Set(all.map((subject) => subject.id));
  }
  const sections = await prisma.section.findMany({
    where: {
      OR: [
        ...(actor.sectionIds.length > 0 ? [{ id: { in: [...actor.sectionIds] } }] : []),
        ...(actor.headOfDepartmentIds.length > 0
          ? [{ subject: { departmentId: { in: [...actor.headOfDepartmentIds] } } }]
          : []),
      ],
    },
    select: { subjectId: true },
  });
  return new Set(sections.map((section) => section.subjectId));
}

/**
 * Validation happens here rather than only in the route handler.
 *
 * A service is called from more than one place — a route, an import, a seed, another
 * service — and an invariant that lives in the route is one every other caller can skip. A
 * question whose answer key is not one of its options is unmarkable, so it must be
 * impossible to create from anywhere.
 */
export async function createQuestion(actor: Actor, raw: QuestionInput): Promise<{ id: string }> {
  requireCapability(actor, 'quiz.manage');
  const input = questionInputSchema.parse(raw);
  const taught = await subjectsActorMayAuthorFor(actor);
  assertSubjectTaught(actor, input.subjectId, taught);

  const question = await prisma.question.create({
    data: {
      schoolId: actor.schoolId,
      subjectId: input.subjectId,
      type: input.type,
      body: input.body,
      optionsJson: input.options,
      correctJson: input.correct as never,
      marks: input.marks,
      negativeMarks: input.negativeMarks,
      topicTag: input.topicTag,
      difficulty: input.difficulty,
      explanation: input.explanation,
      toleranceBp: input.type === 'NUMERIC' ? input.toleranceBp : null,
    },
    select: { id: true },
  });
  return question;
}

export const bankQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  topicTag: z.string().max(120).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listQuestions(
  actor: Actor,
  query: z.infer<typeof bankQuerySchema>,
): Promise<BankQuestion[]> {
  requireCapability(actor, 'quiz.manage');
  const taught = await subjectsActorMayAuthorFor(actor);
  const subjectIds = query.subjectId ? (taught.has(query.subjectId) ? [query.subjectId] : []) : [...taught];
  if (subjectIds.length === 0) return [];

  const rows = await prisma.question.findMany({
    where: {
      subjectId: { in: subjectIds },
      ...(query.topicTag ? { topicTag: query.topicTag } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search ? { body: { contains: query.search, mode: 'insensitive' as const } } : {}),
    },
    orderBy: [{ topicTag: 'asc' }, { createdAt: 'desc' }],
    take: query.limit,
    select: {
      id: true,
      subjectId: true,
      subject: { select: { name: true } },
      type: true,
      body: true,
      optionsJson: true,
      correctJson: true,
      marks: true,
      negativeMarks: true,
      topicTag: true,
      difficulty: true,
      explanation: true,
      toleranceBp: true,
      _count: { select: { quizQuestions: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    subjectId: row.subjectId,
    subjectName: row.subject.name,
    type: row.type,
    body: row.body,
    options: parseOptions(row.optionsJson),
    marks: row.marks,
    negativeMarks: row.negativeMarks,
    topicTag: row.topicTag,
    difficulty: row.difficulty,
    correct: row.correctJson,
    explanation: row.explanation,
    toleranceBp: row.toleranceBp,
    usedInQuizzes: row._count.quizQuestions,
  }));
}

export function parseOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return [];
  const out: QuestionOption[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record['id'] === 'string' && typeof record['text'] === 'string') {
      out.push({ id: record['id'], text: record['text'] });
    }
  }
  return out;
}

/**
 * CSV import for the bank.
 *
 * The shape a teacher can produce in Excel without a manual: one row per question, options
 * in lettered columns, the answer as the letter (or letters) rather than the text. Numeric
 * and short-answer rows leave the option columns empty.
 *
 *   type,body,option_a,option_b,option_c,option_d,answer,marks,topic,difficulty,tolerance_pct,explanation
 */
export type ImportedQuestionRow = {
  rowNumber: number;
  /** Null when the row could not be read; `errors` says why. */
  input: QuestionInput | null;
  errors: string[];
};

const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

function columnIndex(headers: readonly string[], ...names: readonly string[]): number {
  for (const name of names) {
    const index = headers.findIndex((header) => normaliseText(header) === normaliseText(name));
    if (index !== -1) return index;
  }
  return -1;
}

export function parseQuestionCsv(text: string, subjectId: string): ImportedQuestionRow[] {
  const table = parseCsv(text);
  const headers = table.headers;
  const typeAt = columnIndex(headers, 'type', 'question type');
  const bodyAt = columnIndex(headers, 'body', 'question', 'question text');
  const answerAt = columnIndex(headers, 'answer', 'correct', 'correct answer');
  const marksAt = columnIndex(headers, 'marks', 'mark');
  const negativeAt = columnIndex(headers, 'negative_marks', 'negative marks');
  const topicAt = columnIndex(headers, 'topic', 'topic_tag', 'topic tag');
  const difficultyAt = columnIndex(headers, 'difficulty');
  const toleranceAt = columnIndex(headers, 'tolerance_pct', 'tolerance', 'tolerance %');
  const explanationAt = columnIndex(headers, 'explanation');
  const optionAt = OPTION_LETTERS.map((letter) =>
    columnIndex(headers, `option_${letter}`, `option ${letter}`, letter),
  );

  const results: ImportedQuestionRow[] = [];
  table.rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for the header, +1 because humans count from one.
    const errors: string[] = [];
    const cell = (at: number): string => (at === -1 ? '' : (row[at] ?? '').trim());

    if (row.every((value) => value.trim() === '')) return;

    const rawType = normaliseText(cell(typeAt)).toUpperCase();
    const type = (QUESTION_TYPES as readonly string[]).includes(rawType)
      ? (rawType as QuestionType)
      : rawType === ''
        ? 'MCQ'
        : null;
    if (!type) errors.push(`Unknown question type "${cell(typeAt)}".`);

    const body = cell(bodyAt);
    if (body === '') errors.push('The question text is empty.');

    const options: QuestionOption[] = [];
    optionAt.forEach((at, letterIndex) => {
      const text = cell(at);
      const letter = OPTION_LETTERS[letterIndex];
      if (text !== '' && letter) options.push({ id: letter, text });
    });

    const rawAnswer = cell(answerAt);
    if (rawAnswer === '') errors.push('The answer is empty.');

    let correct: string | string[] | number = rawAnswer;
    if (type === 'MCQ') {
      correct = normaliseText(rawAnswer);
    } else if (type === 'MULTI') {
      correct = rawAnswer
        .split(/[,;|]/)
        .map((entry) => normaliseText(entry))
        .filter((entry) => entry !== '');
    } else if (type === 'NUMERIC') {
      const value = Number(rawAnswer.replace(/,/g, ''));
      if (!Number.isFinite(value)) errors.push(`"${rawAnswer}" is not a number.`);
      correct = value;
    } else if (type === 'SHORT') {
      // Accepted spellings are separated by a pipe, so a comma can appear in an answer.
      correct = rawAnswer
        .split('|')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    }

    const marks = cell(marksAt) === '' ? 1 : Number(cell(marksAt));
    if (!Number.isInteger(marks) || marks < 1) errors.push(`"${cell(marksAt)}" is not a mark total.`);
    const negativeMarks = cell(negativeAt) === '' ? 0 : Number(cell(negativeAt));
    const difficulty = cell(difficultyAt) === '' ? null : Number(cell(difficultyAt));
    const tolerancePercent = cell(toleranceAt) === '' ? null : Number(cell(toleranceAt));

    if (errors.length > 0 || !type) {
      results.push({ rowNumber, input: null, errors });
      return;
    }

    const parsed = questionInputSchema.safeParse({
      subjectId,
      type,
      body,
      options,
      correct,
      marks,
      negativeMarks: Number.isFinite(negativeMarks) ? negativeMarks : 0,
      topicTag: cell(topicAt) === '' ? null : cell(topicAt),
      difficulty: difficulty !== null && Number.isFinite(difficulty) ? difficulty : null,
      explanation: cell(explanationAt) === '' ? null : cell(explanationAt),
      toleranceBp:
        tolerancePercent !== null && Number.isFinite(tolerancePercent)
          ? Math.round((tolerancePercent / 100) * TOLERANCE_SCALE)
          : null,
    });

    if (!parsed.success) {
      results.push({ rowNumber, input: null, errors: parsed.error.errors.map((issue) => issue.message) });
      return;
    }
    results.push({ rowNumber, input: parsed.data, errors: [] });
  });

  return results;
}

export type BankImportResult = {
  created: number;
  failed: { rowNumber: number; errors: string[] }[];
};

/**
 * Imports the valid rows and reports the rest.
 *
 * Deliberately not all-or-nothing: a teacher with 38 good rows and 2 typos wants the 38 in
 * and a list of the 2, not a rejection of the file.
 */
export async function importQuestions(
  actor: Actor,
  subjectId: string,
  csvText: string,
): Promise<BankImportResult> {
  requireCapability(actor, 'quiz.manage');
  const taught = await subjectsActorMayAuthorFor(actor);
  assertSubjectTaught(actor, subjectId, taught);

  const rows = parseQuestionCsv(csvText, subjectId);
  const valid = rows.flatMap((row) => (row.input ? [row.input] : []));

  if (valid.length > 0) {
    await prisma.question.createMany({
      data: valid.map((input) => ({
        schoolId: actor.schoolId,
        subjectId,
        type: input.type,
        body: input.body,
        optionsJson: input.options,
        correctJson: input.correct as never,
        marks: input.marks,
        negativeMarks: input.negativeMarks,
        topicTag: input.topicTag,
        difficulty: input.difficulty,
        explanation: input.explanation,
        toleranceBp: input.type === 'NUMERIC' ? input.toleranceBp : null,
      })),
    });
  }

  return {
    created: valid.length,
    failed: rows.filter((row) => !row.input).map((row) => ({ rowNumber: row.rowNumber, errors: row.errors })),
  };
}
