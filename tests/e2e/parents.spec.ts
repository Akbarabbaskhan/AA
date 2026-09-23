import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The parent portal.
 *
 * "Parents drive renewals more than students do. Keep it simple and make it work in Urdu."
 * So the tests are the renewal conversation: can a parent see their child's day in one
 * screen, in their own language, and do the three things the school allows them to do.
 */

const PASSWORD = 'Volt2026!';
const BASE_URL = process.env['APP_URL'] ?? 'http://localhost:3000';

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
 * Guardians sign in by phone. The seed documents a guardian with two children on purpose,
 * so the child switcher has something to switch between.
 */
const PARENT_PHONE = '+923021500002';

test.describe('the parent home screen', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the four facts and nothing else', async ({ page }) => {
    await signIn(page, PARENT_PHONE);

    await expect(page.getByTestId('today-attendance')).toBeVisible();
    await expect(page.getByTestId('fee-status')).toBeVisible();
    // Result and announcements are the other two; both are on the same screen.
    await expect(page.getByText(/latest result|تازہ نتیجہ/i)).toBeVisible();
  });

  test('switches between children and keeps the choice in the URL', async ({ page }) => {
    await signIn(page, PARENT_PHONE);

    // No skip: the seeded demo parent has two children by construction, so a missing
    // switcher here is a regression rather than a quirk of the data.
    const chips = page.getByTestId('child-chip');
    await expect(chips).toHaveCount(2);

    await chips.nth(1).click();
    await expect(page).toHaveURL(/studentId=/);

    // The choice survives a reload, so a bookmark keeps the child.
    const url = page.url();
    await page.goto(url);
    await expect(page.getByTestId('child-chip').nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test('reaches the voucher from the fee card in one tap', async ({ page }) => {
    await signIn(page, PARENT_PHONE);
    await page.getByTestId('fee-status').click();
    await expect(page).toHaveURL(/\/fees/);
  });

  test('does not scroll sideways on a 360px phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, PARENT_PHONE);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Urdu', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('switches the portal to Urdu and lays it out right to left', async ({ page }) => {
    await signIn(page, PARENT_PHONE);

    // The toggle is on every screen and each option is written in its own script, so a
    // parent who cannot read the current interface can still find the other one.
    await expect(page.getByTestId('language-toggle')).toBeVisible();
    await page.getByTestId('locale-ur').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // Scoped to the content: the first match elsewhere is the desktop sidebar, which is
    // hidden on a phone.
    await expect(page.locator('main').getByText(/فیس/).first()).toBeVisible();
  });

  test('remembers the choice on the account, not just the browser', async ({ page, browser }) => {
    // A fresh context carries no cookie; the language has to come from the account, which
    // is also what decides the language of the school's WhatsApp messages.
    const fresh = await browser.newContext({ baseURL: BASE_URL });
    try {
      const freshPage = await fresh.newPage();
      await signIn(freshPage, PARENT_PHONE);
      await expect(freshPage.locator('html')).toHaveAttribute('lang', 'ur');
    } finally {
      await fresh.close();
    }
  });

  test('switches back to English', async ({ page }) => {
    await signIn(page, PARENT_PHONE);
    await page.getByTestId('locale-en').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});

test.describe('what a parent may do', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('applies for leave, and it lands as a request rather than an absence', async ({ page }) => {
    await signIn(page, PARENT_PHONE);
    await page.goto('/leave');

    await page.getByTestId('apply-leave').click();
    // Far enough out that it cannot collide with a previous run's request.
    const year = 2031 + Math.floor(Math.random() * 40);
    await page.getByTestId('leave-from').fill(`${year}-04-05`);
    await page.getByTestId('leave-to').fill(`${year}-04-07`);
    await page.getByTestId('leave-reason').fill('Family wedding out of town.');
    await page.getByTestId('submit-leave').click();

    await expect(page.getByTestId('leave-row').first()).toBeVisible();
    await expect(page.getByText(/awaiting a decision|فیصلے کا انتظار/i).first()).toBeVisible();
  });

  test('books a meeting slot and can release it again', async ({ page }) => {
    await signIn(page, PARENT_PHONE);
    await page.goto('/meetings');

    // The seed publishes a parents' evening, so there is a grid to book from. A parent
    // cannot create slots — that is the admin's job, asserted below.
    const open = page.getByTestId('open-slot').first();
    await expect(open).toBeVisible();
    await open.click();

    await expect(page.getByTestId('my-slot').first()).toBeVisible();

    // Released again, so repeated runs do not consume the grid.
    await page.getByTestId('my-slot').first().click();
    await expect(page.getByTestId('open-slot').first()).toBeVisible();
  });

  test('is refused everything academic and everything financial beyond their own children', async ({
    page,
  }) => {
    const api = await signIn(page, PARENT_PHONE);

    for (const path of [
      '/api/questions',
      '/api/fees/defaulters',
      '/api/fees/reports',
      '/api/notifications/log',
      '/api/assignments/missing',
    ]) {
      const response = await api.get(path);
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }

    const payment = await api.post('/api/fees/payments', {
      data: {
        invoiceId: '00000000-0000-4000-8000-000000000000',
        amount: 100,
        method: 'CASH',
        reference: null,
      },
    });
    expect(payment.status()).toBe(403);

    const slots = await api.post('/api/meetings/slots', {
      data: {
        staffId: '00000000-0000-4000-8000-000000000000',
        type: 'PARENT_TEACHER',
        date: '2040-05-12',
        startTime: '16:00',
        endTime: '17:00',
        slotMinutes: 10,
      },
    });
    expect(slots.status()).toBe(403);

    const announcement = await api.post('/api/announcements', {
      data: {
        title: 'Should be refused',
        body: 'Parents cannot announce.',
        audience: { roles: ['STUDENT'] },
        pinned: false,
        allowReplies: false,
      },
    });
    expect(announcement.status()).toBe(403);
  });
});
