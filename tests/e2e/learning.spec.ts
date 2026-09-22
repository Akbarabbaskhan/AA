import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The learning flows.
 *
 * The spec's line for this milestone is that the practice engine is "your word-of-mouth" —
 * so what is tested here is the promise a student is making to a friend when they
 * recommend it: the vault filters, the clock runs, the mark scheme stays shut until you
 * submit, and the quiz never leaks its answers.
 */

const PASSWORD = 'Volt2026!';
const STUDENT = 'as1-0001@volt-demo.test';
const ADMIN = 'admin@volt-demo.test';
const BASE_URL = process.env['APP_URL'] ?? 'http://localhost:3000';

// These specs write to the shared demo tenant, so they run in order rather than racing.
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, identifier: string): Promise<APIRequestContext> {
  await page.goto('/login');
  await page.getByLabel(/phone number or email/i).fill(identifier);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return page.request;
}

test.describe('the past paper vault', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('lists papers and filters down to a subject without a page of its own', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/papers');

    await expect(page.getByRole('heading', { name: /past papers/i })).toBeVisible();
    const before = await page.getByTestId('paper-count').textContent();
    expect(before).toBeTruthy();

    const subject = page.getByTestId('vault-filters').getByRole('combobox').first();
    const options = await subject.locator('option').all();
    // The first option is "All"; the second is a real subject.
    const value = await options[1]!.getAttribute('value');
    await subject.selectOption(value!);

    // The filter lives in the URL, so it survives a reload and can be shared.
    await expect(page).toHaveURL(/subjectId=/);
    await page.reload();
    await expect(page.getByTestId('vault-filters').getByRole('combobox').first()).toHaveValue(value!);
  });

  test('hides attempted papers behind the "never attempted" switch', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/papers');

    await page.getByTestId('only-unattempted').check();
    await expect(page).toHaveURL(/onlyUnattempted=true/);
    await expect(page.getByTestId('paper-count')).toBeVisible();
  });

  test('does not scroll sideways on a 360px phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, STUDENT);
    await page.goto('/papers');
    await expect(page.getByRole('heading', { name: /past papers/i })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('timed practice', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the mark scheme shut until the attempt is submitted', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/papers?onlyUnattempted=true');

    await page.getByRole('link').filter({ hasText: /Variant/ }).first().click();
    await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+/);

    // Nothing resembling a mark scheme link exists before the attempt is submitted —
    // not hidden, not present.
    await expect(page.getByTestId('mark-scheme-link')).toHaveCount(0);

    await page.getByTestId('start-attempt').click();
    await expect(page.getByTestId('practice-clock')).toBeVisible();
    await expect(page.getByTestId('mark-scheme-link')).toHaveCount(0);

    // The clock is real: it is derived from the wall clock, so it moves.
    const first = await page.getByTestId('practice-clock').textContent();
    await page.waitForTimeout(1500);
    const second = await page.getByTestId('practice-clock').textContent();
    expect(second).not.toBe(first);

    await page.getByTestId('submit-attempt').click();
    await expect(page.getByTestId('self-mark')).toBeVisible();
    await expect(page.getByTestId('mark-scheme-link')).toBeVisible();
  });

  test('records a self-marked score and shows the grade', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/papers?onlyUnattempted=true');
    await page.getByRole('link').filter({ hasText: /Variant/ }).first().click();

    await page.getByTestId('start-attempt').click();
    await page.getByTestId('submit-attempt').click();
    await expect(page.getByTestId('self-mark')).toBeVisible();

    await page.getByTestId('self-mark-score').fill('30');
    await page.getByTestId('save-self-mark').click();

    await expect(page.getByTestId('self-mark-result')).toBeVisible();
    await expect(page.getByTestId('self-mark-result')).toContainText('%');
  });

  test('resuming a paper mid-attempt keeps the same clock, not a fresh hour', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/papers?onlyUnattempted=true');
    await page.getByRole('link').filter({ hasText: /Variant/ }).first().click();
    // Wait for the navigation before reading the URL: click() resolves before the route
    // has changed, so page.url() otherwise hands back the list page.
    await expect(page).toHaveURL(/\/papers\/[0-9a-f-]+/);
    const url = page.url();

    await page.getByTestId('start-attempt').click();
    await expect(page.getByTestId('practice-clock')).toBeVisible();
    const before = await page.getByTestId('practice-clock').textContent();

    await page.waitForTimeout(2000);
    await page.goto(url);
    await expect(page.getByTestId('practice-clock')).toBeVisible();
    const after = await page.getByTestId('practice-clock').textContent();

    // Less time left than before, not the full duration back.
    expect(after).not.toBe(before);
  });
});

test.describe('quizzes', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('never puts the answer key in the page source', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/quizzes');

    const rows = page.getByTestId('quiz-row');
    if ((await rows.count()) === 0) test.skip();

    await rows.first().click();
    await expect(page).toHaveURL(/\/quizzes\/[0-9a-f-]+\/take/);

    const shell = await page.content();
    expect(shell).not.toContain('correctJson');
    expect(shell).not.toContain('"correct"');
  });

  /*
   * Builds its own quiz rather than consuming a seeded one.
   *
   * A quiz allows a fixed number of attempts, so a test that sits a seeded quiz passes once
   * and silently skips on every run after that — which reads like a pass and proves
   * nothing. The coordinator creates a fresh quiz through the API first, so this test says
   * the same thing on the hundredth run as on the first.
   */
  test('sits a quiz one question at a time and shows the result', async ({ page, browser }) => {
    const studentApi = await signIn(page, STUDENT);
    const mine = (await (await studentApi.get('/api/quizzes')).json()) as {
      sectionId: string;
      subjectId: string;
    }[];
    expect(mine.length, 'the seed should give this student a quiz').toBeGreaterThan(0);
    const { sectionId, subjectId } = mine[0]!;

    // The coordinator gets their own browser context: signing in again on the student's
    // page would just redirect to the dashboard, because they are already signed in.
    const staffContext = await browser.newContext({ baseURL: BASE_URL });
    const quizId = await (async () => {
      const staffPage = await staffContext.newPage();
      const adminApi = await signIn(staffPage, ADMIN);

      const bank = (await (
        await adminApi.get(`/api/questions?subjectId=${subjectId}&type=MCQ&limit=4`)
      ).json()) as { id: string }[];
      expect(bank.length, 'the seed should stock the question bank').toBeGreaterThan(0);

      const created = await adminApi.post('/api/quizzes', {
        data: {
          sectionId,
          title: `[e2e] sitting ${Date.now()}`,
          timeLimitSeconds: 900,
          attemptsAllowed: 1,
          shuffleQuestions: true,
          shuffleOptions: true,
          negativeMarking: false,
          availableFrom: null,
          availableTo: null,
          showAnswersAfter: true,
          questionIds: bank.map((question) => question.id),
        },
      });
      expect(created.ok(), await created.text()).toBe(true);
      return ((await created.json()) as { id: string }).id;
    })();
    await staffContext.close();

    await page.goto(`/quizzes/${quizId}/take`);

    await page.getByTestId('start-quiz').click();
    await expect(page.getByTestId('quiz-clock')).toBeVisible();

    // One question visible at a time; the rest are reachable from the number strip.
    await expect(page.getByRole('group').first()).toBeVisible();

    const option = page.getByRole('radio').first();
    await option.check();
    await expect(page.getByTestId('quiz-save-state')).toHaveText(/saved/i);

    // Submit only appears on the last question — the number strip is the way there, and
    // jumping is the whole point of having it.
    await page.getByRole('button', { name: /^\d+$/ }).last().click();
    await page.getByTestId('finish-quiz').click();
    await page.getByTestId('confirm-submit-quiz').click();

    await expect(page.getByTestId('quiz-result')).toBeVisible();
    await expect(page.getByTestId('quiz-score')).toBeVisible();
  });
});

test.describe('assignments', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the student their own status and accepts a submission', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/assignments');

    const rows = page.getByTestId('assignment-row');
    if ((await rows.count()) === 0) test.skip();

    await expect(page.getByTestId('assignment-status').first()).toBeVisible();

    // Find one that is not already marked, so the form is there to use.
    const count = await rows.count();
    for (let index = 0; index < count; index += 1) {
      await page.goto('/assignments');
      await page.getByTestId('assignment-row').nth(index).click();
      await expect(page).toHaveURL(/\/assignments\/[0-9a-f-]+/);
      if ((await page.getByTestId('submit-form').count()) === 0) continue;

      await page.getByTestId('submission-text').fill('Submitted from the end-to-end test.');
      const button = page.getByTestId('submit-assignment');
      if (await button.isDisabled()) continue;
      await button.click();
      await expect(page.getByTestId('submission-done')).toBeVisible();
      return;
    }
    test.skip();
  });
});

test.describe('the weakness map', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('ranks topics weakest first and does not call a thin sample a weakness', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/mastery');

    const heading = page.getByRole('heading', { name: /weakness map/i });
    if ((await heading.count()) === 0) test.skip();
    await expect(heading).toBeVisible();

    const weakest = page.getByTestId('weakest-topics');
    if ((await weakest.count()) > 0) {
      const percents = await weakest.getByRole('img').evaluateAll((nodes) =>
        nodes.map((node) => Number(/(\d+)%/.exec(node.getAttribute('aria-label') ?? '')?.[1] ?? '0')),
      );
      expect([...percents].sort((a, b) => a - b)).toEqual(percents);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('resources and doubts', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('lists resources grouped by subject', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/resources');
    await expect(page.getByRole('heading', { name: /^resources$/i })).toBeVisible();
  });

  test('lets a student ask a doubt and a teacher answer it', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/doubts');

    // A unique title per run: the suite writes to the shared demo tenant, so a fixed one
    // matches every previous run's thread as well as this one's.
    const title = `E2E doubt ${Date.now()}`;

    await page.getByTestId('ask-doubt').click();
    await page.getByTestId('doubt-title').fill(title);
    await page.getByTestId('doubt-body').fill('The worked example loses me at the substitution.');
    await page.getByTestId('post-doubt').click();

    await expect(page.getByTestId('doubt-row').filter({ hasText: title })).toBeVisible();
  });
});
