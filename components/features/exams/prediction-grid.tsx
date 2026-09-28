'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

type Row = {
  studentId: string;
  studentName: string;
  rollNumber: string;
  currentPercent: number | null;
  suggestedGrade: string | null;
  teacherGrade: string | null;
};

/**
 * Predicting a section's grades.
 *
 * The arithmetic is on the row — the student's mean across published series and the grade it
 * maps to — and "use the suggestion" fills the column in one press. The teacher's own grade is
 * what gets stored: this is the number a university offer hangs on, and a system that quietly
 * predicted on a school's behalf would be putting words in a teacher's mouth.
 */
export function PredictionGrid({
  sectionId,
  rows,
  grades,
}: {
  sectionId: string;
  rows: Row[];
  grades: string[];
}) {
  const t = useTranslations('predictions');
  const router = useRouter();

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((row) => [row.studentId, row.teacherGrade ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function useSuggestions(): void {
    setValues((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (!next[row.studentId] && row.suggestedGrade) next[row.studentId] = row.suggestedGrade;
      }
      return next;
    });
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const entries = rows
        .filter((row) => (values[row.studentId] ?? '') !== '')
        .map((row) => ({
          studentId: row.studentId,
          grade: values[row.studentId]!,
          confidence: null,
        }));

      const response = await fetch('/api/predictions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sectionId, entries }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save';
        throw new Error(message);
      }
      setSaved((json as { saved: number }).saved);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="prediction-grid">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={useSuggestions} data-testid="use-suggestions">
          {t('useSuggestions')}
        </Button>
        <Button onClick={save} disabled={busy} data-testid="save-predictions">
          {busy ? t('saving') : t('save')}
        </Button>
        {saved !== null ? (
          <span className="text-small text-[var(--success)]" data-testid="predictions-saved">
            {t('saved', { count: saved })}
          </span>
        ) : null}
        {error ? (
          <span className="text-small text-[var(--danger)]" data-testid="predictions-error">
            {error}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-body">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-small text-[var(--text-secondary)]">
              <th scope="col" className="p-2 text-start font-medium">
                {t('student')}
              </th>
              <th scope="col" className="p-2 text-end font-medium">
                {t('mean')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('suggested')}
              </th>
              <th scope="col" className="p-2 text-start font-medium">
                {t('predicted')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.studentId}
                className="border-b border-[var(--border-subtle)] last:border-0"
              >
                <td className="p-2">
                  {row.studentName}{' '}
                  <span data-numeric className="font-mono text-small text-[var(--text-tertiary)]">
                    {row.rollNumber}
                  </span>
                </td>
                <td data-numeric className="p-2 text-end tabular-nums">
                  {row.currentPercent === null ? '—' : `${row.currentPercent}%`}
                </td>
                <td className="p-2 text-[var(--text-secondary)]">{row.suggestedGrade ?? '—'}</td>
                <td className="p-2">
                  <select
                    className="min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body"
                    value={values[row.studentId] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [row.studentId]: event.target.value }))
                    }
                    aria-label={t('predictedFor', { name: row.studentName })}
                    data-testid={`prediction-${row.rollNumber}`}
                  >
                    <option value="">—</option>
                    {grades.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
