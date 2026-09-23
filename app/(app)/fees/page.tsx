import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Money, StatusChip, toneForStatus } from '@/components/features/fees/money';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { invoiceQuerySchema, listInvoices } from '@/lib/services/fees/invoices';
import { getCollectionReport } from '@/lib/services/fees/reports';

export const dynamic = 'force-dynamic';

/**
 * Fees.
 *
 * The same route serves three very different people, because they want the same object
 * from different distances: a bursar wants the school's ledger, a parent wants this
 * month's voucher, a student wants to know whether they owe anything.
 */
export default async function FeesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('fees');

  const isBursar = can(actor, 'fee.read.school');
  const query = invoiceQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const { invoices, report } = await withActor(actor, async () => ({
    invoices: await listInvoices(actor, query),
    report: isBursar ? await getCollectionReport(actor) : null,
  }));

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState
          title={isBursar ? t('none') : t('noneStudent')}
          body={isBursar ? t('noneBody') : t('noneStudentBody')}
        />
      </div>
    );
  }

  const outstanding = invoices.reduce((sum, invoice) => sum + invoice.outstanding, 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1">{t('title')}</h1>

      {report ? (
        <Card>
          <CardContent className="flex flex-wrap gap-6 pt-4">
            <Stat label={t('billed')} value={<Money paisa={report.totals.billed} />} />
            <Stat label={t('collected')} value={<Money paisa={report.totals.collected} />} />
            <Stat label={t('outstanding')} value={<Money paisa={report.totals.outstanding} />} />
            <Stat
              label={t('collectionRate', { rate: report.totals.rate })}
              value={
                <span data-numeric className="text-h2 text-[var(--text-primary)]">
                  {report.totals.rate}%
                </span>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-baseline justify-between gap-3 pt-4">
            <span className="text-small text-[var(--text-tertiary)]">{t('outstanding')}</span>
            <span className="text-h1">
              <Money paisa={outstanding} />
            </span>
          </CardContent>
        </Card>
      )}

      <ul className="flex flex-col gap-2" data-testid="invoice-list">
        {invoices.map((invoice) => (
          <li key={invoice.id}>
            <Link
              href={`/fees/${invoice.id}`}
              className="flex min-h-tap flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              data-testid="invoice-row"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-small text-[var(--text-tertiary)]">
                  {invoice.voucherNumber}
                </span>
                <StatusChip label={t(`status${invoice.status}`)} tone={toneForStatus(invoice.status)} />
              </span>

              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body text-[var(--text-primary)]">
                  {isBursar ? `${invoice.rollNumber} · ${invoice.studentName}` : invoice.periodLabel}
                </span>
                <span className="text-body">
                  <Money paisa={invoice.outstanding > 0 ? invoice.outstanding : invoice.total} />
                </span>
              </span>

              <span className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                {isBursar ? <span>{invoice.periodLabel}</span> : null}
                <span>
                  {t('due')} {invoice.dueDate}
                </span>
                {invoice.daysOverdue > 0 ? (
                  <span className="text-[var(--danger)]">
                    {t('daysOverdue', { days: invoice.daysOverdue })}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-small text-[var(--text-tertiary)]">{label}</span>
      <span className="text-h2 text-[var(--text-primary)]">{value}</span>
    </div>
  );
}
