import { z } from 'zod';

/**
 * Grade bands.
 *
 * "GradingScale holds bands as editable JSON. Ship these defaults, all editable per school
 * and per exam series because boundaries move every session."
 *
 * Bands are stored descending by threshold, and the lowest band must reach zero so every
 * percentage resolves to a grade — a student with 3% is a U, not an error.
 */
export const bandSchema = z.object({
  grade: z.string().min(1).max(4),
  minPercent: z.number().min(0).max(100),
});

export const bandsSchema = z
  .array(bandSchema)
  .min(2)
  .superRefine((bands, ctx) => {
    for (let index = 1; index < bands.length; index += 1) {
      if (bands[index]!.minPercent >= bands[index - 1]!.minPercent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Bands must descend: each threshold lower than the one above it',
        });
        return;
      }
    }
    if (bands.at(-1)!.minPercent !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The lowest band must start at 0, so every mark resolves to a grade',
      });
    }
  });

export type GradeBand = z.infer<typeof bandSchema>;

export function parseBands(input: unknown): GradeBand[] {
  return bandsSchema.parse(input);
}

/**
 * Comparisons happen on a value rounded to four decimal places.
 *
 * Without it, a weighted aggregate that is mathematically 80 can arrive as 79.99999999999999
 * and drop a student from an A to a B. Four places is far finer than any real boundary and
 * coarse enough to absorb binary floating-point error.
 */
const COMPARISON_PRECISION = 10_000;

function forComparison(percent: number): number {
  return Math.round(percent * COMPARISON_PRECISION) / COMPARISON_PRECISION;
}

/** The grade a percentage earns, or null when the bands do not reach it. */
export function gradeFor(percent: number, bands: readonly GradeBand[]): string | null {
  const value = forComparison(percent);
  for (const band of bands) {
    if (value >= band.minPercent) return band.grade;
  }
  return null;
}

/** 0 is the top band. Used to measure how far a grade has moved between series. */
export function bandIndex(grade: string, bands: readonly GradeBand[]): number | null {
  const index = bands.findIndex((band) => band.grade === grade);
  return index === -1 ? null : index;
}

/**
 * How many bands a grade fell between two series. Positive means a drop.
 *
 * "Students whose grade dropped two bands or more since the last series, flagged
 * automatically."
 */
export function bandsDropped(
  previousGrade: string,
  currentGrade: string,
  bands: readonly GradeBand[],
): number | null {
  const previous = bandIndex(previousGrade, bands);
  const current = bandIndex(currentGrade, bands);
  if (previous === null || current === null) return null;
  return current - previous;
}

/** The percentage needed for the next grade up, or null at the top band. */
export function marginToNextGrade(
  percent: number,
  bands: readonly GradeBand[],
): { nextGrade: string; percentNeeded: number } | null {
  const value = forComparison(percent);
  for (let index = bands.length - 1; index >= 0; index -= 1) {
    const band = bands[index]!;
    if (band.minPercent > value) {
      return { nextGrade: band.grade, percentNeeded: band.minPercent - value };
    }
  }
  return null;
}
