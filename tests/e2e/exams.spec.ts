import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The academics flows from the demo script: marks entry, publication, and the grade trend
 * chart that the spec calls the screenshot students send each other.
 */

const PASSWORD = 'Volt2026!';

const ACCOUNTS = {
  admin: 'admin@volt-demo.test',
  teacher: 'emp-0001@volt-demo.test',
  student: 'as1-0001@volt-demo.test',
} as const;

// These write to the shared demo tenant, so they run in order.
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, identifier: string): Promise<APIRequestContext> {
  await page.goto('/login');
  await page.getByLabel(/phone number or email/i).fill(identifier);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return page.request;
}

/**
 * Restores the precondition rather than assuming it: a previous run (or the integration
 * suite) may have published the series these tests need in draft.
 */
async function ensureDraftSeries(api: APIRequestContext): Promise<string> {
  const body = (await (await api.get('/api/exam-series')).json()) as {
    series: { id: string; isPublished: boolean; assessmentCount: number; marksEntered: number }[];
  };

  // The list is newest-first.
  const withMarks = body.series.filter(
    (entry) => entry.assessmentCount > 0 && entry.marksEntered > 0,
  );
  expect(withMarks.length, 'the seed should provide a series with marks').toBeGreaterThan(0);

  // Prefer a series that is already a draft; only withdraw one if none is.
  const draft = withMarks.find((entry) => !entry.isPublished);
  if (draft) return draft.id;

  const newest = withMarks[0]!;
  const response = await api.delete(`/api/exam-series/${newest.id}/publish`, {
    data: { reason: 'Restoring the precondition for a test run' },
  });
  expect(response.ok()).toBe(true);
  return newest.id;
}

test.describe('marks entry', () => {
  test('opens a grid, takes a mark from the keyboard, and autosaves', async ({ page, browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminApi = await signIn(adminPage, ACCOUNTS.admin);
    await ensureDraftSeries(adminApi);
    await adminContext.close();

    await signIn(page, ACCOUNTS.teacher);
    await page.goto('/exams');

    const firstPaper = page.locator('a[href^="/marks/"]').first();
    await expect(firstPaper).toBeVisible();
    await firstPaper.click();

    await expect(page).toHaveURL(/\/marks\/[0-9a-f-]+/);
    await expect(page.getByText(/Class mean/i)).toBeVisible();

    // Students down, one paper across, keyboard-driven.
    const firstInput = page.locator('tbody input').first();
    await expect(firstInput).toBeEnabled();

    // A different mark from whatever is already there: typing an identical value fires no
    // change event, so the test would assert a save that legitimately never happened.
    const existing = Number((await firstInput.inputValue()) || '0');
    const next = String(existing === 31 ? 29 : 31);
    await firstInput.fill(next);

    // Enter moves to the next student, which is the whole interaction.
    await firstInput.press('Enter');
    await expect(page.locator('tbody input').nth(1)).toBeFocused();

    // Autosave, with no save button anywhere.
    await expect(page.getByText(/All marks saved/i)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.locator('tbody input').first()).toHaveValue(next);
  });

  test('marks a student absent from the keyboard rather than entering zero', async ({ page }) => {
    await signIn(page, ACCOUNTS.teacher);
    await page.goto('/exams');
    await page.locator('a[href^="/marks/"]').first().click();
    await expect(page.getByText(/Class mean/i)).toBeVisible();

    // Pick a row that is not already absent, or nothing changes and nothing saves.
    const inputs = page.locator('tbody input');
    const count = await inputs.count();
    let target = -1;
    for (let index = 0; index < Math.min(count, 10); index += 1) {
      if ((await inputs.nth(index).inputValue()) !== 'A') {
        target = index;
        break;
      }
    }
    expect(target, 'expected at least one student not already marked absent').toBeGreaterThanOrEqual(0);

    await inputs.nth(target).click();
    await inputs.nth(target).press('a');

    await expect(inputs.nth(target)).toHaveValue('A');
    await expect(page.getByText(/All marks saved/i)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.locator('tbody input').nth(target)).toHaveValue('A');
  });

  test('refuses a mark above the paper total, in the UI', async ({ page }) => {
    await signIn(page, ACCOUNTS.teacher);
    await page.goto('/exams');
    await page.locator('a[href^="/marks/"]').first().click();
    await expect(page.getByText(/Class mean/i)).toBeVisible();

    const heading = await page.getByText(/out of \d+/).first().innerText();
    const total = Number(/out of (\d+)/.exec(heading)?.[1] ?? '40');

    const input = page.locator('tbody input').nth(4);
    await input.fill(String(total + 50));
    await expect(page.getByText(/Above the paper total/i).first()).toBeVisible();
  });
});

test.describe('publication', () => {
  test('publishes a whole series and the student sees it immediately', async ({ page, browser }) => {
    // Publishing computes and freezes a card for every student in the school, which is
    // real work — the assertion below waits for it, so the test has to as well.
    test.setTimeout(180_000);

    const api = await signIn(page, ACCOUNTS.admin);
    const seriesId = await ensureDraftSeries(api);

    const seriesName = await page.evaluate(async (id) => {
      const response = await fetch('/api/exam-series');
      const body = (await response.json()) as { series: { id: string; name: string }[] };
      return body.series.find((entry) => entry.id === id)?.name ?? '';
    }, seriesId);
    expect(seriesName).not.toBe('');

    // The student cannot see this series yet — staggered visibility causes complaints.
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await signIn(studentPage, ACCOUNTS.student);
    await studentPage.goto('/results');
    await expect(studentPage.getByRole('heading', { name: seriesName })).toBeHidden();

    await page.goto('/exams');
    const publish = page.getByRole('button', { name: /Publish the whole series/i }).first();
    await expect(publish).toBeVisible();
    await publish.click();

    // It asks first: publication is the least reversible thing a coordinator does.
    await expect(page.getByText(/visible to students and parents at once/i)).toBeVisible();
    await page.getByRole('button', { name: /Yes, publish now/i }).click();

    await expect(page.getByText(/result cards generated/i)).toBeVisible({ timeout: 120_000 });

    // And now it is there, for every family at once.
    await studentPage.reload();
    await expect(studentPage.getByRole('heading', { name: seriesName })).toBeVisible();
    await studentContext.close();
  });
});

test.describe('the student view', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('shows the grade trend with its boundary bands, at 360px', async ({ page }) => {
    await signIn(page, ACCOUNTS.student);
    await page.goto('/results');

    await expect(page.getByRole('heading', { name: /^results$/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grade trend' })).toBeVisible();

    // The chart is a real figure with an accessible name and a table behind it.
    const chart = page.locator('figure svg[role="img"]').first();
    await expect(chart).toBeVisible();
    await expect(chart.locator('title').first()).toHaveText(/.+/);

    // Paper breakdown names the one costing the most.
    await expect(page.getByText(/Costing you the most/i).first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('downloads a result card as a real PDF', async ({ page }) => {
    const api = await signIn(page, ACCOUNTS.student);
    await page.goto('/results');

    const link = page.locator('a[href^="/api/result-cards"]').first();
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    const response = await api.get(href!);

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/pdf');
    const body = await response.body();
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

test.describe('permissions around marks', () => {
  test('a student cannot open a marks grid or publish anything', async ({ page, browser }) => {
    const teacherContext = await browser.newContext();
    const teacherPage = await teacherContext.newPage();
    await signIn(teacherPage, ACCOUNTS.teacher);
    await teacherPage.goto('/exams');
    const href = await teacherPage.locator('a[href^="/marks/"]').first().getAttribute('href');
    await teacherContext.close();

    const api = await signIn(page, ACCOUNTS.student);

    // The page is not reachable...
    await page.goto(href!);
    await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();

    // ...and neither is the API behind it.
    const assessmentId = href!.split('/').pop()!;
    const marks = await api.post(`/api/assessments/${assessmentId}/marks`, {
      data: { entries: [{ studentId: '00000000-0000-4000-8000-000000000001', marksObtained: 40 }] },
    });
    expect(marks.status()).toBe(403);
  });

  test('a teacher cannot publish a series', async ({ page, browser }) => {
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminApi = await signIn(adminPage, ACCOUNTS.admin);
    const body = (await (await adminApi.get('/api/exam-series')).json()) as {
      series: { id: string }[];
    };
    await adminContext.close();

    const api = await signIn(page, ACCOUNTS.teacher);
    const response = await api.post(`/api/exam-series/${body.series[0]!.id}/publish`);
    expect(response.status()).toBe(403);
  });
});
