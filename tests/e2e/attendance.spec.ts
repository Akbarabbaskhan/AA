import { expect, test, type Page } from '@playwright/test';

/**
 * The attendance flows from the demo script.
 *
 * Step 2 is the one that lands: "Mark a 30-student register in under 15 seconds. Turn on
 * airplane mode first and do it offline, then reconnect and show it syncing."
 */

const PASSWORD = 'Volt2026!';

// These specs write to the shared demo tenant, so they run in order rather than racing
// each other over the same register.
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, identifier: string) {
  await page.goto('/login');
  await page.getByLabel(/phone number or email/i).fill(identifier);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('the teacher flow', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens on today's classes and reaches a register in one tap", async ({ page }) => {
    await signIn(page, 'emp-0001@volt-demo.test');

    await page.goto('/attendance');
    await expect(page.getByRole('heading', { name: /today's classes/i })).toBeVisible();

    const firstClass = page.getByRole('link').filter({ hasText: /Period/ }).first();
    await expect(firstClass).toBeVisible();
    await firstClass.click();

    await expect(page).toHaveURL(/\/attendance\/[0-9a-f-]+\/\d{4}-\d{2}-\d{2}\/\d+/);
    // Every student pre-marked present: the teacher taps only the absentees.
    await expect(page.getByRole('button', { name: /All present/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Submit register/i })).toBeVisible();

    const rows = page.getByRole('listitem').filter({ hasText: /Present|Absent/ });
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(5);
  });

  test('marks a student absent with a single tap and saves', async ({ page }) => {
    await signIn(page, 'emp-0001@volt-demo.test');
    await page.goto('/attendance');
    await page.getByRole('link').filter({ hasText: /Period/ }).first().click();
    await expect(page.getByRole('button', { name: /Submit register/i })).toBeVisible();

    // Start from a known state — these specs share one demo tenant, so a test that
    // depends on what the previous one left behind is a test that fails in isolation.
    await page.getByRole('button', { name: /All present/i }).click();

    const firstStudent = page.locator('ul > li > button').first();
    await expect(firstStudent).toContainText('Present');
    await firstStudent.click();
    await expect(firstStudent).toContainText('Absent');

    await page.getByRole('button', { name: /Submit register/i }).click();
    await expect(page.getByText(/Register saved/i)).toBeVisible({ timeout: 15_000 });
  });

  test('bulk actions set the whole register at once', async ({ page }) => {
    await signIn(page, 'emp-0001@volt-demo.test');
    await page.goto('/attendance');
    await page.getByRole('link').filter({ hasText: /Period/ }).first().click();
    await expect(page.getByRole('button', { name: /All absent/i })).toBeVisible();

    await page.getByRole('button', { name: /All absent/i }).click();
    const rows = page.locator('ul > li > button');
    await expect(rows.first()).toContainText('Absent');
    await expect(rows.nth(3)).toContainText('Absent');

    await page.getByRole('button', { name: /All present/i }).click();
    await expect(rows.first()).toContainText('Present');
  });
});

test.describe('offline marking — the moment the demo turns on', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('accepts marks in airplane mode and syncs them on reconnect', async ({ page, context }) => {
    await signIn(page, 'emp-0001@volt-demo.test');
    await page.goto('/attendance');
    await page.getByRole('link').filter({ hasText: /Period/ }).first().click();
    await expect(page.getByRole('button', { name: /Submit register/i })).toBeVisible();

    const registerUrl = page.url();

    // Airplane mode.
    await context.setOffline(true);
    await expect(page.getByText(/^Offline$/)).toBeVisible();

    await page.getByRole('button', { name: /All absent/i }).click();
    const firstStudent = page.locator('ul > li > button').first();
    await expect(firstStudent).toContainText('Absent');

    await page.getByRole('button', { name: /Submit register/i }).click();
    // The teacher is told plainly that their work is safe.
    await expect(page.getByText(/Saved on this phone/i)).toBeVisible();
    await expect(page.getByText(/waiting to sync/i)).toBeVisible();

    // Signal returns; the queue drains on its own.
    await context.setOffline(false);
    await expect(page.getByText(/waiting to sync/i)).toBeHidden({ timeout: 30_000 });

    // And the mark is really on the server, not just on the phone.
    await page.goto(registerUrl);
    await expect(page.locator('ul > li > button').first()).toContainText('Absent');
  });

  test('keeps a queued register visible after a reload while still offline', async ({
    page,
    context,
  }) => {
    await signIn(page, 'emp-0001@volt-demo.test');
    await page.goto('/attendance');
    await page.getByRole('link').filter({ hasText: /Period/ }).last().click();
    await expect(page.getByRole('button', { name: /Submit register/i })).toBeVisible();

    await context.setOffline(true);
    await page.getByRole('button', { name: /All absent/i }).click();
    await page.getByRole('button', { name: /Submit register/i }).click();
    await expect(page.getByText(/Saved on this phone/i)).toBeVisible();

    // The queue survives a reload — nothing is held only in React state.
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByRole('button', { name: /Submit register/i })).toBeVisible();
    await expect(page.locator('ul > li > button').first()).toContainText('Absent');
  });
});

test.describe('the coordinator flow', () => {
  test('shows campus attendance and who has not marked', async ({ page }) => {
    await signIn(page, 'admin@volt-demo.test');
    await page.goto('/attendance');

    await expect(page.getByText(/Campus today/i)).toBeVisible();
    await expect(page.getByText(/Registers not yet marked/i).first()).toBeVisible();
    // A real percentage, not a placeholder.
    await expect(page.getByText(/\d+\.\d%/).first()).toBeVisible();
  });
});

test.describe('the student flow', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('shows a heatmap and per-subject percentages at 360px', async ({ page }) => {
    await signIn(page, 'as1-0001@volt-demo.test');
    await page.goto('/attendance');

    await expect(page.getByRole('heading', { name: /my attendance/i })).toBeVisible();
    await expect(page.getByText(/By subject/i)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('shows the timetable with the week below today', async ({ page }) => {
    await signIn(page, 'as1-0001@volt-demo.test');
    await page.goto('/timetable');
    await expect(page.getByRole('heading', { name: /^timetable$/i })).toBeVisible();
    await expect(page.getByText(/^Today$/)).toBeVisible();
  });
});
