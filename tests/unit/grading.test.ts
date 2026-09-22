import { describe, expect, it } from 'vitest';
import {
  bandIndex,
  bandsDropped,
  gradeFor,
  marginToNextGrade,
  parseBands,
  type GradeBand,
} from '@/lib/services/grading/bands';
import {
  aggregateSubject,
  weakestComponents,
  type ComponentScore,
} from '@/lib/services/grading/aggregate';
import {
  attainmentRates,
  classStatistics,
  gradeDistribution,
  outliers,
  percentile,
  percentileBand,
  weightedRecentPercent,
} from '@/lib/services/grading/statistics';

/** The CAIE A Level defaults the spec names. */
const A_LEVEL: GradeBand[] = [
  { grade: 'A*', minPercent: 90 },
  { grade: 'A', minPercent: 80 },
  { grade: 'B', minPercent: 70 },
  { grade: 'C', minPercent: 60 },
  { grade: 'D', minPercent: 50 },
  { grade: 'E', minPercent: 40 },
  { grade: 'U', minPercent: 0 },
];

describe('grade bands', () => {
  it('awards the grade at the boundary, not one below it', () => {
    // A student on exactly 80 is an A. Getting this off by one is invisible until a parent
    // counts the marks themselves.
    expect(gradeFor(80, A_LEVEL)).toBe('A');
    expect(gradeFor(79.99, A_LEVEL)).toBe('B');
    expect(gradeFor(90, A_LEVEL)).toBe('A*');
    expect(gradeFor(89.999, A_LEVEL)).toBe('A');
  });

  it('resolves every percentage, including zero', () => {
    expect(gradeFor(0, A_LEVEL)).toBe('U');
    expect(gradeFor(39.9, A_LEVEL)).toBe('U');
    expect(gradeFor(40, A_LEVEL)).toBe('E');
    expect(gradeFor(100, A_LEVEL)).toBe('A*');
  });

  it('absorbs binary floating-point error at a boundary', () => {
    // Weighted aggregation divides, so a mathematical 80 can arrive as 79.99999999999999.
    // Comparing that raw would silently cost the student their A.
    const almostEighty = 79.99999999999999;
    expect(almostEighty).toBeLessThan(80);
    expect(gradeFor(almostEighty, A_LEVEL)).toBe('A');

    // But a real 79.99 is still a B — the tolerance absorbs float error, not marks.
    expect(gradeFor(79.99, A_LEVEL)).toBe('B');
  });

  it('holds at a boundary reached through the real weighted path', () => {
    // Three equally weighted papers at exactly 80% each must come out as an A, not a B.
    const scores: ComponentScore[] = [1, 2, 3].map((index) => ({
      componentId: `c${index}`,
      componentCode: `P${index}`,
      componentName: `Paper ${index}`,
      weightPercent: 33,
      marksObtained: 40,
      totalMarks: 50,
      isAbsent: false,
    }));
    expect(aggregateSubject(scores, A_LEVEL).grade).toBe('A');
  });

  it('validates that bands descend and reach zero', () => {
    expect(() => parseBands(A_LEVEL)).not.toThrow();
    expect(() => parseBands([{ grade: 'A', minPercent: 80 }, { grade: 'B', minPercent: 90 }])).toThrow();
    // A scale that stops at 40 leaves a student on 12% with no grade at all.
    expect(() =>
      parseBands([{ grade: 'A', minPercent: 80 }, { grade: 'E', minPercent: 40 }]),
    ).toThrow();
  });

  it('knows how far a grade has moved between series', () => {
    expect(bandIndex('A*', A_LEVEL)).toBe(0);
    expect(bandIndex('U', A_LEVEL)).toBe(6);
    expect(bandIndex('Z', A_LEVEL)).toBeNull();

    // "Students whose grade dropped two bands or more since the last series."
    expect(bandsDropped('A', 'C', A_LEVEL)).toBe(2);
    expect(bandsDropped('A', 'B', A_LEVEL)).toBe(1);
    expect(bandsDropped('C', 'A', A_LEVEL)).toBe(-2);
    expect(bandsDropped('A', 'Z', A_LEVEL)).toBeNull();
  });

  it('reports how far a student is from the next grade up', () => {
    expect(marginToNextGrade(78, A_LEVEL)).toEqual({ nextGrade: 'A', percentNeeded: 2 });
    expect(marginToNextGrade(69.5, A_LEVEL)).toEqual({ nextGrade: 'B', percentNeeded: 0.5 });
    expect(marginToNextGrade(95, A_LEVEL)).toBeNull();
  });

  it('honours a scale a school has edited', () => {
    // "An HOD must be able to set custom boundaries for one specific assessment —
    // 'this paper was harder, A starts at 74'."
    const harder: GradeBand[] = [
      { grade: 'A*', minPercent: 84 },
      { grade: 'A', minPercent: 74 },
      { grade: 'B', minPercent: 64 },
      { grade: 'U', minPercent: 0 },
    ];
    expect(gradeFor(75, A_LEVEL)).toBe('B');
    expect(gradeFor(75, harder)).toBe('A');
  });
});

describe('subject aggregation from components', () => {
  /** Chemistry 9701 exactly as the spec states it: 15/23/38/23, which sums to 99. */
  const chemistry = (marks: (number | null)[]): ComponentScore[] =>
    [
      { code: 'P1', name: 'Multiple Choice', weight: 15, total: 40 },
      { code: 'P2', name: 'AS Structured', weight: 23, total: 60 },
      { code: 'P4', name: 'A Level Structured', weight: 38, total: 100 },
      { code: 'P5', name: 'Planning and Analysis', weight: 23, total: 30 },
    ].map((component, index) => ({
      componentId: `c${index}`,
      componentCode: component.code,
      componentName: component.name,
      weightPercent: component.weight,
      marksObtained: marks[index] ?? null,
      totalMarks: component.total,
      isAbsent: marks[index] === null,
    }));

  it('weights components rather than averaging raw marks', () => {
    // 100% on the 40-mark multiple choice and 50% on the 100-mark structured paper is not
    // a 75% subject. Averaging raw marks is the mistake the spec calls out by name.
    const scores = chemistry([40, 30, 50, 15]);
    const result = aggregateSubject(scores, A_LEVEL);

    // (100×15 + 50×23 + 50×38 + 50×23) / 99
    const expected = (100 * 15 + 50 * 23 + 50 * 38 + 50 * 23) / 99;
    expect(result.percent).toBeCloseTo(expected, 6);
    expect(result.percent).toBeCloseTo(57.58, 2);

    // The naive average of the four component percentages would be 62.5 — a whole grade out.
    expect(result.percent).not.toBeCloseTo(62.5, 1);
  });

  it('normalises by the weight that actually contributed, not by 100', () => {
    // 9701's published weights total 99, so dividing by 100 would understate every grade in
    // the subject by roughly one percent — enough to move a boundary case.
    const perfect = aggregateSubject(chemistry([40, 60, 100, 30]), A_LEVEL);
    expect(perfect.weightCovered).toBe(99);
    expect(perfect.percent).toBe(100);
    expect(perfect.grade).toBe('A*');
  });

  it('excludes an absent component rather than scoring it zero', () => {
    const scores = chemistry([40, 60, null, 30]);
    const result = aggregateSubject(scores, A_LEVEL);

    expect(result.missingComponents).toEqual(['P4']);
    expect(result.weightCovered).toBe(61);
    // Full marks on everything sat is 100%, not 62% with a zero for the missed paper.
    expect(result.percent).toBe(100);
  });

  it('returns null rather than zero when the student sat nothing', () => {
    const result = aggregateSubject(chemistry([null, null, null, null]), A_LEVEL);
    expect(result.percent).toBeNull();
    expect(result.grade).toBeNull();
    expect(result.weightCovered).toBe(0);
    expect(result.missingComponents).toEqual(['P1', 'P2', 'P4', 'P5']);
  });

  it('grades each component as well as the subject', () => {
    const result = aggregateSubject(chemistry([38, 30, 45, 24]), A_LEVEL);
    const byCode = Object.fromEntries(result.components.map((c) => [c.componentCode, c]));

    expect(byCode.P1?.percent).toBeCloseTo(95, 6);
    expect(byCode.P1?.grade).toBe('A*');
    expect(byCode.P4?.percent).toBeCloseTo(45, 6);
    expect(byCode.P4?.grade).toBe('E');
  });

  it('names the paper that is costing the most, weighted', () => {
    // "You are an A on P1 and a D on P4" — and P4 matters more because it carries 38%.
    const result = aggregateSubject(chemistry([38, 48, 45, 24]), A_LEVEL);
    const worst = weakestComponents(result, 2);

    expect(worst[0]?.componentCode).toBe('P4');
    expect(worst[0]?.lostPoints).toBeGreaterThan(worst[1]?.lostPoints ?? 0);
  });

  it('ranks by weighted loss, not by raw percentage', () => {
    // P1 is the worse percentage; P4 costs more of the grade. Revision time should go to P4.
    const scores: ComponentScore[] = [
      {
        componentId: 'a',
        componentCode: 'P1',
        componentName: 'Multiple Choice',
        weightPercent: 15,
        marksObtained: 10,
        totalMarks: 40,
        isAbsent: false,
      },
      {
        componentId: 'b',
        componentCode: 'P4',
        componentName: 'Structured',
        weightPercent: 38,
        marksObtained: 55,
        totalMarks: 100,
        isAbsent: false,
      },
    ];
    const result = aggregateSubject(scores, A_LEVEL);
    const worst = weakestComponents(result);

    expect(worst[0]?.componentCode).toBe('P4');
    expect(worst[0]!.percent).toBeGreaterThan(worst[1]!.percent);
  });

  it('handles a component worth zero total marks without dividing by zero', () => {
    const scores: ComponentScore[] = [
      {
        componentId: 'a',
        componentCode: 'P1',
        componentName: 'Placeholder',
        weightPercent: 50,
        marksObtained: 0,
        totalMarks: 0,
        isAbsent: false,
      },
    ];
    const result = aggregateSubject(scores, A_LEVEL);
    expect(result.percent).toBeNull();
    expect(Number.isNaN(result.percent ?? 0)).toBe(false);
  });
});

describe('class statistics', () => {
  const sample = (marks: (number | null)[]) =>
    marks.map((mark, index) => ({
      studentId: `s${index}`,
      marksObtained: mark,
      isAbsent: mark === null,
    }));

  it('excludes absent students from the mean', () => {
    // A zero for an absent student drags down the class average printed on every other
    // student's result card.
    const withAbsent = classStatistics(sample([80, 90, null]));
    expect(withAbsent.mean).toBe(85);
    expect(withAbsent.sat).toBe(2);
    expect(withAbsent.absent).toBe(1);

    const withZero = classStatistics(sample([80, 90, 0]));
    expect(withZero.mean).toBeCloseTo(56.67, 2);
  });

  it('reports min, max and median', () => {
    const stats = classStatistics(sample([50, 70, 90, 30]));
    expect(stats.min).toBe(30);
    expect(stats.max).toBe(90);
    expect(stats.median).toBe(60);
    expect(classStatistics(sample([10, 20, 30])).median).toBe(20);
  });

  it('uses the sample standard deviation', () => {
    // n−1 for a class of 30, which is a sample of the cohort rather than the population.
    const stats = classStatistics(sample([2, 4, 4, 4, 5, 5, 7, 9]));
    expect(stats.standardDeviation).toBeCloseTo(2.138, 3);
  });

  it('declines to report a deviation for a single mark', () => {
    const stats = classStatistics(sample([75]));
    expect(stats.mean).toBe(75);
    expect(stats.standardDeviation).toBeNull();
  });

  it('returns nulls, not NaN, for an empty class', () => {
    const stats = classStatistics(sample([]));
    expect(stats.mean).toBeNull();
    expect(stats.standardDeviation).toBeNull();
    expect(stats.sat).toBe(0);
  });
});

describe('outlier detection', () => {
  const sample = (marks: number[]) =>
    marks.map((mark, index) => ({ studentId: `s${index}`, marksObtained: mark, isAbsent: false }));

  it('flags a mark more than three deviations from the mean', () => {
    // A mistyped 95 where 9.5 was meant, in an otherwise tight class.
    const marks = [...Array.from({ length: 29 }, () => 50), 95];
    const found = outliers(sample(marks));
    expect(found).toHaveLength(1);
    expect(found[0]?.marksObtained).toBe(95);
    expect(found[0]?.deviationsFromMean).toBeGreaterThan(3);
  });

  it('leaves an ordinary spread alone', () => {
    expect(outliers(sample([40, 45, 50, 55, 60, 65, 70]))).toEqual([]);
  });

  it('does not fire on a class too small to have a spread', () => {
    expect(outliers(sample([10]))).toEqual([]);
    expect(outliers(sample([]))).toEqual([]);
  });

  it('does not treat an absence as an outlier', () => {
    const samples = [
      ...Array.from({ length: 29 }, (_, index) => ({
        studentId: `s${index}`,
        marksObtained: 50,
        isAbsent: false,
      })),
      { studentId: 'absent', marksObtained: null, isAbsent: true },
    ];
    expect(outliers(samples)).toEqual([]);
  });
});

describe('percentile, kept private', () => {
  it('reports the share of peers at or below the student', () => {
    expect(percentile(90, [10, 20, 30, 90])).toBe(100);
    expect(percentile(20, [10, 20, 30, 40])).toBe(50);
    expect(percentile(5, [10, 20, 30, 40])).toBe(0);
    expect(percentile(50, [])).toBeNull();
  });

  it('coarsens into a band rather than an exact position', () => {
    // "Show the student their own percentile, never a public ranked list."
    expect(percentileBand(95)).toBe('top 10%');
    expect(percentileBand(80)).toBe('top 25%');
    expect(percentileBand(60)).toBe('top 50%');
    expect(percentileBand(30)).toBe('top 75%');
    expect(percentileBand(10)).toBe('bottom 25%');
    expect(percentileBand(null)).toBeNull();
  });
});

describe('cohort analytics', () => {
  it('builds a grade distribution in band order, including empty bands', () => {
    const grades = ['A', 'A', 'B', 'U', null];
    const distribution = gradeDistribution(grades, A_LEVEL.map((band) => band.grade));

    expect(distribution.find((entry) => entry.grade === 'A')).toEqual({
      grade: 'A',
      count: 2,
      percent: 50,
    });
    // An empty band still appears, so the shape of the curve is visible.
    expect(distribution.find((entry) => entry.grade === 'C')).toEqual({
      grade: 'C',
      count: 0,
      percent: 0,
    });
  });

  it('computes pass and high-grade rates', () => {
    const grades = ['A*', 'A', 'B', 'C', 'E', 'U'];
    const rates = attainmentRates(
      grades,
      ['A*', 'A', 'B', 'C', 'D', 'E'],
      ['A*', 'A', 'B'],
    );
    expect(rates.entered).toBe(6);
    expect(rates.passRate).toBeCloseTo(83.33, 2);
    expect(rates.highGradeRate).toBe(50);
  });

  it('returns nulls for a cohort with no grades', () => {
    expect(attainmentRates([null, null], ['A'], ['A'])).toEqual({
      entered: 0,
      passRate: null,
      highGradeRate: null,
    });
  });
});

describe('system-suggested prediction', () => {
  it('weights the most recent series most heavily', () => {
    // C → C → B → B is a B, not the average of the four.
    const improving = weightedRecentPercent([
      { percent: 62 },
      { percent: 64 },
      { percent: 72 },
      { percent: 75 },
    ]);
    const flatAverage = (62 + 64 + 72 + 75) / 4;

    expect(improving).toBeGreaterThan(flatAverage);
    expect(gradeFor(improving!, A_LEVEL)).toBe('B');
  });

  it('is symmetric for a student falling away', () => {
    const declining = weightedRecentPercent([
      { percent: 85 },
      { percent: 78 },
      { percent: 71 },
      { percent: 64 },
    ]);
    expect(declining).toBeLessThan((85 + 78 + 71 + 64) / 4);
  });

  it('skips series the student missed', () => {
    expect(weightedRecentPercent([{ percent: null }, { percent: 70 }])).toBe(70);
    expect(weightedRecentPercent([{ percent: null }])).toBeNull();
    expect(weightedRecentPercent([])).toBeNull();
  });
});
