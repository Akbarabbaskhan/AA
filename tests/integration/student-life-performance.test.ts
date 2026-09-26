import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { getSociety, listSocieties } from '@/lib/services/societies';
import { getAttendees, listEvents } from '@/lib/services/events';
import { getCalendar } from '@/lib/services/calendar';
import { EFFORT_METRICS, getHouseStandings, getLeaderboard } from '@/lib/services/recognition';
import { listCareerItems, listDocumentRequests } from '@/lib/services/careers';
import { getDigitalId, getLocker, getProfile } from '@/lib/services/identity';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

/**
 * The student-life read budget, measured rather than assumed.
 *
 * Same rule as the learning and finance budgets: "every screen that a person opens more
 * than once a day answers in under 300ms at p95 on the seeded volume." These are the
 * screens a student opens at break — the calendar, the leaderboard, the society directory —
 * so they are the ones that must not crawl.
 *
 * The leaderboard is the one to watch. It counts effort across the whole campus from a
 * window function over attendance, and the temptation to pull rows into JavaScript and
 * count them there would pass a test on an empty database and fail at 09:40 on a Monday.
 */

const BUDGET_MS = 300;
const RUNS = 12;

let schoolId: string;
let student: Actor;
let teacher: Actor;
let admin: Actor;
let societyId: string;
let eventId: string;

async function p95(label: string, run: () => Promise<unknown>): Promise<number> {
  // One warm-up: the first call pays for the connection and the query plan, which is not
  // what a student's second visit of the day pays.
  await run();

  const samples: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const value = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!;
  console.log(`  ${label.padEnd(28)} ${value.toFixed(0)}ms p95`);
  return value;
}

beforeAll(async () => {
  schoolId = await getSchoolId();
  admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  student = await actorForStudentRoll(schoolId, 'AS1-0001');

  const picked = await asActor(admin, async () => {
    const society = await testPrisma.society.findFirstOrThrow({
      where: { members: { some: {} } },
      orderBy: { name: 'asc' },
      select: { id: true },
    });
    const event = await testPrisma.event.findFirstOrThrow({
      where: { rsvps: { some: {} } },
      select: { id: true },
    });
    const staff = await testPrisma.user.findFirstOrThrow({
      where: { roles: { some: { role: 'TEACHER' } }, staff: { sections: { some: {} } } },
      select: { email: true },
    });
    return { societyId: society.id, eventId: event.id, teacherEmail: staff.email! };
  });

  societyId = picked.societyId;
  eventId = picked.eventId;
  teacher = await actorByEmail(schoolId, picked.teacherEmail);
});

describe('student life read budgets', () => {
  it('lists the society directory inside the budget', async () => {
    const value = await p95('societies', () => asActor(student, () => listSocieties(student)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('opens one society inside the budget', async () => {
    const value = await p95('society detail', () =>
      asActor(student, () => getSociety(student, societyId)),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('lists events inside the budget', async () => {
    const value = await p95('events', () =>
      asActor(student, () => listEvents(student, { mineOnly: false, limit: 50 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('lists one event’s attendees and waitlist inside the budget', async () => {
    const value = await p95('event attendees', () =>
      asActor(teacher, () => getAttendees(teacher, eventId)),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('builds the whole campus calendar inside the budget', async () => {
    // Five sources unioned — holidays, exams, assignments, events, fee due dates.
    const value = await p95('calendar (all)', () =>
      asActor(student, () => getCalendar(student, { mineOnly: false })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('builds the personal calendar inside the budget', async () => {
    const value = await p95('calendar (mine)', () =>
      asActor(student, () => getCalendar(student, { mineOnly: true })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('ranks every effort metric inside the budget', async () => {
    for (const metric of EFFORT_METRICS) {
      const value = await p95(`leaderboard ${metric.toLowerCase()}`, () =>
        asActor(student, () => getLeaderboard(student, { metric, windowDays: 30, limit: 10 })),
      );
      expect(value).toBeLessThan(BUDGET_MS);
    }
  });

  it('ranks a year of effort inside the budget', async () => {
    // The widest window the API allows, which is the one a curious student picks.
    const value = await p95('leaderboard 365d', () =>
      asActor(student, () =>
        getLeaderboard(student, { metric: 'ATTENDANCE_STREAK', windowDays: 365, limit: 50 }),
      ),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('totals the house standings inside the budget', async () => {
    const value = await p95('house standings', () =>
      asActor(student, () => getHouseStandings(student)),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('lists the career corner inside the budget', async () => {
    const value = await p95('career corner', () =>
      asActor(student, () => listCareerItems(student, { includePast: false, limit: 100 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('opens the office’s document queue inside the budget', async () => {
    const value = await p95('document queue', () =>
      asActor(admin, () => listDocumentRequests(admin, { mineOnly: false, limit: 100 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('opens a student’s profile inside the budget', async () => {
    const value = await p95('profile', () => asActor(student, () => getProfile(student)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('mints an ID card inside the budget', async () => {
    const value = await p95('digital id', () => asActor(student, () => getDigitalId(student)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('opens the locker inside the budget', async () => {
    const value = await p95('locker', () => asActor(student, () => getLocker(student)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('holds up when a year group opens the leaderboard at once', async () => {
    // The minute after an assembly where the house cup was mentioned.
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 30 }, () =>
        asActor(student, () =>
          getLeaderboard(student, { metric: 'PAPERS', windowDays: 30, limit: 10 }),
        ),
      ),
    );
    const elapsed = performance.now() - started;
    console.log(`  ${'leaderboard × 30'.padEnd(28)} ${elapsed.toFixed(0)}ms total`);
    expect(elapsed).toBeLessThan(5_000);
  });
});
