import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BoardResultsForm } from '@/components/features/reports/board-results-form';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { can } from '@/lib/permissions';
import { buildReport, reportQuerySchema } from '@/lib/services/reports';
import { REPORT_KEYS, type ReportKey } from '@/lib/services/reports/definitions';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * One report.
 *
 * Tables on screen, and the same figures a click away as Excel or PDF. The export links are
 * plain anchors rather than buttons that fetch: a download that works when somebody
 * right-clicks and opens it in a new tab is one fewer thing to explain.
 */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: { key: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  await requireModule(actor, 'reports');

  if (!REPORT_KEYS.includes(params.key as ReportKey)) notFound();
  const key = params.key as ReportKey;

  const t = await getTranslations('reports');

  const query = reportQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const { report, series, sessions } = await withActor(actor, async () => ({
    report: await buildReport(actor, key, query),
    series:
      key === 'academic-performance'
        ? await prisma.examSeries.findMany({
            where: { isPublished: true },
            orderBy: { startDate: 'desc' },
            take: 8,
            select: { id: true, name: true },
          })
        : [],
    sessions:
      key === 'board-results'
        ? await prisma.boardResult.groupBy({ by: ['session'], orderBy: { session: 'desc' } })
        : [],
  }));

  const exportHref = (format: 'xlsx' | 'pdf') => {
    const params = new URLSearchParams({ format });
    for (const [name, value] of Object.entries(query)) {
      if (typeof value === 'string') params.set(name, value);
    }
    return `/api/reports/${key}?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-small text-[var(--text-tertiary)]">
            <Link href="/reports" className="underline-offset-4 hover:underline">
              {t('title')}
            </Link>
          </p>
          <h1 className="text-h1">{report.title}</h1>
          <p className="text-small text-[var(--text-secondary)]">{report.subtitle}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <a href={exportHref('xlsx')} data-testid="report-export-xlsx">
              {t('exportExcel')}
            </a>
          </Button>
          <Button asChild variant="secondary">
            <a href={exportHref('pdf')} data-testid="report-export-pdf">
              {t('exportPdf')}
            </a>
          </Button>
        </div>
      </header>

      {/* The report's own parameter, where it has one. */}
      {key === 'daily-attendance' ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-small text-[var(--text-tertiary)]">{t('date')}</span>
            <input
              type="date"
              name="date"
              defaultValue={query.date ?? ''}
              className="min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body"
              data-testid="report-date"
            />
          </label>
          <Button type="submit" variant="secondary">
            {t('apply')}
          </Button>
        </form>
      ) : null}

      {key === 'academic-performance' && series.length > 0 ? (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-small text-[var(--text-tertiary)]">{t('series')}</span>
            <select
              name="examSeriesId"
              defaultValue={query.examSeriesId ?? ''}
              className="min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body"
              data-testid="report-series"
            >
              {series.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            {t('apply')}
          </Button>
        </form>
      ) : null}

      {key === 'board-results' ? (
        <div className="flex flex-col gap-2">
          {sessions.length > 0 ? (
            <form method="get" className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-small text-[var(--text-tertiary)]">{t('session')}</span>
                <select
                  name="session"
                  defaultValue={query.session ?? ''}
                  className="min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body"
                  data-testid="report-session"
                >
                  {sessions.map((entry) => (
                    <option key={entry.session} value={entry.session}>
                      {entry.session}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary">
                {t('apply')}
              </Button>
            </form>
          ) : null}
          {can(actor, 'exam.manage') ? <BoardResultsForm /> : null}
        </div>
      ) : null}

      <section className="grid gap-2 tablet:grid-cols-3" data-testid="report-headline">
        {report.headline.map((entry) => (
          <Card key={entry.label}>
            <CardContent className="flex flex-col gap-1 pt-4">
              <span className="text-small text-[var(--text-tertiary)]">{entry.label}</span>
              <span data-numeric className="text-h2 text-[var(--text-primary)]">
                {entry.value}
              </span>
            </CardContent>
          </Card>
        ))}
      </section>

      {report.tables.map((table) => (
        <Card key={table.name}>
          <CardContent className="flex flex-col gap-2 p-0 pt-4">
            <h2 className="px-3 text-h3">{table.name}</h2>

            {table.rows.length === 0 ? (
              <p className="px-3 pb-3 text-small text-[var(--text-tertiary)]">{t('nothing')}</p>
            ) : (
              /* A report is spreadsheet-shaped work: the table scrolls inside its own card
                 rather than pushing the page sideways on a phone. */
              <div className="overflow-x-auto pb-3">
                <table className="w-full min-w-[40rem] text-body" data-testid="report-table">
                  <caption className="sr-only">{table.name}</caption>
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-small text-[var(--text-secondary)]">
                      {table.columns.map((column) => (
                        <th key={column.header} scope="col" className="p-2 text-start font-medium">
                          {column.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.slice(0, 200).map((row, rowIndex) => (
                      <tr
                        key={`${table.name}-${rowIndex}`}
                        className="border-b border-[var(--border-subtle)] last:border-0"
                      >
                        {row.map((value, index) => (
                          <td
                            key={`${table.name}-${rowIndex}-${index}`}
                            className={
                              typeof value === 'number' ? 'p-2 text-end tabular-nums' : 'p-2'
                            }
                            {...(typeof value === 'number' ? { 'data-numeric': true } : {})}
                          >
                            {value === null || value === undefined
                              ? '—'
                              : typeof value === 'boolean'
                                ? value
                                  ? t('yes')
                                  : t('no')
                                : String(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {table.rows.length > 200 ? (
                  <p className="px-3 pt-2 text-small text-[var(--text-tertiary)]">
                    {t('truncated', { shown: 200, total: table.rows.length })}
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
