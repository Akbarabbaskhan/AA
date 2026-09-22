import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/states';
import { AskForm } from '@/components/features/doubts/ask-form';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { prisma } from '@/lib/db';
import { listDoubts } from '@/lib/services/doubts';

export const dynamic = 'force-dynamic';

/**
 * Doubt threads.
 *
 * A teacher lands on the unanswered ones, a student on everything in their subjects —
 * because a question already asked and answered is the whole point of making these public
 * to the cohort rather than a private message.
 */
export default async function DoubtsPage({
  searchParams,
}: {
  searchParams: { scope?: string };
}) {
  const actor = await requireSessionActor();
  const t = await getTranslations('doubts');

  const canAnswer = can(actor, 'doubt.answer');
  const scope =
    searchParams.scope === 'UNANSWERED' || searchParams.scope === 'MINE'
      ? searchParams.scope
      : canAnswer
        ? 'UNANSWERED'
        : 'ALL';

  const { threads, subjects } = await withActor(actor, async () => {
    const list = await listDoubts(actor, { scope, limit: 50 });
    const enrolled = actor.studentId
      ? await prisma.section.findMany({
          where: { id: { in: [...actor.enrolledSectionIds] } },
          select: { subjectId: true, subject: { select: { name: true } } },
        })
      : [];
    const unique = new Map(enrolled.map((row) => [row.subjectId, row.subject.name]));
    return {
      threads: list,
      subjects: [...unique.entries()].map(([id, name]) => ({ id, name })),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h1">{t('title')}</h1>
        {can(actor, 'doubt.ask') && subjects.length > 0 ? <AskForm subjects={subjects} /> : null}
      </header>

      <nav className="flex gap-2" aria-label={t('title')}>
        {(['ALL', 'UNANSWERED', 'MINE'] as const)
          .filter((option) => option !== 'MINE' || Boolean(actor.studentId))
          .map((option) => (
            <Link
              key={option}
              href={`/doubts?scope=${option}`}
              aria-current={scope === option ? 'page' : undefined}
              className={[
                'min-h-tap rounded-pill border px-3 py-2 text-small',
                scope === option
                  ? 'border-[var(--accent)] text-[var(--text-primary)]'
                  : 'border-[var(--border-subtle)] text-[var(--text-tertiary)]',
              ].join(' ')}
            >
              {option === 'ALL' ? t('allThreads') : option === 'UNANSWERED' ? t('unanswered') : t('mine')}
            </Link>
          ))}
      </nav>

      {threads.length === 0 ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/doubts/${thread.id}`}
                className="flex min-h-tap flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                data-testid="doubt-row"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body font-medium text-[var(--text-primary)]">{thread.title}</span>
                  {thread.isResolved ? (
                    <span className="text-small text-[var(--success)]">{t('resolved')}</span>
                  ) : null}
                </span>
                <span className="text-small text-[var(--text-tertiary)]">
                  {thread.subjectName} · {thread.askedBy} · {t('replies', { count: thread.replyCount })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
