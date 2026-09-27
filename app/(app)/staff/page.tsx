import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { listStaff } from '@/lib/services/staff';

export const dynamic = 'force-dynamic';

/**
 * The staff directory: who teaches what, and who runs each department.
 *
 * Desktop-first table, stacked cards on a phone — the same rule as the student list, because
 * a sideways-scrolling table is how a directory becomes unusable on the device a coordinator
 * actually has in the corridor.
 */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('staff');

  const page = await withActor(actor, () =>
    listStaff(actor, { limit: 100, ...(searchParams.search ? { search: searchParams.search } : {}) }),
  );

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-h1">{t('title')}</h1>
        <p data-numeric className="text-small text-[var(--text-tertiary)]" data-testid="staff-count">
          {t('count', { count: page.total })}
        </p>
      </header>

      <form method="get" className="flex gap-1">
        <input
          type="search"
          name="search"
          defaultValue={searchParams.search ?? ''}
          placeholder={t('search')}
          aria-label={t('search')}
          className="min-h-tap w-full rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body"
        />
        <Button type="submit" variant="secondary">
          {t('searchAction')}
        </Button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState title={t('noResults')} body={t('noResultsBody')} />
      ) : (
        <>
          <ul className="flex flex-col gap-1 tablet:hidden" data-testid="staff-list">
            {page.items.map((member) => (
              <li key={member.id}>
                <Card>
                  <CardContent className="flex flex-col gap-1 p-2">
                    <span className="text-body font-medium">{member.name}</span>
                    <span data-numeric className="font-mono text-small text-[var(--text-tertiary)]">
                      {member.employeeCode} · {member.departmentName ?? '—'}
                    </span>
                    <span className="text-small text-[var(--text-secondary)]">
                      {member.designation ?? '—'}
                      {member.headsDepartment ? ` · ${t('hod', { name: member.headsDepartment })}` : ''}
                      {member.sectionCount > 0 ? ` · ${t('sections', { count: member.sectionCount })}` : ''}
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <div className="hidden tablet:block">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-body" data-testid="staff-table">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-start text-small text-[var(--text-secondary)]">
                      <th scope="col" className="p-2 text-start font-medium">{t('code')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('name')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('department')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('designation')}</th>
                      <th scope="col" className="p-2 text-start font-medium">{t('load')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((member) => (
                      <tr key={member.id} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td className="p-2 font-mono">{member.employeeCode}</td>
                        <td className="p-2">
                          {member.name}
                          {member.headsDepartment ? (
                            <span className="ms-2 text-small text-[var(--accent)]">
                              {t('hod', { name: member.headsDepartment })}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-2">{member.departmentName ?? '—'}</td>
                        <td className="p-2">{member.designation ?? '—'}</td>
                        <td data-numeric className="p-2 tabular-nums">{member.sectionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
