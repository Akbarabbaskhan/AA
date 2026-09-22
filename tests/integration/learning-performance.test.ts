import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { listPapers, getVaultFacets } from '@/lib/services/papers/vault';
import { getPracticeTrend } from '@/lib/services/papers/practice';
import { listQuizzes } from '@/lib/services/quizzes/quiz';
import { getQuizAnalysis } from '@/lib/services/quizzes/analysis';
import { getWeaknessMap } from '@/lib/services/quizzes/mastery';
import { listAssignments } from '@/lib/services/assignments';
import { listResources } from '@/lib/services/resources';
import { actorByEmail, actorForStudentRoll, asActor, getSchoolId, testPrisma } from '../helpers';

/**
 * The read budget, measured rather than assumed.
 *
 * "Every screen that a person opens more than once a day answers in under 300ms at p95 on
 * the seeded volume." These run against the real seeded tenant — four hundred papers, a
 * few hundred attempts, forty quizzes — because a budget met on an empty database is not a
 * budget.
 */

const BUDGET_MS = 300;
const RUNS = 12;

let schoolId: string;
let student: Actor;
let teacher: Actor;
let admin: Actor;
let quizId: string;

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

  const picked = await asActor(admin, async () => {
    const quiz = await testPrisma.quiz.findFirstOrThrow({
      where: { attempts: { some: { submittedAt: { not: null } } } },
      select: { id: true, section: { select: { teacherId: true } } },
    });
    const staff = await testPrisma.staff.findFirstOrThrow({
      where: { id: quiz.section.teacherId ?? '' },
      select: { user: { select: { email: true } } },
    });
    return { quizId: quiz.id, teacherEmail: staff.user.email! };
  });

  quizId = picked.quizId;
  teacher = await actorByEmail(schoolId, picked.teacherEmail);
  student = await actorForStudentRoll(schoolId, 'AS1-0001');
});

describe('learning read budgets', () => {
  it('lists the vault inside the budget', async () => {
    const value = await p95('vault list', () => asActor(student, () => listPapers(student, { limit: 50 })));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('applies the "never attempted" filter inside the budget', async () => {
    // The expensive shape: it has to know this student's whole attempt history.
    const value = await p95('vault unattempted', () =>
      asActor(student, () => listPapers(student, { limit: 50, onlyUnattempted: true })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('builds the vault facets inside the budget', async () => {
    const value = await p95('vault facets', () => asActor(student, () => getVaultFacets(student)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('draws the practice trend inside the budget', async () => {
    const value = await p95('practice trend', () => asActor(student, () => getPracticeTrend(student)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('lists a student’s quizzes inside the budget', async () => {
    const value = await p95('quiz list (student)', () => asActor(student, () => listQuizzes(student)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('builds a quiz analysis inside the budget', async () => {
    const value = await p95('quiz analysis', () => asActor(teacher, () => getQuizAnalysis(teacher, quizId)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('builds the weakness map inside the budget', async () => {
    const value = await p95('weakness map', () =>
      asActor(student, () => getWeaknessMap(student.studentId!)),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('lists assignments inside the budget', async () => {
    const value = await p95('assignments', () =>
      asActor(student, () => listAssignments(student, { scope: 'ALL' })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('lists resources inside the budget', async () => {
    const value = await p95('resources', () =>
      asActor(student, () => listResources(student, { includeSuperseded: false, limit: 60 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('holds up when a whole class opens the vault at once', async () => {
    // Thirty students hitting the same screen in the minute a teacher says "revise".
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 30 }, () => asActor(student, () => listPapers(student, { limit: 50 }))),
    );
    const elapsed = performance.now() - started;
    console.log(`  ${'vault × 30 concurrent'.padEnd(28)} ${elapsed.toFixed(0)}ms total`);
    expect(elapsed).toBeLessThan(5_000);
  });
});
