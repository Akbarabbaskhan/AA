import { defineConfig, devices } from '@playwright/test';

/**
 * The demo script runs on a phone, so the end-to-end tests do too.
 * "No milestone is complete until its acceptance criteria pass on a real phone, not a
 * desktop browser resized" — this is the CI approximation of that, not a replacement for it.
 */
/**
 * Some CI images and locked-down containers provision Chromium outside Playwright, where
 * the bundled download is unavailable. Point this at that binary and the suite runs against
 * it; leave it unset and Playwright uses its own.
 */
const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
const launchOptions = chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['html'], ['list']] : 'list',

  use: {
    baseURL: process.env['APP_URL'] ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'mobile-android',
      use: { ...devices['Pixel 5'], ...launchOptions },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...launchOptions },
    },
  ],

  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
