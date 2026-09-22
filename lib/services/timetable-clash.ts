/**
 * Three-axis timetable clash detection.
 *
 * "Clash detection is mandatory and must run on three axes: teacher double-booked, room
 * double-booked, and student-cohort clash. The third is the hard one and is exactly what
 * makes A Level timetabling painful by hand — it is a real differentiator."
 *
 * These are pure functions over plain data so they can be unit-tested exhaustively and
 * reused by the timetable builder, the bulk validator and the seed's own self-check.
 */

export type SlotPlacement = {
  sectionId: string;
  dayOfWeek: number;
  periodIndex: number;
  teacherId: string | null;
  roomId: string | null;
};

export type ClashAxis = 'teacher' | 'room' | 'cohort';

export type Clash = {
  axis: ClashAxis;
  dayOfWeek: number;
  periodIndex: number;
  /** The sections involved, always at least two. */
  sectionIds: string[];
  /** The teacher, room or student the collision is on. */
  subjectId: string;
  /** A message naming the specific conflict, per the acceptance criterion. */
  message: string;
};

function slotKey(placement: Pick<SlotPlacement, 'dayOfWeek' | 'periodIndex'>): string {
  return `${placement.dayOfWeek}:${placement.periodIndex}`;
}

/**
 * Enrolment as the cohort axis needs it: which sections each student attends.
 * Passing a Map keeps the caller free to build it from a query or from memory.
 */
export type StudentSections = ReadonlyMap<string, readonly string[]>;

export function findClashes(
  placements: readonly SlotPlacement[],
  studentSections: StudentSections = new Map(),
): Clash[] {
  const clashes: Clash[] = [];
  const bySlot = new Map<string, SlotPlacement[]>();

  for (const placement of placements) {
    const key = slotKey(placement);
    const list = bySlot.get(key) ?? [];
    list.push(placement);
    bySlot.set(key, list);
  }

  for (const [, inSlot] of bySlot) {
    const first = inSlot[0];
    if (!first) continue;
    const { dayOfWeek, periodIndex } = first;

    // Teacher double-booked.
    const byTeacher = new Map<string, string[]>();
    for (const placement of inSlot) {
      if (!placement.teacherId) continue;
      const list = byTeacher.get(placement.teacherId) ?? [];
      list.push(placement.sectionId);
      byTeacher.set(placement.teacherId, list);
    }
    for (const [teacherId, sectionIds] of byTeacher) {
      // One section legitimately occupies a slot more than once only if the data is
      // duplicated; distinct sections are the real clash.
      const distinct = [...new Set(sectionIds)];
      if (distinct.length > 1) {
        clashes.push({
          axis: 'teacher',
          dayOfWeek,
          periodIndex,
          sectionIds: distinct,
          subjectId: teacherId,
          message: `Teacher is already teaching another section in day ${dayOfWeek} period ${periodIndex}`,
        });
      }
    }

    // Room double-booked.
    const byRoom = new Map<string, string[]>();
    for (const placement of inSlot) {
      if (!placement.roomId) continue;
      const list = byRoom.get(placement.roomId) ?? [];
      list.push(placement.sectionId);
      byRoom.set(placement.roomId, list);
    }
    for (const [roomId, sectionIds] of byRoom) {
      const distinct = [...new Set(sectionIds)];
      if (distinct.length > 1) {
        clashes.push({
          axis: 'room',
          dayOfWeek,
          periodIndex,
          sectionIds: distinct,
          subjectId: roomId,
          message: `Room is already in use in day ${dayOfWeek} period ${periodIndex}`,
        });
      }
    }

    // Student-cohort clash: a student enrolled in two sections scheduled together.
    if (studentSections.size > 0) {
      const sectionsHere = new Set(inSlot.map((placement) => placement.sectionId));
      for (const [studentId, sections] of studentSections) {
        const collisions = sections.filter((sectionId) => sectionsHere.has(sectionId));
        if (collisions.length > 1) {
          clashes.push({
            axis: 'cohort',
            dayOfWeek,
            periodIndex,
            sectionIds: [...new Set(collisions)],
            subjectId: studentId,
            message: `A student is enrolled in ${collisions.length} sections scheduled in day ${dayOfWeek} period ${periodIndex}`,
          });
        }
      }
    }
  }

  return clashes;
}

/**
 * Checks one proposed placement against everything already timetabled.
 *
 * This is what the builder calls on a drag-and-drop: "attempting to place a section in a
 * slot that clashes on any of the three axes is blocked with a message naming the specific
 * conflict."
 */
export function validatePlacement(
  candidate: SlotPlacement,
  existing: readonly SlotPlacement[],
  studentSections: StudentSections = new Map(),
): Clash[] {
  const others = existing.filter(
    (placement) =>
      !(
        placement.sectionId === candidate.sectionId &&
        placement.dayOfWeek === candidate.dayOfWeek &&
        placement.periodIndex === candidate.periodIndex
      ),
  );

  return findClashes([...others, candidate], studentSections).filter((clash) =>
    clash.sectionIds.includes(candidate.sectionId),
  );
}
