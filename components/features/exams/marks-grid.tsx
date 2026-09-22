'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { parsePastedColumn } from '@/lib/services/exams/paste';
// Type-only: erased at compile time, so it does not pull the service into the bundle.
import type { MarksGrid } from '@/lib/services/exams/marks';
import { cn } from '@/lib/utils/cn';

/**
 * The marks entry grid.
 *
 * "Students down, one assessment across, keyboard navigation with Enter and arrow keys, no
 * mouse needed." Desktop-first by design — this is spreadsheet-shaped work done sitting
 * down, and the spec puts it on that side of the line deliberately.
 *
 * The keyboard contract:
 *   Enter / Down   next student
 *   Up             previous student
 *   A              mark absent and move on
 *   Paste          fills from this row down, in roll-number order
 */

type Draft = { value: string; isAbsent: boolean; dirty: boolean };

function toDraft(row: MarksGrid['rows'][number]): Draft {
  return {
    value: row.isAbsent ? '' : row.marksObtained === null ? '' : String(row.marksObtained),
    isAbsent: row.isAbsent,
    dirty: false,
  };
}

export function MarksGridClient({ initial }: { initial: MarksGrid }) {
  const t = useTranslations('exams');

  const [grid, setGrid] = useState(initial);
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.rows.map(toDraft));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingSave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalMarks = grid.assessment.totalMarks;

  const focusRow = useCallback((index: number) => {
    const target = inputs.current[index];
    if (target) {
      target.focus();
      target.select();
    }
  }, []);

  const save = useCallback(
    async (entries: { studentId: string; marksObtained: number | null; isAbsent: boolean }[]) => {
      if (entries.length === 0) return;
      setStatus('saving');
      try {
        const response = await fetch(`/api/assessments/${grid.assessment.id}/marks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entries }),
        });
        if (!response.ok) throw new Error(String(response.status));

        const result = (await response.json()) as {
          statistics: MarksGrid['statistics'];
          outliers: { studentId: string }[];
        };

        // Fold the server's recomputed statistics back in, so the outlier flags and the
        // class mean update as the teacher types rather than after a reload.
        const outlierIds = new Set(result.outliers.map((entry) => entry.studentId));
        setGrid((current) => ({
          ...current,
          statistics: result.statistics,
          rows: current.rows.map((row) => ({ ...row, isOutlier: outlierIds.has(row.studentId) })),
        }));
        setStatus('saved');
      } catch {
        // The marks stay on screen; nothing the teacher typed is lost.
        setStatus('failed');
      }
    },
    [grid.assessment.id],
  );

  /** Autosave: every entry, debounced just enough to batch a fast typist's run. */
  const scheduleSave = useCallback(() => {
    if (pendingSave.current) clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => {
      setDrafts((current) => {
        const entries = current
          .map((draft, index) => ({ draft, row: grid.rows[index]! }))
          .filter(({ draft }) => draft.dirty)
          .map(({ draft, row }) => ({
            studentId: row.studentId,
            marksObtained: draft.isAbsent ? null : draft.value === '' ? null : Number(draft.value),
            isAbsent: draft.isAbsent,
          }))
          .filter((entry) => entry.isAbsent || entry.marksObtained !== null);

        void save(entries);
        return current.map((draft) => ({ ...draft, dirty: false }));
      });
    }, 600);
  }, [grid.rows, save]);

  useEffect(() => () => {
    if (pendingSave.current) clearTimeout(pendingSave.current);
  }, []);

  function update(index: number, next: Partial<Draft>) {
    setDrafts((current) =>
      current.map((draft, position) =>
        position === index ? { ...draft, ...next, dirty: true } : draft,
      ),
    );
    scheduleSave();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(Math.min(index + 1, grid.rows.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(Math.max(index - 1, 0));
      return;
    }
    // "A" for absent is what a teacher already types on a paper register.
    if (event.key.toLowerCase() === 'a' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      update(index, { value: '', isAbsent: true });
      focusRow(Math.min(index + 1, grid.rows.length - 1));
    }
  }

  function onPaste(event: React.ClipboardEvent<HTMLInputElement>, index: number) {
    const text = event.clipboardData.getData('text');
    if (!text.includes('\n') && !text.includes('\t')) return;

    event.preventDefault();
    const values = parsePastedColumn(text);

    // Fills downward from the focused row, in roll-number order — which is the order the
    // column was almost certainly copied in.
    setDrafts((current) =>
      current.map((draft, position) => {
        const value = values[position - index];
        if (position < index || !value) return draft;
        return {
          value: value.isAbsent || value.marksObtained === null ? '' : String(value.marksObtained),
          isAbsent: value.isAbsent,
          dirty: true,
        };
      }),
    );
    scheduleSave();
  }

  const invalid = useMemo(
    () =>
      drafts.map(
        (draft) => !draft.isAbsent && draft.value !== '' && Number(draft.value) > totalMarks,
      ),
    [drafts, totalMarks],
  );

  const outlierCount = grid.rows.filter((row) => row.isOutlier).length;
  const statistics = grid.statistics;

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <p className="text-small text-[var(--text-tertiary)]">
          {grid.assessment.examSeriesName} · {grid.assessment.sectionName}
        </p>
        <h1 className="text-h1">
          {grid.assessment.subjectName} {grid.assessment.componentCode ?? ''}
        </h1>
        <p className="text-body text-[var(--text-secondary)]">
          {grid.assessment.title} · {t('outOf', { total: totalMarks })} ·{' '}
          {grid.assessment.weightPercent}%
        </p>
      </header>

      {grid.assessment.isPublished ? (
        <p role="alert" className="text-body text-[var(--danger)]">
          {t('lockedPublished')}
        </p>
      ) : null}

      <section className="grid gap-2 tablet:grid-cols-4">
        {[
          { label: t('classMean'), value: statistics.mean === null ? '—' : statistics.mean.toFixed(1) },
          { label: t('classMedian'), value: statistics.median === null ? '—' : String(statistics.median) },
          {
            label: t('spread'),
            value:
              statistics.standardDeviation === null ? '—' : `±${statistics.standardDeviation.toFixed(1)}`,
          },
          { label: t('sat'), value: `${statistics.sat} · ${statistics.absent} ${t('absentCount')}` },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <p className="text-small text-[var(--text-secondary)]">{stat.label}</p>
              <p data-numeric className="text-h2">
                {stat.value}
              </p>
            </CardHeader>
          </Card>
        ))}
      </section>

      {outlierCount > 0 ? (
        <p role="status" className="text-body text-[var(--warning)]">
          {t('outlierWarning', { count: outlierCount })}
        </p>
      ) : null}

      <p className="text-small text-[var(--text-tertiary)]">{t('saveHint')}</p>

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-body">
            <caption className="sr-only">{t('marksFor', { title: grid.assessment.title })}</caption>
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-small text-[var(--text-secondary)]">
                <th scope="col" className="p-2 text-start font-medium">
                  #
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {grid.assessment.subjectName}
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {t('outOf', { total: totalMarks })}
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  %
                </th>
                <th scope="col" className="p-2 text-start font-medium">
                  {t('subjectGrade')}
                </th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, index) => {
                const draft = drafts[index]!;
                const value = draft.isAbsent ? '' : draft.value;
                const percent =
                  !draft.isAbsent && value !== '' && totalMarks > 0
                    ? (Number(value) / totalMarks) * 100
                    : null;
                const grade =
                  percent === null
                    ? null
                    : (grid.gradingScale.bands.find((band) => percent >= band.minPercent)?.grade ??
                      null);

                return (
                  <tr
                    key={row.studentId}
                    className={cn(
                      'border-b border-[var(--border-subtle)] last:border-0',
                      row.isOutlier ? 'bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]' : '',
                    )}
                  >
                    <td data-numeric className="p-2 font-mono text-small text-[var(--text-tertiary)]">
                      {row.rollNumber}
                    </td>
                    <td className="p-2">
                      {row.name}
                      {row.originalMarks !== null ? (
                        <span className="ms-1 text-small text-[var(--text-tertiary)]">
                          {t('moderated', { original: row.originalMarks })}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2">
                      <input
                        ref={(element) => {
                          inputs.current[index] = element;
                        }}
                        type="text"
                        inputMode="numeric"
                        disabled={!grid.canEnter}
                        aria-label={`${row.name}, marks out of ${totalMarks}`}
                        aria-invalid={invalid[index] ? true : undefined}
                        value={draft.isAbsent ? 'A' : draft.value}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (/^a$/i.test(next)) update(index, { value: '', isAbsent: true });
                          else if (/^\d{0,4}$/.test(next))
                            update(index, { value: next, isAbsent: false });
                        }}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        onPaste={(event) => onPaste(event, index)}
                        className={cn(
                          'min-h-tap w-20 rounded-input border bg-[var(--surface-raised)] px-2 text-center font-mono',
                          'focus:border-[var(--accent)] focus:outline-none disabled:opacity-60',
                          invalid[index]
                            ? 'border-[var(--danger)]'
                            : 'border-[var(--border-subtle)]',
                        )}
                      />
                      {invalid[index] ? (
                        <span className="ms-1 text-small text-[var(--danger)]">{t('aboveTotal')}</span>
                      ) : null}
                    </td>
                    <td data-numeric className="p-2 text-[var(--text-secondary)]">
                      {draft.isAbsent ? t('notSat') : percent === null ? '—' : `${percent.toFixed(1)}%`}
                    </td>
                    <td className="p-2 font-medium">{grade ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p aria-live="polite" className="text-small text-[var(--text-secondary)]">
        {status === 'saving'
          ? t('saving')
          : status === 'saved'
            ? t('saved')
            : status === 'failed'
              ? t('saveFailed')
              : ''}
      </p>

      {status === 'failed' ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setDrafts((current) => current.map((draft) => ({ ...draft, dirty: true })));
            scheduleSave();
          }}
        >
          {t('saving')}
        </Button>
      ) : null}
    </div>
  );
}
