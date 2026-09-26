import { describe, expect, it } from 'vitest';
import { AUTO_BADGES, EFFORT_METRICS } from '@/lib/services/recognition';
import { CALENDAR_KINDS } from '@/lib/services/calendar';

/**
 * The rule the spec is most emphatic about: "rank effort, never grades."
 *
 * These assert the shape of the feature rather than its arithmetic, because the harm this
 * module could do is structural — a metric that reads a mark, or a badge awarded for
 * attainment, would be the mistake, not an off-by-one.
 */
describe('effort metrics', () => {
  it('measures only things a student chose to do', () => {
    // Every metric is a count of an action. None of them is a score.
    expect([...EFFORT_METRICS]).toEqual(['PAPERS', 'QUIZZES', 'ATTENDANCE_STREAK', 'SOCIETY']);
  });

  it('names no metric after a grade, a mark or a position', () => {
    for (const metric of EFFORT_METRICS) {
      expect(metric).not.toMatch(/grade|mark|score|percent|rank|position|average/i);
    }
  });
});

describe('badges', () => {
  it('awards only for effort milestones, never for attainment', () => {
    for (const badge of AUTO_BADGES) {
      expect(EFFORT_METRICS).toContain(badge.metric);
      expect(badge.description).not.toMatch(/grade|A\*|percentile|top of/i);
    }
  });

  it('sets thresholds high enough to mean something', () => {
    // A badge everybody holds by week two is a badge nobody mentions.
    for (const badge of AUTO_BADGES) {
      expect(badge.threshold).toBeGreaterThan(1);
    }
  });

  it('has a unique code per badge, which is what the award is keyed on', () => {
    const codes = AUTO_BADGES.map((badge) => badge.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('explains each badge in a sentence a student would understand', () => {
    for (const badge of AUTO_BADGES) {
      expect(badge.title.length).toBeGreaterThan(3);
      expect(badge.description.length).toBeGreaterThan(15);
    }
  });
});

describe('the campus calendar', () => {
  it('aggregates the five sources the spec names', () => {
    expect([...CALENDAR_KINDS]).toEqual(['HOLIDAY', 'EXAM', 'ASSIGNMENT', 'EVENT', 'FEE']);
  });
});
