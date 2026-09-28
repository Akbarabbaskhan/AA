import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Student life, end to end.
 *
 * The spec's test for this milestone is not a feature list, it is a mood: "a student with no
 * test due this week still has a reason to open the app." So these walk the reasons —
 * joining a society, saying yes to an event, seeing the week ahead, a badge case, an ID card
 * that a gate can scan, and a transcript request that actually arrives in the locker.
 *
 * The harmful version of recognition is tested too, because it is the one that ships by
 * accident: nothing here may rank a mark, and the opt-out has to hold on the page as well
 * as in the service.
 */

const PASSWORD = 'Volt2026!';
const STUDENT = 'as1-0001@volt-demo.test';
const CLASSMATE = 'as1-0002@volt-demo.test';
const TEACHER = 'emp-0001@volt-demo.test';
const ADMIN = 'admin@volt-demo.test';
const PARENT_PHONE = '+923021500002';

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

/**
 * A second signed-in session, in its own context.
 *
 * Visiting /login while already signed in redirects to the dashboard, so a test that needs
 * two roles needs two browser contexts rather than two sign-ins on one page — which is also
 * closer to the truth: the student and the office are two people at two phones.
 */
async function signInAs(
  browser: Browser,
  identifier: string,
): Promise<{ page: Page; api: APIRequestContext; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const api = await signIn(page, identifier);
  return { page, api, close: () => context.close() };
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('societies', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('lists the directory and opens one society on a phone', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/societies');

    await expect(page.getByTestId('society-row').first()).toBeVisible();
    await noSidewaysScroll(page);

    await page.getByTestId('society-link').first().click();
    await expect(page).toHaveURL(/\/societies\/[0-9a-f-]{36}/);
    await expect(page.getByTestId('member-list')).toBeVisible();
  });

  test('joins a society and leaves it again', async ({ page }) => {
    await signIn(page, CLASSMATE);
    await page.goto('/societies');

    const join = page.getByTestId('join-society').first();
    if ((await join.count()) === 0) {
      // Every society already joined is a pass for the previous run, not for this one.
      const leave = page.getByTestId('leave-society').first();
      await expect(leave).toBeVisible();
      await leave.click();
      await expect(page.getByTestId('join-society').first()).toBeVisible();
    }

    /*
     * Named before clicking, and located by name afterwards: a locator filtered on "has a
     * join button" stops matching this row the moment the join succeeds, and silently starts
     * matching the next one instead.
     */
    const candidate = page
      .getByTestId('society-row')
      .filter({ has: page.getByTestId('join-society') })
      .first();
    const name = ((await candidate.getByTestId('society-link').textContent()) ?? '').trim();
    expect(name).not.toEqual('');
    await candidate.getByTestId('join-society').click();

    const row = page.getByTestId('society-row').filter({ hasText: name });
    // Either joined outright or recorded as an application, depending on the society.
    const joined = row.getByTestId('leave-society');
    const applied = row.getByTestId('society-applied');
    await expect(joined.or(applied).first()).toBeVisible();

    if ((await joined.count()) > 0) {
      // The membership is real: it shows on the student's own profile.
      await page.goto('/profile');
      await expect(page.getByTestId('profile-societies')).toContainText(name);

      /*
       * Leaving, in the same page session as joining — which is also the regression test for
       * the service worker. It used to serve the App Router's data payloads from cache, so the
       * second write in a session repainted nothing and this row went on saying "you are in".
       */
      await page.goto('/societies');
      await row.getByTestId('leave-society').click();
      await expect(row.getByTestId('join-society')).toBeVisible();
    }
  });
});

test.describe('events', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('says yes to an event, and joins the waitlist when it is full', async ({ page }) => {
    await signIn(page, CLASSMATE);
    await page.goto('/events');

    const rows = page.getByTestId('event-row');
    await expect(rows.first()).toBeVisible();

    const rsvp = page.getByTestId('rsvp').first();
    if ((await rsvp.count()) === 0) {
      // Already going to everything: cancel one, which is the same flow in reverse.
      const cancel = page.getByTestId('cancel-rsvp').first();
      await expect(cancel).toBeVisible();
      await cancel.click();
      await expect(page.getByTestId('rsvp').first()).toBeVisible();
    }

    // Located by title once clicked, for the same reason as the society row above.
    const candidate = page
      .getByTestId('event-row')
      .filter({ has: page.getByTestId('rsvp') })
      .first();
    const title = ((await candidate.getByTestId('event-title').textContent()) ?? '').trim();
    expect(title).not.toEqual('');
    await candidate.getByTestId('rsvp').click();

    const row = page.getByTestId('event-row').filter({ hasText: title });
    // A full event puts the student on the waitlist rather than refusing them.
    const going = row.getByTestId('rsvp-going');
    const waitlisted = row.getByTestId('rsvp-waitlisted');
    await expect(going.or(waitlisted).first()).toBeVisible();

    if ((await waitlisted.count()) > 0) {
      await expect(waitlisted).toContainText(/\d/);
    }

    await row.getByTestId('cancel-rsvp').click();
    await expect(row.getByTestId('rsvp')).toBeVisible();
  });
});

test.describe('the campus calendar', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('narrows to what involves me, and keeps the filter in the URL', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/calendar');

    await expect(page.getByTestId('calendar-list')).toBeVisible();
    const all = await page.getByTestId('calendar-entry').count();
    expect(all).toBeGreaterThan(0);
    await noSidewaysScroll(page);

    // A link, not a checkbox, so the filter is shareable and survives a reload.
    await page.getByTestId('calendar-mine-only').click();
    await expect(page).toHaveURL(/mineOnly=true/);

    // The personal filter can only ever remove entries.
    const mine = await page.getByTestId('calendar-entry').count();
    expect(mine).toBeLessThanOrEqual(all);

    await page.reload();
    await expect(page.getByTestId('calendar-mine-only')).toHaveAttribute('aria-current', 'page');
  });

  test('shows the week ahead on the dashboard', async ({ page }) => {
    await signIn(page, STUDENT);
    await expect(page.getByTestId('dashboard-upcoming')).toBeVisible();
  });
});

test.describe('recognition', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('ranks effort and never a mark', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/recognition');

    const board = page.getByTestId('leaderboard');
    await expect(board).toBeVisible();
    await noSidewaysScroll(page);

    // No grade, no percentage, no mark — on the page, not only in the service.
    const text = (await board.textContent()) ?? '';
    expect(text).not.toMatch(/%|\bgrade\b|\bmark\b|\bA\*\b/i);

    // Switching metric is a link, so it survives a reload and can be shared.
    await page.getByRole('link', { name: /quizzes/i }).click();
    await expect(page).toHaveURL(/metric=QUIZZES/);
    // The notice is always there; a board with nobody on it yet is an empty state, not a bug.
    await expect(page.getByTestId('effort-notice')).toBeVisible();
  });

  test('honours the opt-out on the page, not just in the API', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/recognition');

    const toggle = page.getByTestId('opt-out-checkbox');
    await expect(toggle).toBeVisible();

    await toggle.check();
    await expect(page.getByTestId('opted-out-notice')).toBeVisible();
    await expect(page.getByTestId('leaderboard')).toHaveCount(0);

    // Put the demo tenant back as it was; the setting is the student's, not the suite's.
    await page.getByTestId('opt-out-checkbox').uncheck();
    await expect(page.getByTestId('opted-out-notice')).toHaveCount(0);

    // Reloaded rather than trusted: the setting has to have been saved, not just unticked.
    await page.reload();
    await expect(page.getByTestId('opt-out-checkbox')).not.toBeChecked();
    await expect(page.getByTestId('leaderboard')).toBeVisible();
  });

  test('shows a badge case with what is earned and what is not', async ({ page }) => {
    await signIn(page, STUDENT);
    await page.goto('/recognition');

    const badges = page.getByTestId('badge-list');
    await expect(badges).toBeVisible();
    // A badge case that only showed earned badges would not be a case.
    expect(await page.getByTestId('badge-locked').count()).toBeGreaterThan(0);
  });
});

test.describe('the digital ID card', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('renders a scannable card whose QR a member of staff can verify', async ({
    page,
    browser,
  }) => {
    const studentApi = await signIn(page, STUDENT);
    await page.goto('/identity');

    await expect(page.getByTestId('id-card')).toBeVisible();
    await expect(page.getByRole('img', { name: /identity qr code/i })).toBeVisible();
    await noSidewaysScroll(page);

    // The token behind the QR, taken the way a scanner would get it.
    const card = await studentApi.get('/api/identity/card');
    expect(card.ok()).toBeTruthy();
    const { qrToken } = (await card.json()) as { qrToken: string };
    expect(qrToken.split('.')).toHaveLength(3);

    // A student cannot verify a card — that is a gate's job, and a student holding the
    // endpoint could enumerate the roll numbers of the whole campus.
    const asStudent = await studentApi.post('/api/identity/scan', { data: { token: qrToken } });
    expect([403, 404]).toContain(asStudent.status());

    const staff = await signInAs(browser, TEACHER);
    const scan = await staff.api.post('/api/identity/scan', { data: { token: qrToken } });
    expect(scan.ok()).toBeTruthy();
    const result = (await scan.json()) as {
      valid: boolean;
      student?: Record<string, unknown>;
    };
    expect(result.valid).toBe(true);
    expect(result.student?.['rollNumber']).toBe('AS1-0001');
    // Enough to recognise the person, and nothing about their marks, fees or family.
    expect(Object.keys(result.student ?? {}).sort()).toEqual([
      'name',
      'photoUrl',
      'rollNumber',
      'yearGroupName',
    ]);

    const tampered = await staff.api.post('/api/identity/scan', {
      data: { token: `${qrToken.slice(0, -2)}xx` },
    });
    expect(((await tampered.json()) as { valid: boolean }).valid).toBe(false);

    await staff.close();
  });
});

test.describe('the document locker', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('carries a request from the student to the office and back into the locker', async ({
    page,
    browser,
  }) => {
    const destination = `E2E University ${Date.now()}`;

    await signIn(page, STUDENT);
    await page.goto('/careers/requests');

    await page.getByTestId('request-document').click();
    await expect(page.getByTestId('request-form')).toBeVisible();
    // The first type is the one the office fulfils, so the request needs no teacher.
    await page.getByTestId('request-destination').fill(destination);
    await page.getByTestId('send-request').click();
    await expect(page.getByTestId('request-form')).toHaveCount(0);

    // The office picks it up and files the document.
    const office = await signInAs(browser, ADMIN);
    await office.page.goto('/careers/requests');
    const row = office.page.getByTestId('request-row').filter({ hasText: destination });
    await expect(row).toBeVisible();

    /*
     * Straight to "ready": marking it in progress first re-sorts the queue (the office list
     * groups by status), the row moves under the cursor, and the half-open form loses its
     * place. The in-progress step has its own integration test; this one is about the journey
     * from a student's request to a file in their locker.
     */
    await row.getByTestId('open-mark-ready').click();
    await row.getByTestId('request-file-url').fill(`e2e/${Date.now()}-transcript.pdf`);
    await row.getByTestId('confirm-ready').click();
    // Fulfilled: the office's decision controls are gone from the row.
    await expect(row.getByTestId('open-mark-ready')).toHaveCount(0);
    await office.close();

    // The student is told it is ready, and has it, downloadable, without asking anybody.
    await page.goto('/careers/requests');
    await expect(
      page
        .getByTestId('request-row')
        .filter({ hasText: destination })
        .getByTestId('request-download'),
    ).toBeVisible();

    await page.goto('/documents');
    await expect(page.getByTestId('locker-item').first()).toBeVisible();
    const download = page.getByTestId('locker-download').first();
    await expect(download).toHaveAttribute('href', /.+/);
  });

  test('gives a parent their child’s locker', async ({ page }) => {
    await signIn(page, PARENT_PHONE);
    await page.goto('/documents');
    // Either documents or the empty state — never a 403, which is what this asserts.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/forbidden|403/i)).toHaveCount(0);
  });
});

test.describe('the new endpoints, per role', () => {
  test('refuses a student everything that belongs to staff', async ({ page }) => {
    const api = await signIn(page, STUDENT);

    const posts: [string, unknown][] = [
      ['/api/houses', { house: 'Iqbal', points: 50, reason: 'Being me' }],
      ['/api/societies', { name: 'E2E Society', isOpen: true }],
      ['/api/events', { title: 'E2E Event', startsAt: '2027-01-01T10:00:00.000Z' }],
      ['/api/careers', { type: 'SCHOLARSHIP', title: 'E2E Scholarship' }],
    ];

    for (const [path, data] of posts) {
      const response = await api.post(path, { data });
      expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
    }
  });

  test('never lets one student read another’s locker or profile', async ({ page }) => {
    const api = await signIn(page, STUDENT);

    const mine = await api.get('/api/profile');
    expect(mine.ok()).toBeTruthy();
    const me = (await mine.json()) as { studentId: string };

    // A classmate's id, taken from the leaderboard the student is allowed to see, is still
    // not a key to their documents.
    const board = await api.get('/api/leaderboard?metric=PAPERS&limit=50');
    expect(board.ok()).toBeTruthy();
    const { rows } = (await board.json()) as { rows: { studentId: string }[] };
    const other = rows.find((row) => row.studentId !== me.studentId);
    expect(other, 'the leaderboard must name somebody other than me').toBeTruthy();

    if (other) {
      for (const path of [
        `/api/documents?studentId=${other.studentId}`,
        `/api/profile?studentId=${other.studentId}`,
        `/api/identity/card?studentId=${other.studentId}`,
        `/api/badges?studentId=${other.studentId}`,
      ]) {
        const response = await api.get(path);
        expect([403, 404], `${path} returned ${response.status()}`).toContain(response.status());
      }
    }
  });

  test('refuses a parent the write endpoints and other families', async ({ page }) => {
    const api = await signIn(page, PARENT_PHONE);

    const societies = await api.post(
      '/api/societies/00000000-0000-4000-8000-000000000000/membership',
    );
    expect([403, 404]).toContain(societies.status());

    const house = await api.post('/api/houses', {
      data: { house: 'Iqbal', points: 10, reason: 'My child is wonderful' },
    });
    expect([403, 404]).toContain(house.status());
  });
});
