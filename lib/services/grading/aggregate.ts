import { gradeFor, type GradeBand } from './bands';

/**
 * Subject grading from component scores.
 *
 * "The thing every Pakistani ERP gets wrong is treating A Level like a
 * percentage-and-position system. It is not. Chemistry 9701 in a mock series has P1, P2, P4
 * and P5 with weights of 15, 23, 38 and 23 percent: the subject grade is computed from the
 * weighted component scores, not from an average of raw marks."
 *
 * Averaging raw marks would let a 40-mark multiple-choice paper count the same as a
 * 100-mark structured paper, which is exactly the mistake the spec calls out.
 */
export type ComponentScore = {
  componentId: string | null;
  componentCode: string;
  componentName: string;
  weightPercent: number;
  marksObtained: number | null;
  totalMarks: number;
  isAbsent: boolean;
};

export type ComponentResult = ComponentScore & {
  /** null when the student did not sit the paper. */
  percent: number | null;
  grade: string | null;
};

export type SubjectResult = {
  components: ComponentResult[];
  /**
   * The weighted percentage across the components the student actually sat.
   * null when they sat none.
   */
  percent: number | null;
  grade: string | null;
  /** The weights that contributed, which is not always 100 — see below. */
  weightCovered: number;
  /** Components the student missed, named so the result card can say so. */
  missingComponents: string[];
};

/**
 * Aggregates component scores into a subject grade.
 *
 * Two details that matter:
 *
 *   Weights are normalised by the total weight that actually contributed, not assumed to
 *   sum to 100. CAIE's own published weights often do not — 9701 is 15/23/38/23, which is
 *   99 — and a series that covers only the AS papers carries less than the full weight
 *   besides. Dividing by the covered weight is the only reading that gives the same answer
 *   in both cases.
 *
 *   An absent component is excluded from both sides rather than counted as zero. "Mark a
 *   student absent rather than entering zero — absence must not drag the class average
 *   down", and the same reasoning applies to the student's own grade. The card names what
 *   they missed rather than quietly grading them on it.
 */
export function aggregateSubject(
  scores: readonly ComponentScore[],
  bands: readonly GradeBand[],
): SubjectResult {
  const components: ComponentResult[] = scores.map((score) => {
    const sat = !score.isAbsent && score.marksObtained !== null;
    const percent =
      sat && score.totalMarks > 0 ? (score.marksObtained! / score.totalMarks) * 100 : null;

    return {
      ...score,
      percent,
      grade: percent === null ? null : gradeFor(percent, bands),
    };
  });

  let weighted = 0;
  let weightCovered = 0;
  const missingComponents: string[] = [];

  for (const component of components) {
    if (component.percent === null) {
      missingComponents.push(component.componentCode);
      continue;
    }
    weighted += component.percent * component.weightPercent;
    weightCovered += component.weightPercent;
  }

  const percent = weightCovered === 0 ? null : weighted / weightCovered;

  return {
    components,
    percent,
    grade: percent === null ? null : gradeFor(percent, bands),
    weightCovered,
    missingComponents,
  };
}

/**
 * Which component is costing the most, in subject-grade percentage points.
 *
 * "Component breakdown — which paper is dragging the grade down. 'You are an A on P1 and a
 * D on P4' is actionable in a way a single grade is not."
 *
 * The loss is measured against a full mark on that paper, weighted — so a weak performance
 * on a 38%-weighted paper outranks a worse one on a 15%-weighted paper, which is what a
 * student should actually spend their revision on.
 */
export function weakestComponents(
  result: SubjectResult,
  limit = 3,
): { componentCode: string; componentName: string; percent: number; lostPoints: number }[] {
  return result.components
    .filter((component): component is ComponentResult & { percent: number } => component.percent !== null)
    .map((component) => ({
      componentCode: component.componentCode,
      componentName: component.componentName,
      percent: component.percent,
      lostPoints:
        result.weightCovered === 0
          ? 0
          : ((100 - component.percent) * component.weightPercent) / result.weightCovered,
    }))
    .sort((a, b) => b.lostPoints - a.lostPoints)
    .slice(0, limit);
}
