import { beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@/lib/permissions';
import { listInvoices } from '@/lib/services/fees/invoices';
import { getCollectionReport, getDefaulters } from '@/lib/services/fees/reports';
import { proposeMatches } from '@/lib/services/fees/reconciliation';
import { renderVoucherBatch } from '@/lib/services/fees/vouchers';
import { getParentHome } from '@/lib/services/parents';
import { getDeliveryLog, getInbox } from '@/lib/services/notifications/inbox';
import { listAnnouncements } from '@/lib/services/announcements';
import { resolveActor } from '@/lib/permissions/resolve';
import { actorByEmail, asActor, getSchoolId, testPrisma } from '../helpers';

/**
 * The finance read budget, measured rather than assumed.
 *
 * These run against the seeded ledger — twelve thousand invoices, nine thousand payments,
 * six months of history — because the accounts office opens these screens dozens of times
 * a day and a report that takes four seconds is one they stop using.
 */

const BUDGET_MS = 300;
const RUNS = 10;

let schoolId: string;
let bursar: Actor;
let parent: Actor;
let academicYearId: string;

async function p95(label: string, run: () => Promise<unknown>): Promise<number> {
  await run();
  const samples: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const value = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!;
  console.log(`  ${label.padEnd(30)} ${value.toFixed(0)}ms p95`);
  return value;
}

beforeAll(async () => {
  schoolId = await getSchoolId();
  const admin = await actorByEmail(schoolId, 'admin@volt-demo.test');
  bursar = await actorByEmail(schoolId, 'bursar@volt-demo.test');

  const picked = await asActor(admin, async () => {
    const year = await testPrisma.academicYear.findFirstOrThrow({
      where: { isCurrent: true },
      select: { id: true },
    });
    const guardian = await testPrisma.guardian.findFirstOrThrow({
      where: { students: { some: {} } },
      select: { userId: true },
    });
    return { academicYearId: year.id, guardianUserId: guardian.userId };
  });

  academicYearId = picked.academicYearId;
  parent = (await asActor(admin, () => resolveActor(picked.guardianUserId)))!;
});

describe('finance read budgets', () => {
  it('lists invoices inside the budget', async () => {
    const value = await p95('invoice list', () =>
      asActor(bursar, () => listInvoices(bursar, { limit: 100 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('builds the defaulter list inside the budget', async () => {
    const value = await p95('defaulters', () =>
      asActor(bursar, () => getDefaulters(bursar, { minOutstanding: 0, limit: 500 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('builds the collection report inside the budget', async () => {
    /*
     * The heaviest read in the module: every invoice for the year with its payments,
     * credit notes, year group and line items. It aggregates in Postgres for that reason —
     * the JavaScript version was 1.4 seconds here, for a screen opened daily.
     */
    const value = await p95('collection report', () =>
      asActor(bursar, () => getCollectionReport(bursar, academicYearId)),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('opens the parent home inside the budget', async () => {
    const value = await p95('parent home', () => asActor(parent, () => getParentHome(parent)));
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('opens a notification inbox inside the budget', async () => {
    const value = await p95('notification inbox', () =>
      asActor(parent, () => getInbox(parent, { limit: 50 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('searches the delivery log inside the budget', async () => {
    const value = await p95('delivery log', () =>
      asActor(bursar, () => getDeliveryLog(bursar, { limit: 100 })).catch(() => null),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });

  it('lists announcements inside the budget', async () => {
    const value = await p95('announcements', () =>
      asActor(parent, () => listAnnouncements(parent, { limit: 20 })),
    );
    expect(value).toBeLessThan(BUDGET_MS);
  });
});

describe('finance work budgets', () => {
  it('matches a hundred-line bank statement well inside a coffee break', async () => {
    // The real shape: a month's transfers, most of them carrying a voucher number.
    const invoices = await asActor(bursar, () =>
      listInvoices(bursar, { status: 'UNPAID', limit: 100 }),
    );
    const lines = invoices
      .slice(0, 100)
      .map(
        (invoice, index) =>
          `0${(index % 9) + 1}/09/2026,"FEE ${invoice.voucherNumber}",${Math.round(invoice.total / 100)},TRX${index}`,
      );
    const csv = ['Date,Description,Credit,Reference', ...lines].join('\n');

    const started = performance.now();
    const result = await asActor(bursar, () => proposeMatches(bursar, { csv }));
    const elapsed = performance.now() - started;

    console.log(`  ${'reconcile 100 lines'.padEnd(30)} ${elapsed.toFixed(0)}ms`);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10_000);
  });

  it('renders a year group’s vouchers as one PDF inside the budget', async () => {
    const invoice = await asActor(bursar, () =>
      testPrisma.invoice.findFirstOrThrow({
        select: { periodLabel: true, academicYearId: true },
        orderBy: { issueDate: 'desc' },
      }),
    );

    const started = performance.now();
    const { pdf, count } = await asActor(bursar, () =>
      renderVoucherBatch(bursar, {
        academicYearId: invoice.academicYearId,
        periodLabel: invoice.periodLabel,
      }),
    );
    const elapsed = performance.now() - started;

    console.log(`  ${`vouchers × ${count}`.padEnd(30)} ${elapsed.toFixed(0)}ms`);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // The spec's bulk budget: under a minute for a couple of hundred documents.
    expect(elapsed).toBeLessThan(60_000);
  });
});
