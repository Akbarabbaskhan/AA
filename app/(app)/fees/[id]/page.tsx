import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Money, StatusChip, toneForStatus } from '@/components/features/fees/money';
import { RecordPayment } from '@/components/features/fees/record-payment';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { ForbiddenError, can } from '@/lib/permissions';
import { getInvoice } from '@/lib/services/fees/invoices';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const actor = await requireSessionActor();
  const t = await getTranslations('fees');

  try {
    const invoice = await withActor(actor, () => getInvoice(actor, params.id));
    const canRecord = can(actor, 'payment.record');

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="font-mono text-small text-[var(--text-tertiary)]">{invoice.voucherNumber}</p>
          <h1 className="text-h1">{invoice.periodLabel}</h1>
          <p className="flex flex-wrap items-center gap-2 text-small text-[var(--text-tertiary)]">
            <span>
              {invoice.rollNumber} · {invoice.studentName}
            </span>
            <StatusChip label={t(`status${invoice.status}`)} tone={toneForStatus(invoice.status)} />
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{t('lineItems')}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-body">
              <tbody>
                {invoice.lineItems.map((item) => (
                  <tr key={`${item.feeHeadId}-${item.label}`}>
                    <td className="py-1 text-[var(--text-secondary)]">{item.label}</td>
                    <td className="py-1 text-end">
                      <Money paisa={item.amountPaisa} />
                    </td>
                  </tr>
                ))}
                {invoice.discount > 0 ? (
                  <tr>
                    <td className="py-1 text-[var(--text-secondary)]">{t('discount')}</td>
                    <td className="py-1 text-end text-[var(--success)]">
                      −<Money paisa={invoice.discount} className="text-[var(--success)]" />
                    </td>
                  </tr>
                ) : null}
                <tr className="border-t border-[var(--border-subtle)]">
                  <td className="py-2 font-medium">{t('total')}</td>
                  <td className="py-2 text-end text-h3">
                    <Money paisa={invoice.total} />
                  </td>
                </tr>
                {invoice.paid > 0 || invoice.credited > 0 ? (
                  <tr>
                    <td className="py-1 text-[var(--text-secondary)]">{t('paid')}</td>
                    <td className="py-1 text-end">
                      <Money paisa={invoice.paid + invoice.credited} />
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td className="py-1 font-medium">{t('outstanding')}</td>
                  <td className="py-1 text-end text-h3">
                    <Money paisa={invoice.outstanding} />
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        <a
          href={`/api/fees/invoices/${invoice.id}/voucher`}
          target="_blank"
          rel="noreferrer"
          className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-center text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
          data-testid="download-voucher"
        >
          {t('downloadVoucher')}
        </a>

        {invoice.payments.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('paymentHistory')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {invoice.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap justify-between gap-2 text-body">
                    <span className="text-[var(--text-secondary)]">
                      {payment.paidAt.slice(0, 10)} · {payment.method}
                      {payment.reference ? ` · ${payment.reference}` : ''}
                    </span>
                    <Money paisa={payment.amount} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {canRecord && invoice.outstanding > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('recordPayment')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RecordPayment invoiceId={invoice.id} outstandingPaisa={invoice.outstanding} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
