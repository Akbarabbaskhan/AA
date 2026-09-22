import { describe, expect, it } from 'vitest';
import {
  BLOCKS,
  COMBINATIONS,
  DEPARTMENTS,
  GRADING_SCALES,
  PERIODS,
  SUBJECTS,
  combinationBlockConflicts,
} from '@/prisma/seed/curriculum';

describe('curriculum: option blocks', () => {
  it('never puts two subjects of one combination in the same block', () => {
    // This is the invariant the whole clash-free timetable rests on. Violating it produces
    // a timetable that passes the teacher and room checks and strands students in two
    // places at once.
    expect(combinationBlockConflicts()).toEqual([]);
  });

  it('assigns every subject to a real block', () => {
    for (const subject of SUBJECTS) {
      expect(BLOCKS).toContain(subject.block as (typeof BLOCKS)[number]);
    }
  });

  it('gives every combination three or four subjects', () => {
    for (const combination of COMBINATIONS) {
      expect(combination.subjects.length).toBeGreaterThanOrEqual(3);
      expect(combination.subjects.length).toBeLessThanOrEqual(4);
      expect(new Set(combination.subjects).size).toBe(combination.subjects.length);
    }
  });

  it('puts every subject in a department that exists', () => {
    for (const subject of SUBJECTS) {
      expect(DEPARTMENTS).toContain(subject.department as (typeof DEPARTMENTS)[number]);
    }
    expect(DEPARTMENTS).toHaveLength(6);
  });

  it('gives every subject components with sane weights', () => {
    for (const subject of SUBJECTS) {
      expect(subject.components.length).toBeGreaterThanOrEqual(3);
      const total = subject.components.reduce((sum, c) => sum + c.weightPercent, 0);
      // Real CAIE weights do not always total exactly 100 — Chemistry 9701 is 15/23/38/23,
      // which is 99 — so the grading service normalises by the sum. What must hold is that
      // the weights are close to a full paper, not that they are exactly 100.
      expect(total).toBeGreaterThanOrEqual(95);
      expect(total).toBeLessThanOrEqual(105);
      for (const component of subject.components) {
        expect(component.weightPercent).toBeGreaterThan(0);
        expect(component.weightPercent).toBeLessThanOrEqual(100);
      }
    }
  });

  it('runs an 8-period day with no overlapping periods', () => {
    expect(PERIODS).toHaveLength(8);
    for (let index = 1; index < PERIODS.length; index += 1) {
      const previous = PERIODS[index - 1]!;
      const current = PERIODS[index]!;
      expect(current.startTime >= previous.endTime).toBe(true);
    }
  });

  it('ships the grading scales the spec names, with bands in descending order', () => {
    const names = GRADING_SCALES.map((scale) => scale.name);
    expect(names).toContain('CAIE A Level');
    expect(names).toContain('CAIE AS Level');
    expect(names).toContain('CAIE O Level / IGCSE');
    expect(names).toContain('Edexcel IAL');

    for (const scale of GRADING_SCALES) {
      const thresholds = scale.bands.map((band) => band.minPercent);
      expect([...thresholds].sort((a, b) => b - a)).toEqual(thresholds);
      expect(thresholds.at(-1)).toBe(0);
    }

    // The A Level defaults from the spec, exactly.
    const aLevel = GRADING_SCALES.find((scale) => scale.name === 'CAIE A Level');
    expect(aLevel?.bands).toEqual([
      { grade: 'A*', minPercent: 90 },
      { grade: 'A', minPercent: 80 },
      { grade: 'B', minPercent: 70 },
      { grade: 'C', minPercent: 60 },
      { grade: 'D', minPercent: 50 },
      { grade: 'E', minPercent: 40 },
      { grade: 'U', minPercent: 0 },
    ]);
  });

  it('marks exactly one grading scale as the school default', () => {
    expect(GRADING_SCALES.filter((scale) => scale.isDefault)).toHaveLength(1);
  });
});
