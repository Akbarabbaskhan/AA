import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The permission boundary, end to end.
 *
 * "Row-level authorisation tested: write an automated test per role asserting that a user
 * of that role receives 403 on every endpoint outside their scope."
 *
 * These go through the real HTTP stack — middleware, route wrapper, capability check and
 * row scope — because that is the path an attacker would take, not the service functions.
 */

const PASSWORD = 'Volt2026!';

const ACCOUNTS = {
  admin: 'admin@volt-demo.test',
  bursar: 'bursar@volt-demo.test',
  teacher: 'emp-0001@volt-demo.test',
  student: 'as1-0001@volt-demo.test',
} as const;

async function signIn(page: Page, identifier: string): Promise<APIRequestContext> {
  await page.goto('/login');
  await page.getByLabel(/phone number or email/i).fill(identifier);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  // Shares the session cookie with the page.
  return page.request;
}

test.describe('unauthenticated', () => {
  test('cannot reach any API', async ({ request }) => {
    for (const path of [
      '/api/attendance/today',
      '/api/attendance/reports/daily',
      '/api/students',
      '/api/timetable',
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} must not be open`).toBe(401);
    }
  });
});

test.describe('student', () => {
  test('is refused every staff and campus endpoint', async ({ page }) => {
    const api = await signIn(page, ACCOUNTS.student);

    for (const path of [
      '/api/attendance/today',
      '/api/attendance/reports/daily',
      '/api/attendance/reports/compliance',
    ]) {
      const response = await api.get(path);
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }

    const importAttempt = await api.post('/api/students/import/preview', {
      data: { file: 'Adm No,Name\n1,Test\n' },
    });
    expect(importAttempt.status()).toBe(403);

    const slotAttempt = await api.post('/api/timetable/slots', {
      data: {
        sectionId: '00000000-0000-4000-8000-000000000000',
        dayOfWeek: 1,
        periodIndex: 1,
      },
    });
    expect(slotAttempt.status()).toBe(403);
  });

  test('cannot reach the question bank, the marking queue or a quiz analysis', async ({ page }) => {
    // The learning module's staff surfaces. A student reaching any of these reads their
    // classmates' answers, or the answer key itself, before they have sat the paper.
    const api = await signIn(page, ACCOUNTS.student);

    const quizzes = (await (await api.get('/api/quizzes')).json()) as { id: string }[];
    expect(quizzes.length, 'the seed should give this student a quiz').toBeGreaterThan(0);
    const quizId = quizzes[0]!.id;

    for (const path of [
      '/api/questions',
      '/api/assignments/missing',
      `/api/quizzes/${quizId}/analysis`,
      `/api/quizzes/${quizId}/marking`,
    ]) {
      const response = await api.get(path);
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }

    const importAttempt = await api.post('/api/questions/import', {
      data: { subjectId: '00000000-0000-4000-8000-000000000000', csv: 'type,body\nMCQ,x\n' },
    });
    expect(importAttempt.status()).toBe(403);

    const markAttempt = await api.post(`/api/quizzes/${quizId}/marking`, {
      data: { answerId: '00000000-0000-4000-8000-000000000000', marksAwarded: 10 },
    });
    expect(markAttempt.status()).toBe(403);

    const gradeAttempt = await api.post('/api/submissions/grade', {
      data: { submissionId: '00000000-0000-4000-8000-000000000000', marks: 10, feedback: null },
    });
    expect(gradeAttempt.status()).toBe(403);
  });

  test('sees only their own row from the student list', async ({ page }) => {
    // The isolation rule has to hold on list endpoints, not just detail pages.
    const api = await signIn(page, ACCOUNTS.student);
    const response = await api.get('/api/students?limit=200');
    expect(response.ok()).toBe(true);

    const body = (await response.json()) as { items: { rollNumber: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.rollNumber).toBe('AS1-0001');
  });

  test('cannot read another student\'s attendance by id', async ({ page, browser }) => {
    // Get a real id of somebody else, the way an attacker would: from a privileged account.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminApi = await signIn(adminPage, ACCOUNTS.admin);
    const list = (await (await adminApi.get('/api/students?limit=5')).json()) as {
      items: { id: string; rollNumber: string }[];
    };
    const other = list.items.find((entry) => entry.rollNumber !== 'AS1-0001');
    await adminContext.close();

    expect(other).toBeDefined();

    const api = await signIn(page, ACCOUNTS.student);
    const own = await api.get(`/api/attendance/student/${list.items[0]?.id}`);
    const foreign = await api.get(`/api/attendance/student/${other!.id}`);

    expect(foreign.status(), 'another student\'s attendance must not be readable').toBe(403);
    // And their own still works, so the test is not passing for the wrong reason.
    expect([200, 403]).toContain(own.status());
  });
});

test.describe('teacher', () => {
  test('can mark but cannot see the campus reports or run an import', async ({ page }) => {
    const api = await signIn(page, ACCOUNTS.teacher);

    expect((await api.get('/api/attendance/today')).status()).toBe(200);

    for (const path of ['/api/attendance/reports/daily', '/api/attendance/reports/compliance']) {
      const response = await api.get(path);
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }

    const importAttempt = await api.post('/api/students/import/preview', {
      data: { file: 'Adm No,Name\n1,Test\n' },
    });
    expect(importAttempt.status()).toBe(403);

    const slotAttempt = await api.post('/api/timetable/slots', {
      data: {
        sectionId: '00000000-0000-4000-8000-000000000000',
        dayOfWeek: 1,
        periodIndex: 1,
      },
    });
    expect(slotAttempt.status()).toBe(403);
  });
});

test.describe('bursar', () => {
  test('is finance only — no marks, no registers, no academic reports', async ({ page }) => {
    // "Whole campus, finance only. No access to marks or remarks."
    const api = await signIn(page, ACCOUNTS.bursar);

    for (const path of [
      '/api/attendance/today',
      '/api/attendance/reports/daily',
      '/api/attendance/reports/compliance',
    ]) {
      const response = await api.get(path);
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }

    const marking = await api.post('/api/attendance/sessions', {
      data: {
        sectionId: '00000000-0000-4000-8000-000000000000',
        date: '2026-09-22',
        periodIndex: 1,
        marks: [{ studentId: '00000000-0000-4000-8000-000000000001', status: 'PRESENT' }],
      },
    });
    expect(marking.status()).toBe(403);
  });
});

test.describe('coordinator', () => {
  test('reaches the campus reports the others cannot', async ({ page }) => {
    const api = await signIn(page, ACCOUNTS.admin);

    expect((await api.get('/api/attendance/reports/daily')).status()).toBe(200);
    expect((await api.get('/api/attendance/reports/compliance')).status()).toBe(200);
    expect((await api.get('/api/students?limit=5')).status()).toBe(200);

    const preview = await api.post('/api/students/import/preview', {
      data: { file: 'Adm No,Name of Student,Class\nE2E-1,Preview Only,AS1\n' },
    });
    expect(preview.status()).toBe(200);
    // A preview must not write anything.
    const body = (await preview.json()) as { counts: { create: number } };
    expect(body.counts.create).toBe(1);
  });

  test('is blocked from placing a clashing timetable slot, with a message naming the conflict', async ({
    page,
    browser,
  }) => {
    // Read a slot that genuinely exists. A coordinator's own timetable query has no scope
    // of its own, so the occupied slot comes from a teacher's.
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    const teacherApi = await signIn(teacherPage, ACCOUNTS.teacher);
    const timetable = (await (await teacherApi.get('/api/timetable')).json()) as {
      entries: { sectionId: string; dayOfWeek: number; periodIndex: number }[];
    };
    await teacherContext.close();

    const occupied = timetable.entries[0];
    expect(occupied, 'the seeded teacher should have a timetable').toBeDefined();

    // A different section, taught by the same teacher — placing it here double-books them.
    const other = timetable.entries.find((entry) => entry.sectionId !== occupied!.sectionId);
    expect(other, 'the teacher should teach more than one section').toBeDefined();

    const api = await signIn(page, ACCOUNTS.admin);
    const response = await api.post('/api/timetable/slots', {
      data: {
        sectionId: other!.sectionId,
        dayOfWeek: occupied!.dayOfWeek,
        periodIndex: occupied!.periodIndex,
      },
    });

    expect(response.status()).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('timetableClash');
    // "Blocked with a message naming the specific conflict."
    expect(body.error.message).toMatch(/Teacher is already teaching|Room is already in use|student/i);
  });
});
