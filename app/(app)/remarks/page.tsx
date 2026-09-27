import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { RemarkForm } from '@/components/features/remarks/remark-form';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { listRemarks } from '@/lib/services/remarks';
import { listStudents } from '@/lib/services/students';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * Merits and demerits.
 *
 * A teacher sees every note about the students they teach, not only their own — pastoral care
 * needs the whole child. What they see about a student a colleague wrote is the same thing the
 * colleague would tell them in the staff room; what the family sees is only what somebody
 * chose to share.
 */
export default async function RemarksPage({
  searchParams,
}: {
  searchParams: { studentId?: string; type?: string };
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('remarks');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';
  const canWrite = can(actor, 'remark.write');

  const { rows, students } = await withActor(actor, async () => ({
    rows: await listRemarks(actor, {
      visibleToParentOnly: false,
      limit: 100,
      ...(searchParams.studentId ? { studentId: searchParams.studentId } : {}),
      ...(searchParams.type === 'MERIT' || searchParams.type === 'DEMERIT'
        ? { type: searchParams.type }
        : {}),
    }),
    // The pool the form can write about: exactly the students this actor may already see.
    students: canWrite ? await listStudents(actor, { limit: 200 }) : null,
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">{t('title')}</h1>
          <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
        </div>
        {students && students.items.length > 0 ? (
          <RemarkForm
            students={students.items.map((student) => ({
              id: student.id,
              name: student.name,
              rollNumber: student.rollNumber,
            }))}
          />
        ) : null}
      </header>

      {rows.length === 0 ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="remark-list">
          {rows.map((remark) => (
            <li key={remark.id}>
              <Card>
                <CardContent className="flex flex-col gap-1 pt-4" data-testid="remark-row">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-body font-medium text-[var(--text-primary)]">
                      {remark.studentName}{' '}
                      <span data-numeric className="font-mono text-small text-[var(--text-tertiary)]">
                        {remark.rollNumber}
                      </span>
                    </span>
                    <span
                      className={
                        remark.type === 'MERIT'
                          ? 'text-small text-[var(--success)]'
                          : 'text-small text-[var(--warning)]'
                      }
                      data-testid="remark-type-badge"
                    >
                      {remark.type === 'MERIT' ? t('merit') : t('demerit')}
                      {remark.severity > 1 ? ` · ${t('severityShort', { level: remark.severity })}` : ''}
                    </span>
                  </div>

                  <p className="text-body text-[var(--text-primary)]">{remark.body}</p>

                  <div className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                    <span>{remark.isMine ? t('byYou') : remark.staffName}</span>
                    <span>{formatDate(new Date(remark.createdAt), locale)}</span>
                    <span data-testid="remark-visibility">
                      {remark.isVisibleToParent ? t('familyToldYes') : t('familyToldNo')}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
