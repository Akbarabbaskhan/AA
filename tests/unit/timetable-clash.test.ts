import { describe, expect, it } from 'vitest';
import {
  findClashes,
  validatePlacement,
  type SlotPlacement,
} from '@/lib/services/timetable-clash';

const slot = (overrides: Partial<SlotPlacement> & { sectionId: string }): SlotPlacement => ({
  dayOfWeek: 1,
  periodIndex: 1,
  teacherId: null,
  roomId: null,
  ...overrides,
});

describe('timetable clash detection', () => {
  it('finds nothing in an empty or single-section timetable', () => {
    expect(findClashes([])).toEqual([]);
    expect(findClashes([slot({ sectionId: 'a', teacherId: 't1', roomId: 'r1' })])).toEqual([]);
  });

  it('catches a double-booked teacher', () => {
    const clashes = findClashes([
      slot({ sectionId: 'a', teacherId: 't1', roomId: 'r1' }),
      slot({ sectionId: 'b', teacherId: 't1', roomId: 'r2' }),
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]?.axis).toBe('teacher');
    expect(clashes[0]?.sectionIds.sort()).toEqual(['a', 'b']);
    expect(clashes[0]?.message).toContain('day 1 period 1');
  });

  it('catches a double-booked room', () => {
    const clashes = findClashes([
      slot({ sectionId: 'a', teacherId: 't1', roomId: 'r1' }),
      slot({ sectionId: 'b', teacherId: 't2', roomId: 'r1' }),
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]?.axis).toBe('room');
  });

  it('catches a student-cohort clash, which is the one that is hard by hand', () => {
    // Two subjects a student takes, scheduled in the same period. No teacher or room is
    // double-booked here, so only the third axis sees it.
    const clashes = findClashes(
      [
        slot({ sectionId: 'chem-a', teacherId: 't1', roomId: 'r1' }),
        slot({ sectionId: 'phys-a', teacherId: 't2', roomId: 'r2' }),
      ],
      new Map([['stu-1', ['chem-a', 'phys-a']]]),
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0]?.axis).toBe('cohort');
    expect(clashes[0]?.subjectId).toBe('stu-1');
  });

  it('does not flag concurrent sections a student does not share', () => {
    const clashes = findClashes(
      [
        slot({ sectionId: 'chem-a', teacherId: 't1', roomId: 'r1' }),
        slot({ sectionId: 'chem-b', teacherId: 't2', roomId: 'r2' }),
      ],
      new Map([
        ['stu-1', ['chem-a']],
        ['stu-2', ['chem-b']],
      ]),
    );
    expect(clashes).toEqual([]);
  });

  it('reports all three axes at once when a slot is thoroughly broken', () => {
    const clashes = findClashes(
      [
        slot({ sectionId: 'a', teacherId: 't1', roomId: 'r1' }),
        slot({ sectionId: 'b', teacherId: 't1', roomId: 'r1' }),
      ],
      new Map([['stu-1', ['a', 'b']]]),
    );
    expect(clashes.map((clash) => clash.axis).sort()).toEqual(['cohort', 'room', 'teacher']);
  });

  it('keeps different periods and different days apart', () => {
    expect(
      findClashes([
        slot({ sectionId: 'a', teacherId: 't1', roomId: 'r1', periodIndex: 1 }),
        slot({ sectionId: 'b', teacherId: 't1', roomId: 'r1', periodIndex: 2 }),
      ]),
    ).toEqual([]);

    expect(
      findClashes([
        slot({ sectionId: 'a', teacherId: 't1', roomId: 'r1', dayOfWeek: 1 }),
        slot({ sectionId: 'b', teacherId: 't1', roomId: 'r1', dayOfWeek: 2 }),
      ]),
    ).toEqual([]);
  });

  describe('validatePlacement', () => {
    const existing: SlotPlacement[] = [
      slot({ sectionId: 'chem-a', teacherId: 't1', roomId: 'r1' }),
      slot({ sectionId: 'phys-a', teacherId: 't2', roomId: 'r2', periodIndex: 2 }),
    ];

    it('blocks a placement that collides and names the conflict', () => {
      const clashes = validatePlacement(
        slot({ sectionId: 'bio-a', teacherId: 't1', roomId: 'r9' }),
        existing,
      );
      expect(clashes).toHaveLength(1);
      expect(clashes[0]?.axis).toBe('teacher');
      expect(clashes[0]?.message).toMatch(/Teacher is already teaching/);
    });

    it('allows a placement in a free slot', () => {
      expect(
        validatePlacement(
          slot({ sectionId: 'bio-a', teacherId: 't3', roomId: 'r9', periodIndex: 5 }),
          existing,
        ),
      ).toEqual([]);
    });

    it('only reports clashes involving the section being moved', () => {
      const broken: SlotPlacement[] = [
        slot({ sectionId: 'x', teacherId: 't8', roomId: 'r8' }),
        slot({ sectionId: 'y', teacherId: 't8', roomId: 'r8' }),
      ];
      // x and y already clash with each other; moving z into period 4 is fine and must not
      // inherit their problem.
      const clashes = validatePlacement(
        slot({ sectionId: 'z', teacherId: 't9', roomId: 'r9', periodIndex: 4 }),
        broken,
      );
      expect(clashes).toEqual([]);
    });

    it('lets a section stay where it already is', () => {
      const clashes = validatePlacement(
        slot({ sectionId: 'chem-a', teacherId: 't1', roomId: 'r1' }),
        existing,
      );
      expect(clashes).toEqual([]);
    });
  });
});
