import { getTranslations } from 'next-intl/server';
import { Reconciler } from '@/components/features/fees/reconciler';
import { requireSessionActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ReconcilePage() {
  const actor = await requireSessionActor();
  if (!can(actor, 'payment.reconcile')) notFound();

  const t = await getTranslations('reconcile');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>
      <Reconciler />
    </div>
  );
}
