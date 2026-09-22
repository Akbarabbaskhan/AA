'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/states';
import type { ManualMarkingItem } from '@/lib/services/quizzes/analysis';

/**
 * The short-answer marking queue.
 *
 * Grouped by question, because marking thirty answers to the same question in a row is how
 * marking stays consistent. The accepted answers sit at the top of each group so the
 * teacher is not re-deciding the standard on every row.
 */
export function MarkingQueue({ quizId, items }: { quizId: string; items: ManualMarkingItem[] }) {
  const t = useTranslations('quizzes');
  const router = useRouter();
  const [marks, setMarks] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyState title={t('markingQueueEmpty')} body={t('markingQueueEmptyBody')} />;
  }

  const groups = new Map<string, ManualMarkingItem[]>();
  for (const item of items) {
    groups.set(item.questionId, [...(groups.get(item.questionId) ?? []), item]);
  }

  async function award(item: ManualMarkingItem, value: string): Promise<void> {
    setSaving(item.answerId);
    setError(null);
    try {
      const response = await fetch(`/api/quizzes/${quizId}/marking`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answerId: item.answerId, marksAwarded: Number(value) }),
      });
      if (!response.ok) {
        const json: unknown = await response.json();
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save';
        throw new Error(message);
      }
      setDone((previous) => new Set(previous).add(item.answerId));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="marking-queue">
      {[...groups.entries()].map(([questionId, group]) => {
        const first = group[0];
        if (!first) return null;
        return (
          <section key={questionId} className="flex flex-col gap-2">
            <h3 className="text-h3">{first.questionBody}</h3>
            {first.acceptedAnswers.length > 0 ? (
              <p className="text-small text-[var(--text-tertiary)]">
                {t('correctAnswer')}: {first.acceptedAnswers.join(' · ')}
              </p>
            ) : null}

            <ul className="flex flex-col gap-2">
              {group.map((item) => (
                <li
                  key={item.answerId}
                  className="flex flex-wrap items-center gap-2 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
                  data-testid="marking-row"
                >
                  <span className="w-40 shrink-0 text-small text-[var(--text-tertiary)]">
                    {item.studentName}
                  </span>
                  <span className="flex-1 text-body text-[var(--text-primary)]">
                    {item.givenAnswer || '—'}
                  </span>
                  {done.has(item.answerId) ? (
                    <span className="text-small text-[var(--success)]">{t('saved')}</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <label className="flex items-center gap-1">
                        <span className="sr-only">{t('awardMarks')}</span>
                        <Input
                          type="number"
                          min={0}
                          max={item.marks}
                          className="w-20"
                          value={marks.get(item.answerId) ?? ''}
                          onChange={(event) =>
                            setMarks((previous) =>
                              new Map(previous).set(item.answerId, event.target.value),
                            )
                          }
                        />
                      </label>
                      <span className="text-small text-[var(--text-tertiary)]">/ {item.marks}</span>
                      <Button
                        size="md"
                        disabled={saving === item.answerId || !marks.get(item.answerId)}
                        onClick={() => void award(item, marks.get(item.answerId) ?? '0')}
                      >
                        {t('awardMarks')}
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
