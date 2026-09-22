import type { QuestionType } from '@prisma/client';

/**
 * Auto-marking. Pure functions, no database, no actor — so the rules can be tested
 * exhaustively and so a client can never import a Prisma client by accident.
 *
 * The spec's line is that a quiz result a student disputes and wins destroys the feature.
 * Everything here is therefore conservative: anything the machine cannot mark with
 * certainty goes to the teacher's queue rather than guessing.
 */

/** Basis points, so a tolerance stays an integer. 250 bp = 2.5%. */
export const TOLERANCE_SCALE = 10_000;

export type QuestionSpec = {
  id: string;
  type: QuestionType;
  /** Option ids in author order. Empty for SHORT and NUMERIC. */
  options: readonly string[];
  /** MCQ: one option id. MULTI: option ids. NUMERIC: one number. SHORT: accepted strings. */
  correct: unknown;
  marks: number;
  negativeMarks: number;
  /** NUMERIC only. Null means an exact match is required. */
  toleranceBp: number | null;
};

export type MarkedAnswer = {
  isCorrect: boolean | null;
  marksAwarded: number | null;
  needsManualMarking: boolean;
};

const UNMARKED: MarkedAnswer = { isCorrect: null, marksAwarded: null, needsManualMarking: true };

function blank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Trailing/leading space, case and repeated inner spaces never decide a mark. */
export function normaliseText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    out.push(entry);
  }
  return out;
}

/**
 * NUMERIC answers are compared as a band, not a value.
 *
 * The band is relative to the expected magnitude, which is what a physics mark scheme
 * means by "±2%". An expected value of exactly zero has no meaningful percentage, so the
 * tolerance is read as an absolute amount there instead of silently demanding exactness.
 */
export function withinTolerance(given: number, expected: number, toleranceBp: number | null): boolean {
  if (!Number.isFinite(given)) return false;
  if (toleranceBp === null || toleranceBp <= 0) return given === expected;
  const band = expected === 0 ? toleranceBp / TOLERANCE_SCALE : Math.abs(expected) * (toleranceBp / TOLERANCE_SCALE);
  return Math.abs(given - expected) <= band;
}

/**
 * Marks one answer.
 *
 * MULTI is all-or-nothing: partial credit on a "select all that apply" rewards a student
 * who ticks everything, which is the opposite of what the question tests.
 *
 * A blank answer scores zero and is never penalised. Negative marking exists to punish a
 * guess, and not answering is not a guess.
 */
export function markAnswer(question: QuestionSpec, answer: unknown, negativeMarking: boolean): MarkedAnswer {
  const penalty = negativeMarking ? -question.negativeMarks : 0;

  if (question.type === 'SHORT') {
    // A short answer that exactly matches an accepted response is marked; anything else
    // is a human's call. Marking it wrong automatically is the dispute the spec warns of.
    const accepted = asStringArray(question.correct);
    if (blank(answer) || typeof answer !== 'string' || !accepted) return UNMARKED;
    const given = normaliseText(answer);
    if (accepted.some((entry) => normaliseText(entry) === given)) {
      return { isCorrect: true, marksAwarded: question.marks, needsManualMarking: false };
    }
    return UNMARKED;
  }

  if (blank(answer)) return { isCorrect: false, marksAwarded: 0, needsManualMarking: false };

  if (question.type === 'MCQ') {
    if (typeof question.correct !== 'string' || typeof answer !== 'string') return UNMARKED;
    const correct = answer === question.correct;
    return { isCorrect: correct, marksAwarded: correct ? question.marks : penalty, needsManualMarking: false };
  }

  if (question.type === 'MULTI') {
    const expected = asStringArray(question.correct);
    const given = asStringArray(answer);
    if (!expected || !given) return UNMARKED;
    const expectedSet = new Set(expected);
    const givenSet = new Set(given);
    const correct = expectedSet.size === givenSet.size && [...expectedSet].every((id) => givenSet.has(id));
    return { isCorrect: correct, marksAwarded: correct ? question.marks : penalty, needsManualMarking: false };
  }

  // NUMERIC. The client may send a string from a text input; a value that is not a number
  // at all is wrong rather than unmarkable, because the field only ever accepts numbers.
  const expected = typeof question.correct === 'number' ? question.correct : Number(question.correct);
  const given = typeof answer === 'number' ? answer : Number(String(answer).trim().replace(/,/g, ''));
  if (!Number.isFinite(expected)) return UNMARKED;
  const correct = withinTolerance(given, expected, question.toleranceBp);
  return { isCorrect: correct, marksAwarded: correct ? question.marks : penalty, needsManualMarking: false };
}

export type ScoreSummary = {
  /** Never below zero: negative marking cannot hand a student a debt. */
  score: number;
  /** Sum of `marks` across every question on the paper. */
  total: number;
  autoMarked: number;
  pendingManual: number;
};

export function summarise(
  questions: readonly QuestionSpec[],
  marked: ReadonlyMap<string, MarkedAnswer>,
): ScoreSummary {
  let score = 0;
  let total = 0;
  let autoMarked = 0;
  let pendingManual = 0;
  for (const question of questions) {
    total += question.marks;
    const result = marked.get(question.id);
    if (!result || result.needsManualMarking) {
      pendingManual += 1;
      continue;
    }
    autoMarked += 1;
    score += result.marksAwarded ?? 0;
  }
  return { score: Math.max(0, score), total, autoMarked, pendingManual };
}

/**
 * Deterministic per-attempt shuffle.
 *
 * Seeded by the attempt id so a student who reloads sees the same paper in the same order.
 * A fresh random order on every render would let a student reload until the question they
 * know comes first, and would make "question 4" meaningless in a support conversation.
 */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
