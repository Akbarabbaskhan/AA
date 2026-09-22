import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkingQueue } from '@/components/features/quizzes/marking-queue';
import { QuestionAnalysisRow } from '@/components/features/quizzes/question-analysis';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { ForbiddenError } from '@/lib/permissions';
import { getManualMarkingQueue, getQuizAnalysis } from '@/lib/services/quizzes/analysis';

export const dynamic = 'force-dynamic';

/**
 * What the teacher does with a quiz once the class has sat it.
 *
 * Reteach list first, then the marking queue, then question by question. The order is the
 * teacher's evening: decide what Monday looks like, clear the marking, then look at detail
 * only if something surprised them.
 */
export default async function QuizAnalysisPage({ params }: { params: { id: string } }) {
  const actor = await requireSessionActor();
  const t = await getTranslations('quizzes');

  try {
    const { analysis, queue } = await withActor(actor, async () => {
      const [quizAnalysis, markingQueue] = await Promise.all([
        getQuizAnalysis(actor, params.id),
        getManualMarkingQueue(actor, params.id),
      ]);
      return { analysis: quizAnalysis, queue: markingQueue };
    });

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-small text-[var(--text-tertiary)]">{t('analysis')}</p>
          <h1 className="text-h1">{analysis.title}</h1>
          <p className="text-small text-[var(--text-tertiary)]">
            {t('submitted', { count: analysis.submitted })} {t('ofClass', { count: analysis.enrolled })}
          </p>
        </header>

        <Card>
          <CardContent className="flex flex-wrap gap-6 pt-4">
            <Stat label={t('average')} value={analysis.averagePercent === null ? '—' : `${analysis.averagePercent}%`} />
            <Stat label={t('median')} value={analysis.medianPercent === null ? '—' : `${analysis.medianPercent}%`} />
            <Stat
              label={t('pendingMarking', { count: analysis.pendingManualMarking })}
              value={String(analysis.pendingManualMarking)}
            />
          </CardContent>
        </Card>

        {analysis.topics.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('reteach')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {analysis.topics.slice(0, 6).map((topic) => (
                  <li key={topic.topicTag} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-body text-[var(--text-primary)]">
                      {topic.topicTag}
                    </span>
                    <span className="relative h-3 flex-1 overflow-hidden rounded-pill bg-[var(--surface)]">
                      <span
                        className="absolute inset-y-0 start-0 rounded-pill bg-[var(--accent)]"
                        style={{ width: `${topic.averagePercent}%` }}
                      />
                    </span>
                    <span data-numeric className="w-10 shrink-0 text-end text-small text-[var(--text-tertiary)]">
                      {topic.averagePercent}%
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>{t('markingQueue')}</CardTitle>
          </CardHeader>
          <CardContent>
            <MarkingQueue quizId={params.id} items={queue} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('distractors')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {analysis.questions.map((question, index) => (
                <QuestionAnalysisRow
                  key={question.questionId}
                  analysis={question}
                  index={index}
                  labels={{
                    facility: t('facility'),
                    distractors: t('distractors'),
                    reteach: t('reteach'),
                    pending: t('awaitingMarking'),
                  }}
                />
              ))}
            </ol>
          </CardContent>
        </Card>

        {analysis.highTabSwitches.length > 0 ? (
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4">
              <p className="text-small text-[var(--text-tertiary)]">{t('tabSwitchNote')}</p>
              <ul className="flex flex-col gap-1">
                {analysis.highTabSwitches.map((row) => (
                  <li key={row.studentId} className="text-body text-[var(--text-primary)]">
                    {row.studentName} — {t('tabSwitches', { count: row.tabSwitches })}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-small text-[var(--text-tertiary)]">{label}</span>
      <span data-numeric className="text-h2 text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  );
}
