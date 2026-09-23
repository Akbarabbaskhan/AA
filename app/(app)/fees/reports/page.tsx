import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Money } from '@/components/features/fees/money';
import { CollectionChart } from '@/components/features/fees/collection-chart';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { getCollectionReport } from '@/lib/services/fees/reports';

export const dynamic = 'force-dynamic';

export default async function FeeReportsPage() {
  const actor = await requireSessionActor();
  if (!can(actor, 'fee.read.school')) notFound();

  const t = await getTranslations('fees');
  const report = await withActor(actor, () => getCollectionReport(actor));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1">{t('collected')}</h1>

      <Card>
        <CardContent className="flex flex-wrap gap-6 pt-4">
          <Stat label={t('billed')} value={<Money paisa={report.totals.billed} />} />
          <Stat label={t('due')} value={<Money paisa={report.totals.due} />} />
          <Stat label={t('collected')} value={<Money paisa={report.totals.collected} />} />
          <Stat label={t('outstanding')} value={<Money paisa={report.totals.outstanding} />} />
          <Stat
            label={t('collectionRate', { rate: report.totals.rate })}
            value={
              <span data-numeric className="tabular-nums">
                {report.totals.rate}%
              </span>
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('period')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CollectionChart
            periods={report.byPeriod}
            labels={{ billed: t('billed'), collected: t('collected'), notYetDue: t('notYetDue') }}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 desktop:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('billed')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {report.byYearGroup.map((group) => (
                <li key={group.yearGroupName} className="flex justify-between gap-2 text-body">
                  <span className="text-[var(--text-secondary)]">{group.yearGroupName}</span>
                  <span>
                    <Money paisa={group.collected} /> / <Money paisa={group.billed} muted />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('method')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {report.byMethod.map((method) => (
                <li key={method.method} className="flex justify-between gap-2 text-body">
                  <span className="text-[var(--text-secondary)]">
                    {method.method} · {method.count}
                  </span>
                  <Money paisa={method.amount} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('lineItems')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {report.byFeeHead.map((head) => (
              <li key={head.label} className="flex justify-between gap-2 text-body">
                <span className="text-[var(--text-secondary)]">{head.label}</span>
                <Money paisa={head.billed} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
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
