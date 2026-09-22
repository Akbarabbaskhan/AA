'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SubmissionRow } from '@/lib/services/assignments';

/**
 * The grading list.
 *
 * Everyone enrolled is here, including the students who handed in nothing — the list a
 * teacher needs is "who is missing", and a list of submissions alone cannot answer it.
 * Rows that have work come first because that is what the teacher is here to mark.
 */
export function GradingList({
  rows,
  totalMarks,
}: {
  rows: SubmissionRow[];
  totalMarks: number;
}) {
  const t = useTranslations('assignments');
  const router = useRouter();
  const [marks, setMarks] = useState<Map<string, string>>(
    () => new Map(rows.flatMap((row) => (row.submissionId ? [[row.submissionId, row.marks === null ? '' : String(row.marks)]] : []))),
  );
  const [feedback, setFeedback] = useState<Map<string, string>>(
    () => new Map(rows.flatMap((row) => (row.submissionId ? [[row.submissionId, row.feedback ?? '']] : []))),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ordered = [...rows].sort((a, b) => {
    if (Boolean(a.submittedAt) !== Boolean(b.submittedAt)) return a.submittedAt ? -1 : 1;
    if ((a.marks === null) !== (b.marks === null)) return a.marks === null ? -1 : 1;
    return a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true });
  });

  async function save(submissionId: string): Promise<void> {
    setSaving(submissionId);
    setError(null);
    try {
      const response = await fetch('/api/submissions/grade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          marks: Number(marks.get(submissionId) ?? 0),
          feedback: feedback.get(submissionId)?.trim() || null,
        }),
      });
      if (!response.ok) {
        const json: unknown = await response.json();
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save';
        throw new Error(message);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-2" data-testid="grading-list">
      {ordered.map((row) => (
        <div
          key={row.studentId}
          className="flex flex-col gap-2 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
          data-testid="grading-row"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-body text-[var(--text-primary)]">
              {row.rollNumber} · {row.studentName}
            </span>
            <span
              className={
                row.submittedAt
                  ? row.isLate
                    ? 'text-small text-[var(--warning)]'
                    : 'text-small text-[var(--success)]'
                  : 'text-small text-[var(--danger)]'
              }
            >
              {row.submittedAt ? (row.isLate ? t('submittedLate') : t('submitted')) : t('notSubmitted')}
            </span>
          </div>

          {row.textBody ? (
            <p className="whitespace-pre-wrap text-small text-[var(--text-secondary)]">{row.textBody}</p>
          ) : null}

          {row.files.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {row.files.map((file) => (
                <li key={file.key}>
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-small text-[var(--accent)] underline"
                  >
                    {file.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          {row.submissionId ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-small text-[var(--text-tertiary)]">{t('grade')}</span>
                <Input
                  type="number"
                  min={0}
                  max={totalMarks}
                  className="w-24"
                  value={marks.get(row.submissionId) ?? ''}
                  onChange={(event) =>
                    setMarks((previous) => new Map(previous).set(row.submissionId!, event.target.value))
                  }
                />
              </label>
              <span className="pb-3 text-small text-[var(--text-tertiary)]">
                {t('outOf', { total: totalMarks })}
              </span>
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
                <span className="text-small text-[var(--text-tertiary)]">{t('feedback')}</span>
                <Input
                  value={feedback.get(row.submissionId) ?? ''}
                  onChange={(event) =>
                    setFeedback((previous) => new Map(previous).set(row.submissionId!, event.target.value))
                  }
                />
              </label>
              <Button
                disabled={saving === row.submissionId || (marks.get(row.submissionId) ?? '') === ''}
                onClick={() => void save(row.submissionId!)}
              >
                {t('saveGrade')}
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p className="text-small text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}
