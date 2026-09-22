import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { PublishButton } from '@/components/features/exams/publish-button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { listExamSeries } from '@/lib/services/exams/series';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils/cn';

export const dynamic = 'force-dynamic';

/**
 * The staff view of exam series: what is set up, how much of it has marks in, and — for
 * whoever may — the button that publishes the whole thing at once.
 */
export default async function ExamsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('exams');

  const schoolWide = can(actor, 'marks.read.school');

  const { series, papersBySeries, subjectsBySeries } = await withActor(actor, async () => {
    const list = await listExamSeries(actor);
    const seriesIds = list.map((entry) => entry.id);

    /*
     * Two shapes, because two people are reading this.
     *
     * A teacher or HOD is scoped to a handful of sections, so listing their own papers is
     * exactly what they want. A coordinator is scoped to the whole campus — 831 papers in
     * one series — so a flat list is noise; they get progress per subject and reach an
     * individual paper through the teacher's own view.
     */
    const papers = schoolWide
      ? []
      : await prisma.assessment.findMany({
          where: { examSeriesId: { in: seriesIds }, sectionId: { in: [...actor.sectionIds] } },
          select: {
            id: true,
            title: true,
            examSeriesId: true,
            section: { select: { name: true, subject: { select: { name: true } } } },
            _count: { select: { marks: true } },
          },
          orderBy: [{ section: { subject: { name: 'asc' } } }, { title: 'asc' }],
          take: 100,
        });

    const grouped = new Map<string, typeof papers>();
    for (const paper of papers) {
      grouped.set(paper.examSeriesId, [...(grouped.get(paper.examSeriesId) ?? []), paper]);
    }

    // Per-subject progress, aggregated in the database rather than by counting rows here.
    const subjectRows = schoolWide
      ? await prisma.$queryRaw<
          { examSeriesId: string; subjectName: string; papers: bigint; marks: bigint }[]
        >`
          SELECT a.exam_series_id AS "examSeriesId",
                 s.name           AS "subjectName",
                 COUNT(DISTINCT a.id) AS "papers",
                 COUNT(m.id)          AS "marks"
          FROM assessments a
          JOIN sections sec ON sec.id = a.section_id
          JOIN subjects s   ON s.id = sec.subject_id
          LEFT JOIN marks m ON m.assessment_id = a.id
          WHERE a.school_id = ${actor.schoolId}
            AND a.exam_series_id = ANY(${seriesIds}::text[])
          GROUP BY a.exam_series_id, s.name
          ORDER BY s.name
        `
      : [];

    const bySubject = new Map<string, { subjectName: string; papers: number; marks: number }[]>();
    for (const row of subjectRows) {
      bySubject.set(row.examSeriesId, [
        ...(bySubject.get(row.examSeriesId) ?? []),
        { subjectName: row.subjectName, papers: Number(row.papers), marks: Number(row.marks) },
      ]);
    }

    return { series: list, papersBySeries: grouped, subjectsBySeries: bySubject };
  });

  if (series.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('noSeries')} body={t('noSeriesBody')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-h1">{t('title')}</h1>

      {series.map((entry) => {
        const papers = papersBySeries.get(entry.id) ?? [];
        return (
          <Card key={entry.id}>
            <CardHeader>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle>{entry.name}</CardTitle>
                <span
                  className={cn(
                    'rounded-pill px-2 py-1 text-small font-medium',
                    entry.isPublished
                      ? 'bg-[var(--surface)] text-[var(--success)]'
                      : 'bg-[var(--surface)] text-[var(--text-secondary)]',
                  )}
                >
                  {entry.isPublished ? t('published') : t('draft')}
                </span>
              </div>
              <p className="text-small text-[var(--text-secondary)]">
                {t('papers', { count: entry.assessmentCount })} ·{' '}
                {t('marksProgress', {
                  entered: entry.marksEntered,
                  expected: entry.marksExpected,
                })}
              </p>
            </CardHeader>

            <CardContent className="flex flex-col gap-2">
              {schoolWide ? (
                <ul className="flex flex-col gap-1">
                  {(subjectsBySeries.get(entry.id) ?? []).map((subject) => (
                    <li
                      key={subject.subjectName}
                      className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-1 last:border-0"
                    >
                      <span className="truncate text-body">{subject.subjectName}</span>
                      <span data-numeric className="shrink-0 text-small text-[var(--text-secondary)]">
                        {t('papers', { count: subject.papers })} ·{' '}
                        {t('marksProgress', { entered: subject.marks, expected: subject.marks })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : papers.length === 0 ? (
                <p className="text-small text-[var(--text-tertiary)]">{t('noSeriesBody')}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {papers.map((paper) => (
                    <li key={paper.id}>
                      <Link
                        href={`/marks/${paper.id}`}
                        className="flex min-h-tap items-center justify-between gap-2 rounded-card border border-[var(--border-subtle)] px-2 py-1 transition-colors duration-base ease-out hover:border-[var(--border-strong)]"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-body">
                            {paper.section.subject.name} · {paper.title}
                          </span>
                          <span className="truncate text-small text-[var(--text-tertiary)]">
                            {paper.section.name}
                          </span>
                        </span>
                        <span className="shrink-0 text-small text-[var(--text-secondary)]">
                          {paper._count.marks > 0 ? `${paper._count.marks}` : t('openGrid')}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {can(actor, 'exam.publish') ? (
                <PublishButton examSeriesId={entry.id} isPublished={entry.isPublished} />
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
