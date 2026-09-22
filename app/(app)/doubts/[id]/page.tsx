import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { ReplyForm } from '@/components/features/doubts/reply-form';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { ApiError } from '@/lib/api/errors';
import { getDoubt } from '@/lib/services/doubts';

export const dynamic = 'force-dynamic';

export default async function DoubtPage({ params }: { params: { id: string } }) {
  const actor = await requireSessionActor();
  const t = await getTranslations('doubts');

  try {
    const thread = await withActor(actor, () => getDoubt(actor, params.id));

    return (
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="text-small text-[var(--text-tertiary)]">
            {thread.subjectName}
            {thread.resourceTitle ? ` · ${thread.resourceTitle}` : ''}
          </p>
          <h1 className="text-h1">{thread.title}</h1>
          <p className="text-small text-[var(--text-tertiary)]">
            {thread.askedBy}
            {thread.answeredBy ? ` · ${t('answeredBy', { name: thread.answeredBy })}` : ''}
            {thread.isResolved ? ` · ${t('resolved')}` : ''}
          </p>
        </header>

        <Card>
          <CardContent className="pt-4">
            <p className="whitespace-pre-wrap text-body text-[var(--text-primary)]">{thread.body}</p>
          </CardContent>
        </Card>

        {thread.replies.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {thread.replies.map((reply) => (
              <li
                key={reply.id}
                className="flex flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
              >
                <span className="text-small text-[var(--text-tertiary)]">
                  {reply.author}
                  {reply.isStaff ? ` · ${t('teacher')}` : ''}
                </span>
                <span className="whitespace-pre-wrap text-body text-[var(--text-primary)]">{reply.body}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <ReplyForm threadId={thread.id} />
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
}
