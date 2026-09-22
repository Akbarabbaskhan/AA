import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GradingList } from '@/components/features/assignments/grading-list';
import { SubmitForm } from '@/components/features/assignments/submit-form';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { can, ForbiddenError } from '@/lib/permissions';
import { getAssignment, getSubmissions } from '@/lib/services/assignments';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

export default async function AssignmentPage({ params }: { params: { id: string } }) {
  const actor = await requireSessionActor();
  const t = await getTranslations('assignments');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const isStaff = can(actor, 'assignment.manage');

  try {
    const { assignment, submissions } = await withActor(actor, async () => {
      const detail = await getAssignment(actor, params.id);
      const rows = isStaff ? await getSubmissions(actor, params.id) : [];
      return { assignment: detail, submissions: rows };
    });

    const isOverdue = new Date(assignment.dueAt).getTime() < Date.now();

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-small text-[var(--text-tertiary)]">
            {assignment.subjectName} · {assignment.sectionName}
          </p>
          <h1 className="text-h1">{assignment.title}</h1>
          <p className="text-small text-[var(--text-tertiary)]">
            {t('due', { date: formatDate(new Date(assignment.dueAt), locale) })} ·{' '}
            {t('outOf', { total: assignment.totalMarks })}
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>{t('brief')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="whitespace-pre-wrap text-body text-[var(--text-primary)]">{assignment.brief}</p>
            {assignment.attachments.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {assignment.attachments.map((attachment) => (
                  <li key={attachment.key}>
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-small text-[var(--accent)] underline"
                    >
                      {attachment.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>

        {isStaff ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('yourWork')}</CardTitle>
            </CardHeader>
            <CardContent>
              <GradingList rows={submissions} totalMarks={assignment.totalMarks} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{t('yourWork')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {assignment.mySubmission?.feedback ? (
                <div className="flex flex-col gap-1 rounded-card border border-[var(--border-subtle)] p-3">
                  <span className="text-small text-[var(--text-tertiary)]">{t('feedback')}</span>
                  <span className="text-body text-[var(--text-primary)]">
                    {assignment.mySubmission.feedback}
                  </span>
                </div>
              ) : null}
              <SubmitForm
                assignmentId={assignment.id}
                allowLate={assignment.allowLate}
                isOverdue={isOverdue}
                existing={assignment.mySubmission}
              />
            </CardContent>
          </Card>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
