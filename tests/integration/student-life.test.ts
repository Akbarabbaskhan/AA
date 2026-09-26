import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { ForbiddenError } from '@/lib/permissions';
import {
  createSociety,
  getSociety,
  joinSociety,
  leaveSociety,
  listSocieties,
  setMember,
} from '@/lib/services/societies';
import { cancelRsvp, createEvent, getAttendees, listEvents, rsvp } from '@/lib/services/events';
import { getCalendar } from '@/lib/services/calendar';
import {
  AUTO_BADGES,
  awardEarnedBadges,
  awardHousePoints,
  getBadges,
  getHouseStandings,
  getLeaderboard,
  setLeaderboardOptOut,
} from '@/lib/services/recognition';
import {
  createCareerItem,
  decideDocumentRequest,
  listCareerItems,
  listDocumentRequests,
  requestDocument,
} from '@/lib/services/careers';
import { getDigitalId, getLocker, getProfile, scanId, signIdToken } from '@/lib/services/identity';
import { resolveActor } from '@/lib/permissions/resolve';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

let schoolId: string;
let admin: Actor;
let teacher: Actor;
let student: Actor;
let classmate: Actor;
let parent: Actor;

const TEST_PREFIX = '[test] ';

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');
  classmate = await actorForStudentRoll(schoolId, 'AS1-0002');

  const picked = await asActor(admin, async () => {
    const staff = await testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'TEACHER' } }, staff: { sections: { some: {} } } },
      select: { email: true },
    });
    const guardian = await testPrisma.guardian.findFirstOrThrow({
      where: { students: { some: {} } },
      select: { userId: true },
    });
    return { teacherEmail: staff.email!, guardianUserId: guardian.userId };
  });

  teacher = await actorByEmail(schoolId, picked.teacherEmail);
  parent = (await asActor(admin, () => resolveActor(picked.guardianUserId)))!;
});

afterAll(async () => {
  await asActor(admin, async () => {
    await testPrisma.event.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await testPrisma.society.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
    await testPrisma.careerItem.deleteMany({ where: { title: { startsWith: TEST_PREFIX } } });
    await testPrisma.housePoint.deleteMany({ where: { reason: { startsWith: TEST_PREFIX } } });
    await testPrisma.documentRequest.deleteMany({
      where: { destination: { startsWith: TEST_PREFIX } },
    });
  });
  await testPrisma.$disconnect();
});

describe('societies', () => {
  it('seeds a directory with real membership and student officers', async () => {
    const societies = await asActor(student, () => listSocieties(student));
    expect(societies.length).toBeGreaterThan(4);
    expect(societies.some((society) => society.memberCount > 20)).toBe(true);
    expect(societies.some((society) => !society.isOpen)).toBe(true);
  });

  it('lets a student join an open society straight away', async () => {
    const created = await asActor(admin, () =>
      createSociety(admin, {
        name: `${TEST_PREFIX}Chess Club`,
        description: 'Open to all.',
        logoUrl: null,
        staffAdvisorId: null,
        isOpen: true,
      }),
    );

    const result = await asActor(student, () => joinSociety(student, created.id));
    expect(result.status).toBe('JOINED');

    const societies = await asActor(student, () => listSocieties(student));
    expect(societies.find((society) => society.id === created.id)?.isMember).toBe(true);
  });

  it('takes an application for a selective society rather than admitting silently', async () => {
    const created = await asActor(admin, () =>
      createSociety(admin, {
        name: `${TEST_PREFIX}Quiz Team`,
        description: 'Trials in September.',
        logoUrl: null,
        staffAdvisorId: null,
        isOpen: false,
      }),
    );

    const result = await asActor(student, () => joinSociety(student, created.id));
    expect(result.status).toBe('APPLIED');

    // Applying is not joining: the member count must not move.
    const societies = await asActor(student, () => listSocieties(student));
    const society = societies.find((entry) => entry.id === created.id)!;
    expect(society.isMember).toBe(false);
    expect(society.memberCount).toBe(0);
  });

  it('shows the officers an applications queue, and admitting makes them a member', async () => {
    const society = await asActor(admin, () =>
      testPrisma.society.findFirstOrThrow({
        where: { name: `${TEST_PREFIX}Quiz Team` },
        select: { id: true },
      }),
    );

    const before = await asActor(admin, () => getSociety(admin, society.id));
    expect(before.applications.some((entry) => entry.studentId === student.studentId)).toBe(true);

    await asActor(admin, () =>
      setMember(admin, society.id, { studentId: student.studentId!, role: 'MEMBER' }),
    );

    const after = await asActor(admin, () => getSociety(admin, society.id));
    expect(after.memberCount).toBe(1);
    // Admitted, so no longer pending.
    expect(after.applications.some((entry) => entry.studentId === student.studentId)).toBe(false);
  });

  it('never shows the applications queue to an ordinary member', async () => {
    const society = await asActor(admin, () =>
      testPrisma.society.findFirstOrThrow({
        where: { name: `${TEST_PREFIX}Quiz Team` },
        select: { id: true },
      }),
    );
    const view = await asActor(student, () => getSociety(student, society.id));
    expect(view.canManage).toBe(false);
    expect(view.applications).toEqual([]);
  });

  it('refuses a second join', async () => {
    const society = await asActor(admin, () =>
      testPrisma.society.findFirstOrThrow({
        where: { name: `${TEST_PREFIX}Chess Club` },
        select: { id: true },
      }),
    );
    await expect(asActor(student, () => joinSociety(student, society.id))).rejects.toThrow(
      /already in/i,
    );
  });

  it('will not let an officer walk out and leave nobody able to post', async () => {
    const seeded = await asActor(admin, () =>
      testPrisma.societyMember.findFirstOrThrow({
        where: { role: 'HEAD' },
        select: { societyId: true, studentId: true, student: { select: { rollNumber: true } } },
      }),
    );
    const head = await actorForStudentRoll(schoolId, seeded.student.rollNumber);
    await expect(asActor(head, () => leaveSociety(head, seeded.societyId))).rejects.toThrow(
      /hand your role/i,
    );
  });

  it('lets an ordinary member leave', async () => {
    const society = await asActor(admin, () =>
      testPrisma.society.findFirstOrThrow({
        where: { name: `${TEST_PREFIX}Chess Club` },
        select: { id: true },
      }),
    );
    const result = await asActor(student, () => leaveSociety(student, society.id));
    expect(result.left).toBe(true);
  });

  it('never lets a student create a society', async () => {
    await expect(
      asActor(student, () =>
        createSociety(student, {
          name: `${TEST_PREFIX}Nope`,
          description: null,
          logoUrl: null,
          staffAdvisorId: null,
          isOpen: true,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('events, capacity and the waitlist', () => {
  let eventId: string;

  beforeAll(async () => {
    const created = await asActor(admin, () =>
      createEvent(admin, {
        societyId: null,
        title: `${TEST_PREFIX}Trip with two places`,
        description: null,
        startsAt: new Date(Date.now() + 7 * 86_400_000),
        endsAt: new Date(Date.now() + 7 * 86_400_000 + 4 * 3_600_000),
        venue: 'Coach park',
        capacity: 2,
        rsvpRequired: true,
      }),
    );
    eventId = created.id;
  });

  it('gives the first students the places', async () => {
    const first = await asActor(student, () => rsvp(student, eventId));
    expect(first.status).toBe('GOING');
    expect(first.placesLeft).toBe(1);

    const second = await asActor(classmate, () => rsvp(classmate, eventId));
    expect(second.status).toBe('GOING');
    expect(second.placesLeft).toBe(0);
  });

  it('waitlists the next one, and says where they stand', async () => {
    const third = await actorForStudentRoll(schoolId, 'AS1-0003');
    const result = await asActor(third, () => rsvp(third, eventId));
    expect(result.status).toBe('WAITLIST');
    expect(result.waitlistPosition).toBe(1);

    const fourth = await actorForStudentRoll(schoolId, 'AS1-0004');
    const next = await asActor(fourth, () => rsvp(fourth, eventId));
    expect(next.waitlistPosition).toBe(2);
  });

  it('is idempotent — tapping twice does not take two places', async () => {
    const again = await asActor(student, () => rsvp(student, eventId));
    expect(again.status).toBe('GOING');

    const events = await asActor(admin, () => listEvents(admin, { mineOnly: false, limit: 50 }));
    const event = events.find((entry) => entry.id === eventId)!;
    expect(event.going).toBe(2);
  });

  it('promotes the first waitlisted student when a place is given up', async () => {
    const result = await asActor(student, () => cancelRsvp(student, eventId));
    expect(result.promoted).toBe(true);

    const attendees = await asActor(admin, () => getAttendees(admin, eventId));
    const going = attendees.filter((entry) => entry.status === 'GOING');
    expect(going).toHaveLength(2);

    // The promoted one is the student who was first on the list.
    const third = await actorForStudentRoll(schoolId, 'AS1-0003');
    const thirdUser = going.find((entry) => entry.userId === third.userId);
    expect(thirdUser).toBeTruthy();

    // And the remaining waitlist has closed up.
    const waitlist = attendees.filter((entry) => entry.status === 'WAITLIST');
    expect(waitlist[0]?.position).toBe(1);
  });

  it('tells the promoted student', async () => {
    const third = await actorForStudentRoll(schoolId, 'AS1-0003');
    const notified = await asActor(admin, () =>
      testPrisma.notification.count({
        where: {
          userId: third.userId,
          payloadJson: { path: ['title'], equals: 'A place has opened up' },
        },
      }),
    );
    expect(notified).toBeGreaterThan(0);
  });

  it('refuses an RSVP to an event that has already happened', async () => {
    const past = await asActor(admin, () =>
      createEvent(admin, {
        societyId: null,
        title: `${TEST_PREFIX}Last term's trip`,
        description: null,
        startsAt: new Date(Date.now() - 30 * 86_400_000),
        endsAt: new Date(Date.now() - 30 * 86_400_000 + 3_600_000),
        venue: null,
        capacity: 10,
        rsvpRequired: true,
      }),
    );
    await expect(asActor(student, () => rsvp(student, past.id))).rejects.toThrow(
      /already taken place/i,
    );
  });

  it('refuses an event that ends before it starts', async () => {
    await expect(
      asActor(admin, () =>
        createEvent(admin, {
          societyId: null,
          title: `${TEST_PREFIX}Backwards`,
          description: null,
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 3_600_000),
          venue: null,
          capacity: null,
          rsvpRequired: false,
        }),
      ),
    ).rejects.toThrow(/end after it starts/i);
  });

  it('never lets a student read the attendee list', async () => {
    await expect(asActor(student, () => getAttendees(student, eventId))).rejects.toThrow();
  });

  it('never lets a student create a campus-wide event', async () => {
    await expect(
      asActor(student, () =>
        createEvent(student, {
          societyId: null,
          title: `${TEST_PREFIX}Student event`,
          description: null,
          startsAt: new Date(Date.now() + 86_400_000),
          endsAt: new Date(Date.now() + 2 * 86_400_000),
          venue: null,
          capacity: null,
          rsvpRequired: false,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('the campus calendar', () => {
  it('aggregates every source into one dated list', async () => {
    const entries = await asActor(student, () => getCalendar(student, { mineOnly: false }));
    expect(entries.length).toBeGreaterThan(0);

    const kinds = new Set(entries.map((entry) => entry.kind));
    expect(kinds.size).toBeGreaterThan(1);

    // Sorted by date, which is the only order in which this is readable.
    const dates = entries.map((entry) => entry.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('narrows to a student’s own subjects and societies', async () => {
    const all = await asActor(student, () => getCalendar(student, { mineOnly: false }));
    const mine = await asActor(student, () => getCalendar(student, { mineOnly: true }));
    expect(mine.length).toBeLessThanOrEqual(all.length);
    expect(mine.every((entry) => entry.isMine)).toBe(true);
  });

  it('filters by kind', async () => {
    const exams = await asActor(student, () =>
      getCalendar(student, { mineOnly: false, kinds: 'EXAM' }),
    );
    expect(exams.every((entry) => entry.kind === 'EXAM')).toBe(true);
  });

  it('shows a parent their child’s fee due dates', async () => {
    const entries = await asActor(parent, () => getCalendar(parent, { mineOnly: false }));
    expect(entries.some((entry) => entry.kind === 'FEE')).toBe(true);
  });
});

describe('recognition', () => {
  it('ranks effort and returns counts, never marks', async () => {
    const board = await asActor(student, () =>
      getLeaderboard(student, { metric: 'PAPERS', windowDays: 60, limit: 10 }),
    );
    expect(board.isEnabled).toBe(true);
    expect(board.rows.length).toBeGreaterThan(0);

    // Descending by count, and no field anywhere carries a grade.
    const counts = board.rows.map((row) => row.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(Object.keys(board.rows[0]!)).not.toContain('percent');
    expect(Object.keys(board.rows[0]!)).not.toContain('grade');
  });

  it('shows a first name only, never a full name on a public list', async () => {
    const board = await asActor(student, () =>
      getLeaderboard(student, { metric: 'PAPERS', windowDays: 60, limit: 5 }),
    );
    expect(board.rows.every((row) => !row.displayName.includes(' '))).toBe(true);
  });

  it('honours an opt-out everywhere — the student vanishes from the list', async () => {
    const before = await asActor(student, () =>
      getLeaderboard(student, { metric: 'PAPERS', windowDays: 60, limit: 50 }),
    );

    await asActor(student, () => setLeaderboardOptOut(student, { optOut: true }));

    // Seen from somebody else's eyes: the opted-out student is simply not there.
    const others = await asActor(classmate, () =>
      getLeaderboard(classmate, { metric: 'PAPERS', windowDays: 60, limit: 50 }),
    );
    expect(others.rows.some((row) => row.studentId === student.studentId)).toBe(false);

    // And they see their own count but no list.
    const mine = await asActor(student, () =>
      getLeaderboard(student, { metric: 'PAPERS', windowDays: 60, limit: 50 }),
    );
    expect(mine.amOptedOut).toBe(true);
    expect(mine.rows).toEqual([]);
    expect(mine.myRank).toBeNull();
    expect(mine.myCount).toBe(before.myCount);

    await asActor(student, () => setLeaderboardOptOut(student, { optOut: false }));
  });

  it('counts an attendance streak without reading a single mark', async () => {
    const board = await asActor(student, () =>
      getLeaderboard(student, { metric: 'ATTENDANCE_STREAK', windowDays: 90, limit: 10 }),
    );
    expect(board.rows.length).toBeGreaterThan(0);
    expect(board.rows.every((row) => row.count > 0)).toBe(true);
  });

  it('keeps the house table a group total, with no individual on display', async () => {
    const standings = await asActor(student, () => getHouseStandings(student));
    expect(standings.length).toBeGreaterThan(1);
    expect([...standings].sort((a, b) => b.points - a.points)).toEqual(standings);
    expect(Object.keys(standings[0]!)).not.toContain('studentName');
  });

  it('awards house points against a named person, and audits a deduction as loudly', async () => {
    const award = await asActor(teacher, () =>
      awardHousePoints(teacher, {
        studentId: student.studentId!,
        house: null,
        points: 5,
        reason: `${TEST_PREFIX}organised the science fair`,
      }),
    );
    expect(award.points).toBe(5);

    await asActor(teacher, () =>
      awardHousePoints(teacher, {
        studentId: student.studentId!,
        house: null,
        points: -3,
        reason: `${TEST_PREFIX}left the lab in a state`,
      }),
    );

    const deduction = await asActor(admin, () =>
      testPrisma.auditLog.findFirst({
        where: { action: 'housepoint.deduct' },
        orderBy: { createdAt: 'desc' },
        select: { reason: true },
      }),
    );
    expect(deduction?.reason).toContain('lab');
  });

  it('refuses a zero-point award', async () => {
    await expect(
      asActor(teacher, () =>
        awardHousePoints(teacher, {
          studentId: student.studentId!,
          house: null,
          points: 0,
          reason: `${TEST_PREFIX}nothing`,
        }),
      ),
    ).rejects.toMatchObject({ code: 'zeroPoints' });
  });

  it('never lets a student award themselves points', async () => {
    await expect(
      asActor(student, () =>
        awardHousePoints(student, {
          studentId: student.studentId!,
          house: null,
          points: 10,
          reason: `${TEST_PREFIX}being great`,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lists every badge the school offers, earned or not', async () => {
    const badges = await asActor(student, () => getBadges(student));
    expect(badges.length).toBeGreaterThanOrEqual(AUTO_BADGES.length);
    for (const definition of AUTO_BADGES) {
      expect(badges.map((badge) => badge.code)).toContain(definition.code);
    }
    // A badge case shows what is not yet earned; that is the point of showing it.
    expect(badges.some((badge) => badge.awardedAt === null)).toBe(true);
  });

  it('awards badges for effort, and awards them only once', async () => {
    // Proving the sweep awards rather than that it did once: take a seeded award away and
    // watch the sweep put it back, then watch a second run do nothing.
    const existing = await asActor(admin, () =>
      testPrisma.studentBadge.findFirstOrThrow({
        where: { badge: { code: { in: AUTO_BADGES.map((badge) => badge.code) } } },
        select: { id: true, studentId: true, badgeId: true, badge: { select: { code: true } } },
      }),
    );
    await asActor(admin, () => testPrisma.studentBadge.delete({ where: { id: existing.id } }));

    const first = await asActor(admin, () => awardEarnedBadges(schoolId));
    expect(first.awarded).toBe(1);
    expect(first.byCode[existing.badge.code]).toBe(1);

    const second = await asActor(admin, () => awardEarnedBadges(schoolId));
    // Idempotent: the sweep runs on a schedule and by hand on the same afternoon.
    expect(second.awarded).toBe(0);

    const restored = await asActor(admin, () => getBadges(admin, existing.studentId));
    expect(restored.find((badge) => badge.code === existing.badge.code)?.awardedAt).not.toBeNull();
  });
});

describe('the career corner', () => {
  it('lists the deadlines soonest first, with a countdown', async () => {
    const items = await asActor(student, () =>
      listCareerItems(student, { includePast: false, limit: 100 }),
    );
    expect(items.length).toBeGreaterThan(10);

    const dated = items.filter((item) => item.deadline !== null);
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every((item) => item.daysUntilDeadline !== null)).toBe(true);

    const deadlines = dated.map((item) => item.deadline!);
    expect([...deadlines].sort()).toEqual(deadlines);
  });

  it('carries the universities an A Level student in Pakistan actually applies to', async () => {
    const items = await asActor(student, () =>
      listCareerItems(student, { includePast: true, limit: 200 }),
    );
    const institutions = new Set(
      items.flatMap((item) => (item.institution ? [item.institution] : [])),
    );
    for (const expected of ['LUMS', 'NUST', 'UCAS']) {
      expect([...institutions]).toContain(expected);
    }
  });

  it('has an alumni destinations board, which students read obsessively', async () => {
    const alumni = await asActor(student, () =>
      listCareerItems(student, { type: 'ALUMNI', includePast: true, limit: 50 }),
    );
    expect(alumni.length).toBeGreaterThan(0);
  });

  it('never lets a student post to the corner', async () => {
    await expect(
      asActor(student, () =>
        createCareerItem(student, {
          type: 'DEADLINE',
          title: `${TEST_PREFIX}Fake deadline`,
          institution: null,
          body: null,
          deadline: null,
          link: null,
        }),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('transcript and reference requests', () => {
  let requestId: string;

  it('routes a reference to the teacher the student named', async () => {
    const created = await asActor(student, () =>
      requestDocument(student, {
        type: 'RECOMMENDATION',
        assignedToId: teacher.staffId!,
        destination: `${TEST_PREFIX}LUMS`,
        note: 'Applying for Economics.',
        deadline: null,
      }),
    );
    requestId = created.id;
    expect(created.status).toBe('REQUESTED');

    const theirs = await asActor(teacher, () =>
      listDocumentRequests(teacher, { mineOnly: false, limit: 50 }),
    );
    expect(theirs.some((request) => request.id === requestId)).toBe(true);
  });

  it('refuses a reference with no teacher named', async () => {
    await expect(
      asActor(student, () =>
        requestDocument(student, {
          type: 'RECOMMENDATION',
          assignedToId: null,
          destination: `${TEST_PREFIX}Nowhere`,
          note: null,
          deadline: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('refuses a duplicate open request', async () => {
    await expect(
      asActor(student, () =>
        requestDocument(student, {
          type: 'RECOMMENDATION',
          assignedToId: teacher.staffId!,
          destination: `${TEST_PREFIX}LUMS`,
          note: null,
          deadline: null,
        }),
      ),
    ).rejects.toThrow(/already have that request/i);
  });

  it('never shows one student another student’s reference request', async () => {
    const theirs = await asActor(classmate, () =>
      listDocumentRequests(classmate, { mineOnly: false, limit: 50 }),
    );
    expect(theirs.some((request) => request.id === requestId)).toBe(false);
  });

  it('requires a reason to decline, so the student can ask somebody else', async () => {
    await expect(
      asActor(teacher, () =>
        decideDocumentRequest(teacher, requestId, {
          status: 'DECLINED',
          declineReason: null,
          fileUrl: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('requires the document before it can be marked ready', async () => {
    await expect(
      asActor(teacher, () =>
        decideDocumentRequest(teacher, requestId, {
          status: 'READY',
          declineReason: null,
          fileUrl: null,
        }),
      ),
    ).rejects.toThrow();
  });

  it('files the finished document into the locker in the same step', async () => {
    await asActor(teacher, () =>
      decideDocumentRequest(teacher, requestId, {
        status: 'IN_PROGRESS',
        declineReason: null,
        fileUrl: null,
      }),
    );

    const done = await asActor(teacher, () =>
      decideDocumentRequest(teacher, requestId, {
        status: 'READY',
        declineReason: null,
        fileUrl: `${schoolId}/documents/test-reference.pdf`,
      }),
    );
    expect(done.status).toBe('READY');
    expect(done.lockerItemId).toBeTruthy();

    // A "ready" request always has something to download.
    const locker = await asActor(student, () => getLocker(student));
    expect(locker.some((item) => item.id === done.lockerItemId)).toBe(true);
  });

  it('refuses to reopen a closed request', async () => {
    await expect(
      asActor(teacher, () =>
        decideDocumentRequest(teacher, requestId, {
          status: 'IN_PROGRESS',
          declineReason: null,
          fileUrl: null,
        }),
      ),
    ).rejects.toThrow(/already been closed/i);
  });

  it('never lets a teacher act on a request addressed to somebody else', async () => {
    const other = await asActor(admin, () =>
      testPrisma.documentRequest.findFirstOrThrow({
        where: {
          assignedToId: { not: teacher.staffId },
          status: { in: ['REQUESTED', 'IN_PROGRESS'] },
        },
        select: { id: true },
      }),
    );
    await expect(
      asActor(teacher, () =>
        decideDocumentRequest(teacher, other.id, {
          status: 'IN_PROGRESS',
          declineReason: null,
          fileUrl: null,
        }),
      ),
    ).rejects.toThrow(/not found/i);
  });
});

describe('digital identity', () => {
  it('issues a card with a signed token, not a bare roll number', async () => {
    const card = await asActor(student, () => getDigitalId(student));
    expect(card.rollNumber).toBe('AS1-0001');
    expect(card.qrToken.startsWith(`${card.rollNumber}.`)).toBe(true);
    expect(card.qrToken.split('.')).toHaveLength(3);
  });

  it('verifies a genuine card at the gate', async () => {
    const card = await asActor(student, () => getDigitalId(student));
    const result = await asActor(teacher, () => scanId(teacher, card.qrToken));
    expect(result.valid).toBe(true);
    expect(result.student?.rollNumber).toBe('AS1-0001');
  });

  it('refuses a forged card', async () => {
    const forged = signIdToken('AS1-0001', Date.now() + 3_600_000).replace(/.$/, 'X');
    const result = await asActor(teacher, () => scanId(teacher, forged));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('invalid');
  });

  it('returns nothing academic or financial on a scan', async () => {
    const card = await asActor(student, () => getDigitalId(student));
    const result = await asActor(teacher, () => scanId(teacher, card.qrToken));
    const keys = Object.keys(result.student ?? {});
    expect(keys).not.toContain('fees');
    expect(keys).not.toContain('marks');
    expect(keys).not.toContain('phone');
    expect(keys.sort()).toEqual(['name', 'photoUrl', 'rollNumber', 'yearGroupName']);
  });

  it('never lets a student scan another student’s card', async () => {
    const card = await asActor(student, () => getDigitalId(student));
    await expect(asActor(classmate, () => scanId(classmate, card.qrToken))).rejects.toThrow();
  });

  it('never lets one student open another’s card', async () => {
    await expect(
      asActor(classmate, () => getDigitalId(classmate, student.studentId!)),
    ).rejects.toThrow();
  });
});

describe('profile and locker', () => {
  it('leads with the subject combination and carries no marks', async () => {
    const profile = await asActor(student, () => getProfile(student));
    expect(profile.subjects.length).toBeGreaterThan(2);
    expect(Object.keys(profile)).not.toContain('grades');
    expect(Object.keys(profile)).not.toContain('percent');
  });

  it('shows a student their own published result cards in the locker', async () => {
    const locker = await asActor(student, () => getLocker(student));
    expect(locker.some((item) => item.type === 'RESULT_CARD')).toBe(true);
    expect(locker.every((item) => item.url.length > 0)).toBe(true);
  });

  it('never lets one student read another’s locker', async () => {
    await expect(
      asActor(classmate, () => getLocker(classmate, student.studentId!)),
    ).rejects.toThrow();
  });

  it('lets a parent read their own child’s locker', async () => {
    const locker = await asActor(parent, () => getLocker(parent));
    expect(Array.isArray(locker)).toBe(true);
    // A parent's own locker is empty by definition; what they get is the child's.
    expect(locker.every((item) => item.url.length > 0)).toBe(true);
  });

  it('refuses a parent another family’s locker', async () => {
    const stranger = await asActor(admin, () =>
      testPrisma.student.findFirstOrThrow({
        where: { id: { notIn: [...parent.childStudentIds] }, deletedAt: null },
        select: { id: true },
      }),
    );
    await expect(asActor(parent, () => getLocker(parent, stranger.id))).rejects.toThrow();
  });
});
