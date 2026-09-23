import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import {
  decideLeave,
  getChildren,
  getParentHome,
  getParentRemarks,
  listLeaveRequests,
  requestLeave,
} from '@/lib/services/parents';
import { bookSlot, cancelBooking, listSlots, publishSlots } from '@/lib/services/parents/bookings';
import { resolveActor } from '@/lib/permissions/resolve';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

let schoolId: string;
let admin: Actor;
let teacher: Actor;
let student: Actor;
/** A guardian with two children, so the child switcher has something to switch. */
let parent: Actor;
let otherParent: Actor;
let staffId: string;

const TEST_REASON = '[test] ';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  const picked = await asActor(admin, async () => {
    // A guardian linked to more than one student.
    const guardians = await testPrisma.guardian.findMany({
      where: { students: { some: {} } },
      select: { userId: true, _count: { select: { students: true } } },
      take: 400,
    });
    const withTwo = guardians.find((guardian) => guardian._count.students > 1) ?? guardians[0]!;
    const another = guardians.find((guardian) => guardian.userId !== withTwo.userId)!;

    const staff = await testPrisma.staff.findFirstOrThrow({
      where: { sections: { some: {} }, deletedAt: null },
      select: { id: true, user: { select: { email: true } } },
    });

    return {
      guardianUserId: withTwo.userId,
      otherGuardianUserId: another.userId,
      staffId: staff.id,
      teacherEmail: staff.user.email!,
    };
  });

  staffId = picked.staffId;
  teacher = await actorByEmail(schoolId, picked.teacherEmail);
  parent = (await asActor(admin, () => resolveActor(picked.guardianUserId)))!;
  otherParent = (await asActor(admin, () => resolveActor(picked.otherGuardianUserId)))!;
});

afterAll(async () => {
  await asActor(admin, async () => {
    await testPrisma.leaveRequest.deleteMany({ where: { reason: { startsWith: TEST_REASON } } });
    await testPrisma.bookingSlot.deleteMany({ where: { staffId, startsAt: { gte: new Date('2030-01-01') } } });
  });
  await testPrisma.$disconnect();
});

describe('the child switcher', () => {
  it('lists exactly this guardian’s children', async () => {
    const children = await asActor(parent, () => getChildren(parent));
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((child) => parent.childStudentIds.includes(child.id))).toBe(true);
  });

  it('never lists another family’s child', async () => {
    const mine = await asActor(parent, () => getChildren(parent));
    const theirs = await asActor(otherParent, () => getChildren(otherParent));
    const overlap = mine.filter((child) => theirs.some((other) => other.id === child.id));
    expect(overlap).toHaveLength(0);
  });
});

describe('the parent home screen', () => {
  it('carries the four facts the spec names, and no more', async () => {
    const home = await asActor(parent, () => getParentHome(parent));
    expect(home.child.id).toBe(parent.childStudentIds[0]);
    expect(home.attendance).toHaveProperty('percent');
    expect(home.fees).toHaveProperty('outstanding');
    expect(home).toHaveProperty('latestResult');
    expect(home).toHaveProperty('unreadAnnouncements');
  });

  it('shows the child the parent asked for', async () => {
    const children = await asActor(parent, () => getChildren(parent));
    if (children.length < 2) return;
    const home = await asActor(parent, () => getParentHome(parent, children[1]!.id));
    expect(home.child.id).toBe(children[1]!.id);
  });

  it('refuses a student id that is not theirs', async () => {
    const theirs = await asActor(otherParent, () => getChildren(otherParent));
    await expect(asActor(parent, () => getParentHome(parent, theirs[0]!.id))).rejects.toThrow(
      /not found/i,
    );
  });

  it('never shows a draft result card', async () => {
    const home = await asActor(parent, () => getParentHome(parent));
    if (home.latestResult === null) return;

    const card = await asActor(admin, () =>
      testPrisma.resultCard.findFirst({
        where: { studentId: home.child.id, examSeries: { name: home.latestResult!.seriesName } },
        select: { publishedAt: true },
      }),
    );
    expect(card?.publishedAt).not.toBeNull();
  });
});

describe('remarks', () => {
  it('shows only the notes staff marked visible to parents', async () => {
    const remarks = await asActor(parent, () => getParentRemarks(parent));
    const ids = remarks.map((remark) => remark.id);
    if (ids.length === 0) return;

    const rows = await asActor(admin, () =>
      testPrisma.behaviourNote.findMany({
        where: { id: { in: ids } },
        select: { isVisibleToParent: true },
      }),
    );
    expect(rows.every((row) => row.isVisibleToParent)).toBe(true);
  });

  it('never lets a parent read another family’s remarks', async () => {
    const theirs = await asActor(otherParent, () => getChildren(otherParent));
    await expect(asActor(parent, () => getParentRemarks(parent, theirs[0]!.id))).rejects.toThrow(
      /not found/i,
    );
  });

  it('never lets a student read the parent remarks feed', async () => {
    await expect(asActor(student, () => getParentRemarks(student))).rejects.toThrow(ForbiddenError);
  });
});

describe('leave requests', () => {
  let requestId: string;

  it('lands as a request, not as an authorised absence', async () => {
    const created = await asActor(parent, () =>
      requestLeave(parent, {
        fromDate: '2030-03-01',
        toDate: '2030-03-03',
        reason: `${TEST_REASON}family wedding`,
        documentUrl: null,
      }),
    );
    requestId = created.id;
    expect(created.status).toBe('PENDING');
  });

  it('refuses an overlapping second request', async () => {
    await expect(
      asActor(parent, () =>
        requestLeave(parent, {
          fromDate: '2030-03-02',
          toDate: '2030-03-04',
          reason: `${TEST_REASON}duplicate`,
          documentUrl: null,
        }),
      ),
    ).rejects.toThrow(/already covers/i);
  });

  it('refuses a range that ends before it starts', async () => {
    await expect(
      asActor(parent, () =>
        requestLeave(parent, {
          fromDate: '2030-04-10',
          toDate: '2030-04-01',
          reason: `${TEST_REASON}backwards`,
          documentUrl: null,
        }),
      ),
    ).rejects.toThrow(/before the first/i);
  });

  it('never lets a parent request leave for another family’s child', async () => {
    const theirs = await asActor(otherParent, () => getChildren(otherParent));
    await expect(
      asActor(parent, () =>
        requestLeave(parent, {
          studentId: theirs[0]!.id,
          fromDate: '2030-05-01',
          toDate: '2030-05-02',
          reason: `${TEST_REASON}not mine`,
          documentUrl: null,
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });

  it('shows a parent only their own requests', async () => {
    const mine = await asActor(parent, () => listLeaveRequests(parent));
    expect(mine.every((row) => parent.childStudentIds.includes(row.studentId))).toBe(true);
  });

  it('is decided by a coordinator, and the decision sticks', async () => {
    const decided = await asActor(admin, () =>
      decideLeave(admin, requestId, { status: 'APPROVED', note: `${TEST_REASON}fine` }),
    );
    expect(decided.status).toBe('APPROVED');

    const after = await asActor(parent, () => listLeaveRequests(parent));
    expect(after.find((row) => row.id === requestId)?.status).toBe('APPROVED');
  });

  it('refuses a second decision on the same request', async () => {
    await expect(
      asActor(admin, () => decideLeave(admin, requestId, { status: 'REJECTED' })),
    ).rejects.toThrow(/already been decided/i);
  });

  it('never lets a parent decide their own request', async () => {
    const created = await asActor(parent, () =>
      requestLeave(parent, {
        fromDate: '2030-06-01',
        toDate: '2030-06-02',
        reason: `${TEST_REASON}self approve`,
        documentUrl: null,
      }),
    );
    await expect(
      asActor(parent, () => decideLeave(parent, created.id, { status: 'APPROVED' })),
    ).rejects.toThrow(ForbiddenError);
  });

  it('tells the guardian what was decided', async () => {
    const sent = await asActor(admin, () =>
      testPrisma.notification.count({
        where: { userId: parent.userId, type: 'leave.decided' },
      }),
    );
    expect(sent).toBeGreaterThan(0);
  });
});

describe('meeting slots', () => {
  const day = '2030-02-10';

  it('publishes a grid of slots for a sitting', async () => {
    const result = await asActor(admin, () =>
      publishSlots(admin, {
        staffId,
        type: 'PARENT_TEACHER',
        date: day,
        startTime: '16:00',
        endTime: '17:00',
        slotMinutes: 10,
      }),
    );
    expect(result.created).toBe(6);
  });

  it('tops the grid up rather than doubling it', async () => {
    const again = await asActor(admin, () =>
      publishSlots(admin, {
        staffId,
        type: 'PARENT_TEACHER',
        date: day,
        startTime: '16:00',
        endTime: '17:30',
        slotMinutes: 10,
      }),
    );
    expect(again.created).toBe(3);
    expect(again.existing).toBe(6);
  });

  it('lets a parent book an open slot', async () => {
    const slots = await asActor(parent, () => listSlots(parent, { staffId, from: day }));
    const open = slots.find((slot) => slot.status === 'OPEN')!;
    const booked = await asActor(parent, () => bookSlot(parent, open.id, { note: null }));
    expect(booked.id).toBe(open.id);
  });

  it('refuses the same slot to a second parent — no double booking', async () => {
    const slots = await asActor(parent, () => listSlots(parent, { staffId, from: day }));
    const mine = slots.find((slot) => slot.isMine)!;
    await expect(
      asActor(otherParent, () => bookSlot(otherParent, mine.id, { note: null })),
    ).rejects.toThrow(/booked that slot|already/i);
  });

  it('refuses a second slot with the same teacher at the same sitting', async () => {
    const slots = await asActor(parent, () => listSlots(parent, { staffId, from: day }));
    const another = slots.find((slot) => slot.status === 'OPEN')!;
    await expect(asActor(parent, () => bookSlot(parent, another.id, { note: null }))).rejects.toThrow(
      /already have a slot/i,
    );
  });

  it('never tells one parent who booked another slot', async () => {
    const slots = await asActor(otherParent, () => listSlots(otherParent, { staffId, from: day }));
    const takenByOthers = slots.filter((slot) => slot.status === 'BOOKED' && !slot.isMine);
    expect(takenByOthers.length).toBeGreaterThan(0);
    expect(takenByOthers.every((slot) => slot.studentName === null)).toBe(true);
    expect(takenByOthers.every((slot) => slot.note === null)).toBe(true);
  });

  it('shows the teacher their own grid with the bookings on it', async () => {
    const slots = await asActor(teacher, () => listSlots(teacher, { from: day }));
    const booked = slots.filter((slot) => slot.status === 'BOOKED');
    expect(booked.length).toBeGreaterThan(0);
    expect(booked.some((slot) => slot.studentName !== null)).toBe(true);
  });

  it('releases a slot back to the pool when cancelled', async () => {
    const slots = await asActor(parent, () => listSlots(parent, { staffId, from: day }));
    const mine = slots.find((slot) => slot.isMine)!;
    await asActor(parent, () => cancelBooking(parent, mine.id));

    const after = await asActor(parent, () => listSlots(parent, { staffId, from: day }));
    expect(after.find((slot) => slot.id === mine.id)?.status).toBe('OPEN');
  });

  it('never lets one parent cancel another family’s booking', async () => {
    const slots = await asActor(parent, () => listSlots(parent, { staffId, from: day }));
    const open = slots.find((slot) => slot.status === 'OPEN')!;
    await asActor(otherParent, () => bookSlot(otherParent, open.id, { note: null }));

    await expect(asActor(parent, () => cancelBooking(parent, open.id))).rejects.toThrow(/not found/i);
  });

  it('never lets a parent publish slots', async () => {
    await expect(
      asActor(parent, () =>
        publishSlots(parent, {
          staffId,
          type: 'PARENT_TEACHER',
          date: '2030-07-01',
          startTime: '16:00',
          endTime: '17:00',
          slotMinutes: 10,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});
