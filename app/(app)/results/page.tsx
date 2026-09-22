import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { ComponentBreakdown } from '@/components/features/exams/component-breakdown';
import { GradeTrendChart } from '@/components/features/exams/grade-trend-chart';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getStudentResults } from '@/lib/services/exams/results';
import { cn } from '@/lib/utils/cn';

export const dynamic = 'force-dynamic';

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

/**
 * The student's results.
 *
 * Ordered by what a student actually wants: the trend first — the thing they screenshot —
 * then which paper is costing them, then the detail.
 */
export default async function ResultsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('exams');

  const studentId = actor.studentId ?? actor.childStudentIds[0];
  if (!studentId) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('results')}</h1>
        <EmptyState title={t('noResults')} body={t('noResultsBody')} />
      </div>
    );
  }

  const results = await withActor(actor, () => getStudentResults(actor, studentId));

  if (results.series.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('results')}</h1>
        <EmptyState title={t('noResults')} body={t('noResultsBody')} />
      </div>
    );
  }

  const latest = results.series.at(-1)!;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-small text-[var(--text-tertiary)]">{latest.name}</p>
        <h1 className="text-h1">{t('results')}</h1>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('gradeTrend')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 desktop:grid-cols-2">
          {results.trend.map((subject) => (
            <GradeTrendChart
              key={subject.subjectCode}
              subjectName={subject.subjectName}
              subjectCode={subject.subjectCode}
              points={subject.points}
              bands={results.gradeBands}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('componentBreakdown')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 desktop:grid-cols-2">
          {results.componentBreakdown.map((subject) => (
            <ComponentBreakdown
              key={subject.subjectCode}
              subjectName={subject.subjectName}
              weakest={subject.weakest}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('predictedGrade')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2">
            {results.predicted.map((entry) => (
              <li
                key={entry.subjectCode}
                className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 last:border-0"
              >
                <span className="text-body">{entry.subjectName}</span>
                <span className="flex items-center gap-3">
                  {/* Both predictions, clearly labelled as which is which. */}
                  <span className="flex flex-col items-end">
                    <span className="text-small text-[var(--text-tertiary)]">
                      {t('teacherPredicts')}
                    </span>
                    <span data-numeric className="text-body font-medium">
                      {entry.teacherGrade ?? '—'}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-small text-[var(--text-tertiary)]">
                      {t('systemSuggests')}
                    </span>
                    <span data-numeric className="text-body font-medium">
                      {entry.systemGrade ?? '—'}
                    </span>
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {results.series
        .slice()
        .reverse()
        .map((entry) => (
          <Card key={entry.examSeriesId}>
            <CardHeader>
              <CardTitle>{entry.name}</CardTitle>
              <p className="text-small text-[var(--text-secondary)]">
                {t('attendanceThisTerm')}: {formatPercent(entry.attendancePercent)}
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {entry.subjects.map((subject) => (
                <div key={subject.subjectCode} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-h3">{subject.subjectName}</span>
                    <span data-numeric className="text-h3">
                      {subject.grade ?? '—'}
                    </span>
                  </div>
                  {/*
                    Stacked on a phone, a table from 768px. A five-column paper breakdown
                    is 500px wide at its narrowest, and the spec is explicit: tables
                    collapse to cards below 768px and never scroll sideways.
                  */}
                  <ul className="flex flex-col gap-2 tablet:hidden">
                    {subject.components.map((component) => (
                      <li
                        key={component.code}
                        className="flex flex-col gap-1 rounded-input border border-[var(--border-subtle)] p-2"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate text-body">
                            {component.code} {component.name}
                          </span>
                          <span className="shrink-0 text-body font-medium">
                            {component.grade ?? '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-small text-[var(--text-secondary)]">
                          <span data-numeric>
                            {component.isAbsent || component.marksObtained === null
                              ? t('notSat')
                              : `${component.marksObtained} / ${component.totalMarks}`}
                          </span>
                          <span data-numeric>{formatPercent(component.percent)}</span>
                          <span data-numeric>
                            {t('subjectGrade')} {component.weightPercent}%
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <table className="hidden w-full text-small tablet:table">
                    <thead>
                      <tr className="text-[var(--text-tertiary)]">
                        <th scope="col" className="text-start font-normal">
                          Paper
                        </th>
                        <th scope="col" className="text-end font-normal">
                          Marks
                        </th>
                        <th scope="col" className="text-end font-normal">
                          %
                        </th>
                        <th scope="col" className="text-end font-normal">
                          Weight
                        </th>
                        <th scope="col" className="text-end font-normal">
                          Grade
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {subject.components.map((component) => (
                        <tr key={component.code}>
                          <td className="py-1">
                            {component.code} {component.name}
                          </td>
                          <td data-numeric className="py-1 text-end">
                            {component.isAbsent || component.marksObtained === null
                              ? t('notSat')
                              : `${component.marksObtained} / ${component.totalMarks}`}
                          </td>
                          <td data-numeric className="py-1 text-end">
                            {formatPercent(component.percent)}
                          </td>
                          <td data-numeric className="py-1 text-end">
                            {component.weightPercent}%
                          </td>
                          <td className="py-1 text-end">{component.grade ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className={cn('text-small text-[var(--text-secondary)]')}>
                    {t('classAverage')}: {formatPercent(subject.classAveragePercent)}
                    {subject.percentileBand ? ` · ${t('yourPosition')}: ${subject.percentileBand}` : ''}
                  </p>
                </div>
              ))}

              <a
                href={`/api/result-cards?examSeriesId=${entry.examSeriesId}&studentId=${studentId}`}
                className="min-h-tap py-1 text-body text-[var(--accent)] underline"
              >
                {t('downloadCard')}
              </a>
            </CardContent>
          </Card>
        ))}
    </div>
  );
}
