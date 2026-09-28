import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { PredictionGrid } from '@/components/features/exams/prediction-grid';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { can, hasRole } from '@/lib/permissions';
import { listPredictions } from '@/lib/services/exams/predictions';
import { parseBands } from '@/lib/services/grading/bands';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Predicted grades, section by section.
 *
 * Desktop-first: this is twenty-eight judgements made in one sitting with a mark book open,
 * which is spreadsheet-shaped work. The section picker is a plain list of the sections this
 * teacher actually teaches.
 */
export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: { sectionId?: string };
}) {
  const actor = await requireSessionActor();
  await requireModule(actor, 'exams');
  const t = await getTranslations('predictions');

  const { sections, rows, grades } = await withActor(actor, async () => {
    const mine = await prisma.section.findMany({
      where: {
        academicYear: { isCurrent: true },
        ...(hasRole(actor, 'ADMIN') || can(actor, 'marks.moderate')
          ? {}
          : { teacherId: actor.staffId ?? '' }),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, subject: { select: { name: true } } },
      take: 200,
    });

    const scale = await prisma.gradingScale.findFirst({
      where: { isDefault: true },
      select: { bandsJson: true },
    });

    const sectionId = searchParams.sectionId ?? mine[0]?.id;

    return {
      sections: mine,
      grades: parseBands(scale?.bandsJson ?? []).map((band) => band.grade),
      rows: sectionId ? await listPredictions(actor, { sectionId }) : [],
    };
  });

  const activeId = searchParams.sectionId ?? sections[0]?.id;

  if (sections.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('noSections')} body={t('noSectionsBody')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label={t('sections')}>
        {sections.slice(0, 40).map((section) => (
          <Link
            key={section.id}
            href={`/exams/predictions?sectionId=${section.id}`}
            aria-current={section.id === activeId ? 'page' : undefined}
            className={[
              'min-h-tap rounded-pill border px-3 py-2 text-small',
              section.id === activeId
                ? 'border-[var(--accent)] text-[var(--text-primary)]'
                : 'border-[var(--border-subtle)] text-[var(--text-tertiary)]',
            ].join(' ')}
            data-testid="prediction-section"
          >
            {section.name}
          </Link>
        ))}
      </nav>

      <Card>
        <CardContent className="pt-4">
          {rows.length === 0 ? (
            <EmptyState title={t('noStudents')} />
          ) : can(actor, 'predictedgrade.set') ? (
            <PredictionGrid sectionId={activeId!} rows={rows} grades={grades} />
          ) : (
            <ul className="flex flex-col gap-1" data-testid="prediction-readonly">
              {rows.map((row) => (
                <li key={row.studentId} className="flex justify-between gap-2 text-body">
                  <span>
                    {row.studentName}{' '}
                    <span className="font-mono text-small text-[var(--text-tertiary)]">
                      {row.rollNumber}
                    </span>
                  </span>
                  <span>{row.teacherGrade ?? row.suggestedGrade ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
