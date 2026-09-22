import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ImportWizard } from '@/components/features/students/import-wizard';
import { requireSessionActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function ImportStudentsPage() {
  const actor = await requireSessionActor();
  // The capability is checked again in the API handler; this only keeps the page honest.
  if (!can(actor, 'import.run')) redirect('/students');

  const t = await getTranslations('students');

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-h1">{t('importTitle')}</h1>
      <ImportWizard />
    </div>
  );
}
