import { describe, expect, it } from 'vitest';
import {
  markAnswer,
  normaliseText,
  seededShuffle,
  summarise,
  withinTolerance,
  type MarkedAnswer,
  type QuestionSpec,
} from '@/lib/services/quizzes/marking';
import { blendMastery, CONFIDENT_SAMPLE, MASTERY_SCALE } from '@/lib/services/quizzes/mastery';
import { parseQuestionCsv } from '@/lib/services/quizzes/bank';

const SUBJECT = '11111111-1111-4111-8111-111111111111';

function mcq(overrides: Partial<QuestionSpec> = {}): QuestionSpec {
  return {
    id: 'q1',
    type: 'MCQ',
    options: ['a', 'b', 'c', 'd'],
    correct: 'b',
    marks: 2,
    negativeMarks: 1,
    toleranceBp: null,
    ...overrides,
  };
}

describe('markAnswer — MCQ', () => {
  it('awards the full marks for the correct option', () => {
    expect(markAnswer(mcq(), 'b', false)).toEqual({
      isCorrect: true,
      marksAwarded: 2,
      needsManualMarking: false,
    });
  });

  it('scores zero for a wrong option when negative marking is off', () => {
    expect(markAnswer(mcq(), 'c', false).marksAwarded).toBe(0);
  });

  it('applies the penalty only when the quiz enables negative marking', () => {
    expect(markAnswer(mcq(), 'c', true).marksAwarded).toBe(-1);
  });

  it('never penalises a blank answer — not answering is not a guess', () => {
    const blank = markAnswer(mcq(), null, true);
    expect(blank).toEqual({ isCorrect: false, marksAwarded: 0, needsManualMarking: false });
  });
});

describe('markAnswer — MULTI', () => {
  const multi = mcq({ type: 'MULTI', correct: ['a', 'c'] });

  it('accepts the right set in any order', () => {
    expect(markAnswer(multi, ['c', 'a'], false).isCorrect).toBe(true);
  });

  it('rejects a subset — partial credit would reward ticking everything', () => {
    expect(markAnswer(multi, ['a'], false).isCorrect).toBe(false);
  });

  it('rejects a superset', () => {
    expect(markAnswer(multi, ['a', 'b', 'c'], false).isCorrect).toBe(false);
  });

  it('treats an empty selection as blank, not as a wrong guess', () => {
    expect(markAnswer(multi, [], true).marksAwarded).toBe(0);
  });
});

describe('markAnswer — NUMERIC', () => {
  const numeric = mcq({ type: 'NUMERIC', options: [], correct: 9.81, toleranceBp: 250, marks: 3 });

  it('accepts a value inside the tolerance band', () => {
    // 2.5% of 9.81 is 0.245, so 9.6 is in and 9.5 is out.
    expect(markAnswer(numeric, 9.6, false).isCorrect).toBe(true);
    expect(markAnswer(numeric, 9.5, false).isCorrect).toBe(false);
  });

  it('accepts a numeric string from a text input', () => {
    expect(markAnswer(numeric, '9.81', false).isCorrect).toBe(true);
  });

  it('strips thousands separators a student types', () => {
    const big = mcq({ type: 'NUMERIC', options: [], correct: 12000, toleranceBp: null });
    expect(markAnswer(big, '12,000', false).isCorrect).toBe(true);
  });

  it('demands an exact match when no tolerance is set', () => {
    const exact = mcq({ type: 'NUMERIC', options: [], correct: 7, toleranceBp: null });
    expect(markAnswer(exact, 7.0001, false).isCorrect).toBe(false);
  });

  it('reads a tolerance around zero as an absolute band', () => {
    // A percentage of zero is always zero, which would silently demand exactness.
    expect(withinTolerance(0.01, 0, 250)).toBe(true);
    expect(withinTolerance(0.5, 0, 250)).toBe(false);
  });

  it('marks unparseable input wrong rather than sending it to a human', () => {
    const result = markAnswer(numeric, 'about ten', false);
    expect(result.needsManualMarking).toBe(false);
    expect(result.isCorrect).toBe(false);
  });
});

describe('markAnswer — SHORT', () => {
  const short = mcq({ type: 'SHORT', options: [], correct: ['photosynthesis'], marks: 2 });

  it('auto-marks an exact match once case and spacing are normalised', () => {
    expect(markAnswer(short, '  PhotoSynthesis ', false)).toEqual({
      isCorrect: true,
      marksAwarded: 2,
      needsManualMarking: false,
    });
  });

  it('sends anything else to the teacher rather than marking it wrong', () => {
    const result = markAnswer(short, 'photo synthesis', false);
    expect(result.needsManualMarking).toBe(true);
    expect(result.isCorrect).toBeNull();
    expect(result.marksAwarded).toBeNull();
  });

  it('sends a blank short answer to the queue too — a teacher decides on no answer', () => {
    expect(markAnswer(short, '', false).needsManualMarking).toBe(true);
  });

  it('collapses repeated inner spaces', () => {
    expect(normaliseText('  Sodium   Chloride ')).toBe('sodium chloride');
  });
});

describe('summarise', () => {
  const questions = [mcq({ id: 'a', marks: 2 }), mcq({ id: 'b', marks: 3 }), mcq({ id: 'c', marks: 5 })];

  it('adds the awarded marks and counts what is still pending', () => {
    const marked = new Map<string, MarkedAnswer>([
      ['a', { isCorrect: true, marksAwarded: 2, needsManualMarking: false }],
      ['b', { isCorrect: false, marksAwarded: 0, needsManualMarking: false }],
      ['c', { isCorrect: null, marksAwarded: null, needsManualMarking: true }],
    ]);
    expect(summarise(questions, marked)).toEqual({
      score: 2,
      total: 10,
      autoMarked: 2,
      pendingManual: 1,
    });
  });

  it('floors the score at zero — negative marking cannot hand a student a debt', () => {
    const marked = new Map<string, MarkedAnswer>([
      ['a', { isCorrect: false, marksAwarded: -1, needsManualMarking: false }],
      ['b', { isCorrect: false, marksAwarded: -1, needsManualMarking: false }],
      ['c', { isCorrect: false, marksAwarded: -1, needsManualMarking: false }],
    ]);
    expect(summarise(questions, marked).score).toBe(0);
  });

  it('counts a question with no answer at all as pending, not as zero', () => {
    expect(summarise(questions, new Map()).pendingManual).toBe(3);
  });
});

describe('seededShuffle', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('gives the same order for the same seed, so a reload shows the same paper', () => {
    expect(seededShuffle(items, 'attempt-1')).toEqual(seededShuffle(items, 'attempt-1'));
  });

  it('gives a different order to a different attempt', () => {
    expect(seededShuffle(items, 'attempt-1')).not.toEqual(seededShuffle(items, 'attempt-2'));
  });

  it('keeps every item exactly once', () => {
    expect([...seededShuffle(items, 'x')].sort()).toEqual([...items].sort());
  });

  it('does not mutate the input', () => {
    const original = [...items];
    seededShuffle(items, 'y');
    expect(items).toEqual(original);
  });
});

describe('blendMastery', () => {
  it('takes the first batch as the whole score', () => {
    expect(blendMastery(null, 7000)).toBe(7000);
  });

  it('moves towards recent evidence without jumping to it', () => {
    const next = blendMastery(3000, 10_000);
    expect(next).toBeGreaterThan(3000);
    expect(next).toBeLessThan(10_000);
  });

  it('recovers a written-off topic within about ten good attempts', () => {
    let score = 2000;
    for (let i = 0; i < 10; i += 1) score = blendMastery(score, MASTERY_SCALE);
    expect(score).toBeGreaterThan(9000);
  });

  it('does not let one careless question flip a strength into a weakness', () => {
    expect(blendMastery(9000, 0)).toBeGreaterThan(MASTERY_SCALE / 2);
  });

  it('holds a sensible confidence floor', () => {
    expect(CONFIDENT_SAMPLE).toBeGreaterThanOrEqual(5);
  });
});

describe('parseQuestionCsv', () => {
  const header = 'type,body,option_a,option_b,option_c,option_d,answer,marks,topic,difficulty,tolerance_pct';

  it('reads an MCQ row with lettered options', () => {
    const rows = parseQuestionCsv(
      `${header}\nMCQ,"Which gas?",Oxygen,Nitrogen,Argon,Helium,B,1,Air,2,`,
      SUBJECT,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.errors).toEqual([]);
    expect(rows[0]?.input?.correct).toBe('b');
    expect(rows[0]?.input?.options).toHaveLength(4);
    expect(rows[0]?.input?.topicTag).toBe('Air');
  });

  it('reads a multi-answer row separated by semicolons', () => {
    const rows = parseQuestionCsv(
      `${header}\nMULTI,"Pick the halogens",Fluorine,Sodium,Chlorine,Calcium,"A;C",2,Periodicity,,`,
      SUBJECT,
    );
    expect(rows[0]?.input?.correct).toEqual(['a', 'c']);
  });

  it('converts a tolerance percentage to basis points', () => {
    const rows = parseQuestionCsv(
      `${header}\nNUMERIC,"Value of g?",,,,,9.81,3,Kinematics,,2.5`,
      SUBJECT,
    );
    expect(rows[0]?.input?.toleranceBp).toBe(250);
    expect(rows[0]?.input?.correct).toBe(9.81);
  });

  it('splits short answers on a pipe, so a comma can appear in an answer', () => {
    const rows = parseQuestionCsv(
      `${header}\nSHORT,"Name the process",,,,,"photosynthesis|light-dependent reaction",2,Plants,,`,
      SUBJECT,
    );
    expect(rows[0]?.input?.correct).toEqual(['photosynthesis', 'light-dependent reaction']);
  });

  it('reports a bad row by its spreadsheet line number and keeps the good ones', () => {
    const rows = parseQuestionCsv(
      `${header}\n` +
        `MCQ,"Good question",One,Two,Three,Four,A,1,T,,\n` +
        `NUMERIC,"Bad number",,,,,about ten,1,T,,\n`,
      SUBJECT,
    );
    expect(rows.filter((row) => row.input !== null)).toHaveLength(1);
    const failed = rows.find((row) => row.input === null);
    expect(failed?.rowNumber).toBe(3);
    expect(failed?.errors.join(' ')).toMatch(/not a number/i);
  });

  it('rejects an MCQ whose answer letter has no option', () => {
    const rows = parseQuestionCsv(`${header}\nMCQ,"Which?",One,Two,,,D,1,T,,`, SUBJECT);
    expect(rows[0]?.input).toBeNull();
    expect(rows[0]?.errors.join(' ')).toMatch(/must be one of the options/i);
  });

  it('skips a blank row rather than reporting it as an error', () => {
    const rows = parseQuestionCsv(`${header}\n,,,,,,,,,,\nMCQ,"Q",A,B,,,A,1,T,,`, SUBJECT);
    expect(rows).toHaveLength(1);
  });
});
