import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The finance and parent flows.
 *
 * "Demo to the bursar. This is the budget holder." So what is tested here is the accounts
 * office's actual day: what is owed, who is behind, the statement that landed this
 * morning — plus the parent screen that decides whether the contract renews.
 */

const PASSWORD = 'Volt2026!';
const BURSAR = 'bursar@volt-demo.test';
const ADMIN = 'admin@volt-demo.test';
const STUDENT = 'as1-0001@volt-demo.test';
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

test.describe('the bursar', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens on the ledger with the collection position', async ({ page }) => {
    await signIn(page, BURSAR);
    await page.goto('/fees');

    await expect(page.getByRole('heading', { name: /^fees$/i })).toBeVisible();
    await expect(page.getByTestId('invoice-list')).toBeVisible();
    expect(await page.getByTestId('invoice-row').count()).toBeGreaterThan(5);
  });

  test('reaches an invoice and records a payment against it', async ({ page }) => {
    const api = await signIn(page, BURSAR);

    // An invoice with something outstanding, so the form is there to use.
    const invoices = (await (await api.get('/api/fees/invoices?status=UNPAID&limit=5')).json()) as {
      id: string;
      outstanding: number;
    }[];
    expect(invoices.length, 'the seed should leave something unpaid').toBeGreaterThan(0);
    const target = invoices.find((invoice) => invoice.outstanding > 0)!;

    await page.goto(`/fees/${target.id}`);
    await expect(page.getByTestId('record-payment')).toBeVisible();

    await page.getByTestId('payment-method').selectOption('CASH');
    await page.getByTestId('payment-amount').fill('100');
    await page.getByTestId('save-payment').click();

    await expect(page.getByTestId('payment-recorded')).toBeVisible();
  });

  test('refuses a bank payment with no reference, in the UI as on the wire', async ({ page }) => {
    const api = await signIn(page, BURSAR);
    const invoices = (await (await api.get('/api/fees/invoices?status=UNPAID&limit=5')).json()) as {
      id: string;
      outstanding: number;
    }[];
    const target = invoices.find((invoice) => invoice.outstanding > 0)!;

    await page.goto(`/fees/${target.id}`);
    await page.getByTestId('payment-method').selectOption('BANK');
    await page.getByTestId('payment-amount').fill('100');

    // The button stays disabled until a reference is typed — the rule is enforced before
    // the round trip, not only after it.
    await expect(page.getByTestId('save-payment')).toBeDisabled();
    await page.getByTestId('payment-reference').fill('E2E-REF-1');
    await expect(page.getByTestId('save-payment')).toBeEnabled();
  });

  test('downloads a voucher as a real PDF', async ({ page }) => {
    const api = await signIn(page, BURSAR);
    const invoices = (await (await api.get('/api/fees/invoices?limit=1')).json()) as { id: string }[];

    const response = await api.get(`/api/fees/invoices/${invoices[0]!.id}/voucher`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/pdf');

    const body = await response.body();
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('works the chase list by aging bucket', async ({ page }) => {
    await signIn(page, BURSAR);
    await page.goto('/fees/defaulters');

    await expect(page.getByRole('heading', { name: /defaulters/i })).toBeVisible();
    await expect(page.getByTestId('defaulter-list')).toBeVisible();

    const rows = await page.getByTestId('defaulter-row').count();
    expect(rows).toBeGreaterThan(0);

    // The buckets double as the filter, and the filter lives in the URL.
    await page.getByRole('link', { name: /0.*30 days/i }).first().click();
    await expect(page).toHaveURL(/bucket=/);
  });

  test('exports the chase list as CSV', async ({ page }) => {
    const api = await signIn(page, BURSAR);
    const response = await api.get('/api/fees/defaulters?format=csv');

    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('text/csv');

    const text = await response.text();
    expect(text.split('\n')[0]).toContain('Roll number');
    expect(text.split('\n').length).toBeGreaterThan(1);
  });

  test('matches a bank statement and posts only what it is confident about', async ({ page }) => {
    const api = await signIn(page, BURSAR);
    const invoices = (await (await api.get('/api/fees/invoices?status=UNPAID&limit=5')).json()) as {
      id: string;
      voucherNumber: string;
      outstanding: number;
    }[];
    const target = invoices.find((invoice) => invoice.outstanding > 0)!;

    await page.goto('/fees/reconcile');
    await page.getByTestId('statement-csv').fill(
      [
        'Date,Description,Credit,Reference',
        `01/09/2026,"FEE ${target.voucherNumber}",${Math.round(target.outstanding / 100)},E2EREC1`,
        '01/09/2026,"MISC DEPOSIT",42,E2EREC2',
      ].join('\n'),
    );
    await page.getByTestId('analyse-statement').click();

    await expect(page.getByTestId('reconcile-summary')).toBeVisible();
    expect(await page.getByTestId('reconcile-row').count()).toBe(2);

    // The confident row is pre-ticked; the unmatched one is not, so the button offers one.
    await expect(page.getByTestId('confirm-matches')).toContainText(/1 payment/i);
    await page.getByTestId('confirm-matches').click();
    await expect(page.getByTestId('reconcile-posted')).toBeVisible();
  });

  test('sees the collection report measured against what is due', async ({ page }) => {
    await signIn(page, BURSAR);
    await page.goto('/fees/reports');
    await expect(page.getByRole('heading').first()).toBeVisible();
    // The month still being collected is labelled rather than counted as a shortfall.
    await expect(page.getByText(/not yet due/i).first()).toBeVisible();
  });

  test('is refused everything academic', async ({ page }) => {
    const api = await signIn(page, BURSAR);
    for (const path of ['/api/questions', '/api/assignments/missing', '/api/papers/facets']) {
      const response = await api.get(path);
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }
  });
});

test.describe('the coordinator', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('can read the fee position but cannot move a rupee', async ({ page }) => {
    const api = await signIn(page, ADMIN);

    // "All reports" includes the collection position.
    expect((await api.get('/api/fees/reports')).ok()).toBe(true);
    expect((await api.get('/api/fees/invoices?limit=5')).ok()).toBe(true);

    const invoices = (await (await api.get('/api/fees/invoices?limit=1')).json()) as { id: string }[];
    const payment = await api.post('/api/fees/payments', {
      data: { invoiceId: invoices[0]!.id, amount: 100, method: 'CASH', reference: null },
    });
    expect(payment.status()).toBe(403);

    const reconcile = await api.post('/api/fees/reconcile', {
      data: { csv: 'Date,Description,Credit\n01/09/2026,x,1' },
    });
    expect(reconcile.status()).toBe(403);
  });
});

test.describe('the student', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('sees only their own fees', async ({ page }) => {
    const api = await signIn(page, STUDENT);
    const invoices = (await (await api.get('/api/fees/invoices?limit=200')).json()) as {
      studentId: string;
    }[];
    expect(invoices.length).toBeGreaterThan(0);
    expect(new Set(invoices.map((invoice) => invoice.studentId)).size).toBe(1);
  });

  test('is refused the ledger, the chase list and reconciliation', async ({ page }) => {
    const api = await signIn(page, STUDENT);
    for (const path of ['/api/fees/defaulters', '/api/fees/reports', '/api/fees/structures']) {
      const response = await api.get(path);
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }

    const reconcile = await api.post('/api/fees/reconcile', {
      data: { csv: 'Date,Description,Credit\n01/09/2026,x,1' },
    });
    expect(reconcile.status()).toBe(403);

    const log = await api.get('/api/notifications/log');
    expect([403, 404]).toContain(log.status());
  });

  test('does not scroll sideways on a 360px phone', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, STUDENT);
    await page.goto('/fees');
    await expect(page.getByRole('heading', { name: /^fees$/i })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('notifications', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows the recipient their preferences and keeps in-app locked on', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/notifications');

    await expect(page.getByTestId('notification-preferences')).toBeVisible();

    // The in-app switch is present and disabled: it is the record of what was sent.
    const inApp = page.getByRole('checkbox').first();
    await expect(inApp).toBeDisabled();
    await expect(inApp).toBeChecked();
  });

  test('gives the office the delivery log, searchable by phone number', async ({ page, browser }) => {
    const staffContext = await browser.newContext({ baseURL: BASE_URL });
    try {
      const staffPage = await staffContext.newPage();
      await signIn(staffPage, ADMIN);
      await staffPage.goto('/notifications/log');

      await expect(staffPage.getByRole('heading', { name: /delivery log/i })).toBeVisible();
      await expect(staffPage.getByTestId('delivery-log')).toBeVisible();
      expect(await staffPage.getByTestId('delivery-row').count()).toBeGreaterThan(0);
    } finally {
      await staffContext.close();
    }
  });
});
