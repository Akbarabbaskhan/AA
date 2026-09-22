import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getWeaknessMap, type MasteryTopic } from '@/lib/services/quizzes/mastery';

export const dynamic = 'force-dynamic';

/**
 * The weakness map.
 *
 * Form: ranking, not change over time. So bars, ordered weakest first, with the confident
 * ones separated from the provisional — telling a student "you are weak at Genetics" on the
 * strength of two questions is how a feature like this loses trust in a week.
 *
 * Deliberately no colour ramp across the bars. Length already encodes the value; adding a
 * red-to-green ramp would double-encode it and make a 48% topic look like a crisis next to
 * a 52% one.
 */
export default async function MasteryPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('mastery');

  const studentId = actor.studentId ?? actor.childStudentIds[0];
  if (!studentId) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={t('noneBody')} />
      </div>
    );
  }

  const map = await withActor(actor, () => getWeaknessMap(studentId));

  if (map.subjects.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={t('noneBody')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      {map.weakest.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('weakest')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2" data-testid="weakest-topics">
              {map.weakest.map((topic) => (
                <TopicBar key={`${topic.subjectId}:${topic.topicTag}`} topic={topic} showSubject />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {map.subjects.map((subject) => (
        <Card key={subject.subjectId}>
          <CardHeader>
            <CardTitle>{subject.subjectName}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {subject.topics.map((topic) => (
                <TopicBar key={topic.topicTag} topic={topic} showSubject={false} />
              ))}
            </ul>

            <div className="sr-only">
              <table>
                <caption>{`${subject.subjectName} topic mastery`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Topic</th>
                    <th scope="col">Mastery</th>
                    <th scope="col">Answers</th>
                  </tr>
                </thead>
                <tbody>
                  {subject.topics.map((topic) => (
                    <tr key={topic.topicTag}>
                      <th scope="row">{topic.topicTag}</th>
                      <td>{topic.percent}%</td>
                      <td>{topic.sampleSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function TopicBar({ topic, showSubject }: { topic: MasteryTopic; showSubject: boolean }) {
  const t = await getTranslations('mastery');

  return (
    <li className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-body text-[var(--text-primary)]">
        {topic.topicTag}
        {showSubject ? (
          <span className="block text-small text-[var(--text-tertiary)]">{topic.subjectName}</span>
        ) : null}
      </span>

      <span
        className="relative h-3 flex-1 overflow-hidden rounded-pill bg-[var(--surface)]"
        role="img"
        aria-label={`${topic.topicTag}: ${topic.percent}%`}
      >
        <span
          className="absolute inset-y-0 start-0 rounded-pill"
          style={{
            width: `${topic.percent}%`,
            // A provisional score is drawn recessively rather than in the accent: the bar
            // should not look as authoritative as the number it is not yet entitled to be.
            backgroundColor: topic.isConfident ? 'var(--accent)' : 'var(--border-strong)',
          }}
        />
      </span>

      <span className="w-24 shrink-0 text-end">
        <span data-numeric className="text-body text-[var(--text-primary)]">
          {topic.percent}%
        </span>
        <span className="block text-small text-[var(--text-tertiary)]">
          {topic.isConfident ? t('sampleSize', { count: topic.sampleSize }) : t('provisional')}
        </span>
      </span>
    </li>
  );
}
