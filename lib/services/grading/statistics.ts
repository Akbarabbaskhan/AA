/**
 * Class statistics for marks entry validation and analytics.
 *
 * Absent students are excluded from every figure here. "Mark a student absent rather than
 * entering zero — absence must not drag the class average down" is not only about the
 * student's own grade: a zero in the class mean moves the comparison figure printed on
 * every other student's result card.
 */
export type MarkSample = {
  studentId: string;
  marksObtained: number | null;
  isAbsent: boolean;
};

export type ClassStatistics = {
  /** Students who actually sat the paper. */
  sat: number;
  absent: number;
  mean: number | null;
  /** Sample standard deviation (n−1). A class is a sample, not a population. */
  standardDeviation: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
};

function sat(samples: readonly MarkSample[]): number[] {
  return samples
    .filter((sample) => !sample.isAbsent && sample.marksObtained !== null)
    .map((sample) => sample.marksObtained!);
}

export function classStatistics(samples: readonly MarkSample[]): ClassStatistics {
  const marks = sat(samples);
  const absent = samples.length - marks.length;

  if (marks.length === 0) {
    return { sat: 0, absent, mean: null, standardDeviation: null, min: null, max: null, median: null };
  }

  const mean = marks.reduce((sum, mark) => sum + mark, 0) / marks.length;

  // n−1: with a single mark there is no spread to speak of, so the deviation is undefined
  // rather than zero, and the outlier check below correctly declines to fire.
  const standardDeviation =
    marks.length < 2
      ? null
      : Math.sqrt(
          marks.reduce((sum, mark) => sum + (mark - mean) ** 2, 0) / (marks.length - 1),
        );

  const sorted = [...marks].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;

  return {
    sat: marks.length,
    absent,
    mean,
    standardDeviation,
    min: sorted[0]!,
    max: sorted.at(-1)!,
    median,
  };
}

export const OUTLIER_STANDARD_DEVIATIONS = 3;

/**
 * "Warn on outliers more than 3 standard deviations from the class mean."
 *
 * A warning, never a block: a genuinely brilliant answer in a weak class is an outlier, and
 * so is a mistyped 95 that should have been 9.5. The teacher is the one who can tell them
 * apart, so the grid flags it and lets them decide.
 */
export function outliers(
  samples: readonly MarkSample[],
  deviations = OUTLIER_STANDARD_DEVIATIONS,
): { studentId: string; marksObtained: number; deviationsFromMean: number }[] {
  const statistics = classStatistics(samples);
  if (statistics.mean === null || !statistics.standardDeviation) return [];

  return samples
    .filter((sample) => !sample.isAbsent && sample.marksObtained !== null)
    .map((sample) => ({
      studentId: sample.studentId,
      marksObtained: sample.marksObtained!,
      deviationsFromMean: Math.abs(sample.marksObtained! - statistics.mean!) / statistics.standardDeviation!,
    }))
    .filter((entry) => entry.deviationsFromMean > deviations)
    .sort((a, b) => b.deviationsFromMean - a.deviationsFromMean);
}

/**
 * The student's percentile among their peers, shown privately.
 *
 * "Class position, privately — show the student their own percentile, never a public ranked
 * list. Public grade leaderboards are toxic and parents will complain to the principal,
 * which ends the contract."
 *
 * This returns the percentage of peers the student scored at or above, so higher is better,
 * and it is rounded into a band by `percentileBand` before it reaches a screen.
 */
export function percentile(value: number, population: readonly number[]): number | null {
  if (population.length === 0) return null;
  const atOrBelow = population.filter((entry) => entry <= value).length;
  return (atOrBelow / population.length) * 100;
}

/**
 * Coarsens a percentile into a band. A student being told they are 61st of 184 invites
 * exactly the comparison the spec is trying to avoid; "top 40%" does not.
 */
export function percentileBand(value: number | null): string | null {
  if (value === null) return null;
  for (const threshold of [90, 75, 50, 25]) {
    if (value >= threshold) return `top ${100 - threshold}%`;
  }
  return 'bottom 25%';
}

/** Grade distribution across a cohort, for the teacher and HOD views. */
export function gradeDistribution(
  grades: readonly (string | null)[],
  orderedGrades: readonly string[],
): { grade: string; count: number; percent: number }[] {
  const counted = grades.filter((grade): grade is string => grade !== null);
  if (counted.length === 0) return orderedGrades.map((grade) => ({ grade, count: 0, percent: 0 }));

  const tally = new Map<string, number>();
  for (const grade of counted) tally.set(grade, (tally.get(grade) ?? 0) + 1);

  return orderedGrades.map((grade) => {
    const count = tally.get(grade) ?? 0;
    return { grade, count, percent: (count / counted.length) * 100 };
  });
}

/**
 * Pass and high-grade rates. "Subject-wise pass and A*–B rates by teacher, visible to HOD
 * and Admin only."
 *
 * `passGrades` and `highGrades` are given rather than assumed, because what counts as a
 * pass differs by board and by what the school tells its parents.
 */
export function attainmentRates(
  grades: readonly (string | null)[],
  passGrades: readonly string[],
  highGrades: readonly string[],
): { entered: number; passRate: number | null; highGradeRate: number | null } {
  const counted = grades.filter((grade): grade is string => grade !== null);
  if (counted.length === 0) return { entered: 0, passRate: null, highGradeRate: null };

  const passes = counted.filter((grade) => passGrades.includes(grade)).length;
  const high = counted.filter((grade) => highGrades.includes(grade)).length;

  return {
    entered: counted.length,
    passRate: (passes / counted.length) * 100,
    highGradeRate: (high / counted.length) * 100,
  };
}

/**
 * A system-suggested predicted grade from weighted recent performance.
 *
 * Recent series count for more than older ones, because a student who has moved from C to B
 * to B is a B, not the average of the three. The weighting is linear and deliberately
 * simple: this is a suggestion shown next to the teacher's own prediction and clearly
 * labelled as which is which, not a model anyone should trust over them.
 */
export function weightedRecentPercent(
  series: readonly { percent: number | null }[],
): number | null {
  const usable = series.filter(
    (entry): entry is { percent: number } => entry.percent !== null,
  );
  if (usable.length === 0) return null;

  let weighted = 0;
  let weights = 0;
  usable.forEach((entry, index) => {
    const weight = index + 1; // oldest first, so the most recent carries the most weight
    weighted += entry.percent * weight;
    weights += weight;
  });

  return weighted / weights;
}
