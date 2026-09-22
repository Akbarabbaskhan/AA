import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PracticeRunner, type PracticeState } from '@/components/features/papers/practice-runner';
import { PracticeTrendChart } from '@/components/features/papers/practice-trend-chart';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { getPaperLinks } from '@/lib/services/papers/vault';
import { getPracticeTrend, listAttempts } from '@/lib/services/papers/practice';

export const dynamic = 'force-dynamic';

const SESSION_LABEL: Record<string, string> = {
  MAY_JUNE: 'May / June',
  OCT_NOV: 'Oct / Nov',
  FEB_MARCH: 'Feb / March',
};

/**
 * One paper: open it, sit it under the clock, then mark it.
 *
 * The mark scheme link is not on this page. It is returned by the submit call and only
 * then — putting it in the server payload "hidden" until submit would put it in view-source
 * during the attempt, which is the same as not locking it at all.
 */
export default async function PaperPage({ params }: { params: { id: string } }) {
  const actor = await requireSessionActor();
  const t = await getTranslations('papers');
  const tp = await getTranslations('practice');

  const isStudent = Boolean(actor.studentId) && can(actor, 'attempt.create');

  try {
    const { paper, links, open, trend } = await withActor(actor, async () => {
      const found = await prisma.pastPaper.findFirst({
        where: { id: params.id },
        select: {
          id: true,
          year: true,
          session: true,
          variant: true,
          board: true,
          durationMinutes: true,
          totalMarks: true,
          topicTags: true,
          subject: { select: { name: true, code: true } },
          component: { select: { code: true, name: true } },
        },
      });
      if (!found) throw ApiError.notFound('Paper not found');

      const [paperLinks, attempts, practiceTrend] = await Promise.all([
        getPaperLinks(actor, params.id, { includeMarkScheme: !isStudent }),
        isStudent ? listAttempts(actor, { limit: 50 }) : Promise.resolve([]),
        isStudent ? getPracticeTrend(actor) : Promise.resolve(null),
      ]);

      const unsubmitted = attempts.find(
        (attempt) => attempt.pastPaperId === params.id && attempt.submittedAt === null,
      );

      return { paper: found, links: paperLinks, open: unsubmitted ?? null, trend: practiceTrend };
    });

    const durationMinutes = paper.durationMinutes ?? 90;
    const resume: PracticeState | null = open
      ? {
          attemptId: open.id,
          endsAt: new Date(
            new Date(open.startedAt).getTime() + durationMinutes * 60_000,
          ).toISOString(),
          paperUrl: links.paperUrl,
          totalMarks: paper.totalMarks ?? 100,
        }
      : null;

    const subjectTrend =
      trend?.subjects.find(
        (subject) =>
          subject.subjectCode === paper.subject.code &&
          subject.componentCode === (paper.component?.code ?? null),
      ) ?? null;

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-small text-[var(--text-tertiary)]">
            {paper.board} · {SESSION_LABEL[paper.session] ?? paper.session} {paper.year} ·{' '}
            {t('variant')} {paper.variant}
          </p>
          <h1 className="text-h1">
            {paper.subject.name} {paper.component?.code ?? ''}
          </h1>
          <p className="text-small text-[var(--text-tertiary)]">
            {t('duration', { minutes: durationMinutes })}
            {paper.totalMarks ? ` · ${t('totalMarks', { marks: paper.totalMarks })}` : ''}
          </p>
        </header>

        {isStudent ? (
          <Card>
            <CardHeader>
              <CardTitle>{tp('attempt')}</CardTitle>
            </CardHeader>
            <CardContent>
              <PracticeRunner
                pastPaperId={paper.id}
                totalMarks={paper.totalMarks ?? 100}
                resume={resume}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4">
              <a
                href={links.paperUrl}
                target="_blank"
                rel="noreferrer"
                className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-center text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              >
                {t('openPaper')}
              </a>
              {links.markSchemeUrl ? (
                <a
                  href={links.markSchemeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-center text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  {t('markScheme')}
                </a>
              ) : null}
              {links.examinerReportUrl ? (
                <a
                  href={links.examinerReportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-center text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
                >
                  {t('examinerReport')}
                </a>
              ) : null}
            </CardContent>
          </Card>
        )}

        {subjectTrend && trend && subjectTrend.points.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>{tp('trend')}</CardTitle>
            </CardHeader>
            <CardContent>
              <PracticeTrendChart
                subjectName={subjectTrend.subjectName}
                componentCode={subjectTrend.componentCode}
                points={subjectTrend.points}
                bands={trend.gradeBands}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
