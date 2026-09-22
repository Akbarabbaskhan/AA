import { expect, test } from '@playwright/test';

/**
 * M0's slice of the demo script: sign in on a phone and land on a screen with real data.
 * The ten-step script in the spec fills in as the milestones land.
 */

const DEMO_PASSWORD = 'Volt2026!';

test.describe('sign in', () => {
  test('redirects an unauthenticated visitor to the login page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('signs a coordinator in and shows live campus numbers', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/phone number or email/i).fill('admin@volt-demo.test');
    await page.getByLabel(/password/i).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    // 2,000 students from the seed — not a placeholder, and not an empty screen.
    await expect(page.getByText('2,000')).toBeVisible();
  });

  test('rejects a wrong password without saying whether the account exists', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/phone number or email/i).fill('admin@volt-demo.test');
    await page.getByLabel(/password/i).fill('not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Scoped to the form: Next's own route announcer is also role="alert".
    const error = page.locator('form').getByRole('alert');
    await expect(error).toBeVisible();
    await expect(error).toHaveText(/not right/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('accepts a phone number in the format a parent would type', async ({ page }) => {
    await page.goto('/login');

    // Stored as +923001110001; typed as 0300 111 0001.
    await page.getByLabel(/phone number or email/i).fill('0300 111 0001');
    await page.getByLabel(/password/i).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
  });
});

test.describe('the shell on a phone', () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test('is usable at 360px with a reachable bottom tab bar', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/phone number or email/i).fill('admin@volt-demo.test');
    await page.getByLabel(/password/i).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const tabBar = page.getByRole('navigation', { name: 'Primary' });
    await expect(tabBar).toBeVisible();

    // Five items at most, every one clearing the 44px tap target.
    const tabs = tabBar.getByRole('link');
    const count = await tabs.count();
    expect(count).toBeLessThanOrEqual(5);
    for (let index = 0; index < count; index += 1) {
      const box = await tabs.nth(index).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // Never horizontally scroll on a phone.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
