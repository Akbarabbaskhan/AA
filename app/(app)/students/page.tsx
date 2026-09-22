import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Button } from '@/components/ui/button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { listStudents } from '@/lib/services/students';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

/**
 * The student list. Desktop-first — this is spreadsheet-shaped work — but the table
 * collapses to stacked cards below 768px rather than scrolling sideways on a phone.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: { search?: string };
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('students');

  const page = await withActor(actor, () =>
    listStudents(actor, { limit: 50, ...(searchParams.search ? { search: searchParams.search } : {}) }),
  );

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h1">{t('title')}</h1>
        {can(actor, 'import.run') ? (
          <Button asChild variant="secondary">
            <Link href="/students/import">{t('importTitle')}</Link>
          </Button>
        ) : null}
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
          {t('search')}
        </Button>
      </form>

      {page.items.length === 0 ? (
        <EmptyState title={t('noResults')} body={t('noResultsBody')} />
      ) : (
        <>
          {/* Cards on a phone, a table from 768px — never a sideways-scrolling table. */}
          <ul className="flex flex-col gap-1 tablet:hidden">
            {page.items.map((student) => (
              <li key={student.id}>
                <Card>
                  <CardContent className="flex items-center gap-2 p-2">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body font-medium">{student.name}</span>
                      <span data-numeric className="font-mono text-small text-[var(--text-tertiary)]">
                        {student.rollNumber} · {student.yearGroup ?? '—'}
                      </span>
                    </span>
                    <span className="shrink-0 text-small text-[var(--text-secondary)]">
                      {student.house ?? ''}
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <div className="hidden tablet:block">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-body">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-start text-small text-[var(--text-secondary)]">
                      <th scope="col" className="p-2 text-start font-medium">
                        {t('rollNumber')}
                      </th>
                      <th scope="col" className="p-2 text-start font-medium">
                        {t('title')}
                      </th>
                      <th scope="col" className="p-2 text-start font-medium">
                        {t('admissionNumber')}
                      </th>
                      <th scope="col" className="p-2 text-start font-medium">
                        {t('yearGroup')}
                      </th>
                      <th scope="col" className="p-2 text-start font-medium">
                        {t('house')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((student) => (
                      <tr key={student.id} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td className="p-2 font-mono">{student.rollNumber}</td>
                        <td className="p-2">{student.name}</td>
                        <td className="p-2 font-mono">{student.admissionNumber}</td>
                        <td className="p-2">{student.yearGroup ?? '—'}</td>
                        <td className="p-2">{student.house ?? '—'}</td>
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
