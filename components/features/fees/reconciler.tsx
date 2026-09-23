'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { formatPaisa } from '@/lib/services/fees/money';
import type { ReconciliationRow } from '@/lib/services/fees/reconciliation';

/**
 * Bank statement reconciliation.
 *
 * The screen is built around the distinction the matcher makes: confident rows are ticked
 * for you, ambiguous ones show their candidates and wait for a click, and unmatched ones
 * say so plainly rather than guessing.
 *
 * Nothing posts until the bursar presses the button, and the button says how many
 * payments it is about to record. Silently auto-posting a wrong match is a family told
 * they have not paid when they have, and that is the one failure this screen exists to
 * prevent.
 */
type Chosen = Map<number, string>;

export function Reconciler() {
  const t = useTranslations('reconcile');
  const router = useRouter();

  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState<ReconciliationRow[] | null>(null);
  const [summary, setSummary] = useState<{ confident: number; ambiguous: number; unmatched: number } | null>(null);
  const [chosen, setChosen] = useState<Chosen>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ posted: number; failed: number } | null>(null);

  async function analyse(): Promise<void> {
    setBusy(true);
    setError(null);
    setPosted(null);
    try {
      const response = await fetch('/api/fees/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv }),
      });
      const json = (await response.json()) as {
        rows?: ReconciliationRow[];
        errors?: string[];
        summary?: { confident: number; ambiguous: number; unmatched: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(json.error?.message ?? 'Could not read that file');
      if (json.errors?.length) throw new Error(json.errors.join(' '));

      setRows(json.rows ?? []);
      setSummary(json.summary ?? null);
      // Confident rows start ticked: that is the point of calling them confident.
      const preset: Chosen = new Map();
      (json.rows ?? []).forEach((row, index) => {
        if (row.verdict === 'CONFIDENT' && row.candidates[0]) {
          preset.set(index, row.candidates[0].invoiceId);
        }
      });
      setChosen(preset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const matches = [...chosen.entries()].flatMap(([index, invoiceId]) => {
        const row = rows[index];
        if (!row) return [];
        return [
          {
            invoiceId,
            amountPaisa: row.line.amountPaisa,
            reference: row.line.reference || `STMT-${row.line.rowNumber}`,
            ...(row.line.date ? { paidAt: row.line.date } : {}),
          },
        ];
      });

      const response = await fetch('/api/fees/reconcile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matches }),
      });
      const json = (await response.json()) as {
        posted?: number;
        failed?: { reason: string }[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(json.error?.message ?? 'Could not post');

      setPosted({ posted: json.posted ?? 0, failed: json.failed?.length ?? 0 });
      setRows(null);
      setChosen(new Map());
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not post');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="reconciler">
      <label className="flex flex-col gap-1">
        <span className="text-small text-[var(--text-tertiary)]">{t('upload')}</span>
        <textarea
          className="min-h-[8rem] rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 py-2 font-mono text-small text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
          data-testid="statement-csv"
        />
      </label>

      <Button onClick={analyse} disabled={busy || csv.trim() === ''} data-testid="analyse-statement">
        {busy && !rows ? t('analysing') : t('analyse')}
      </Button>

      {posted ? (
        <p className="text-body text-[var(--success)]" data-testid="reconcile-posted">
          {t('posted', { posted: posted.posted, failed: posted.failed })}
        </p>
      ) : null}

      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="reconcile-error">
          {error}
        </p>
      ) : null}

      {summary && rows ? (
        <>
          <p className="flex flex-wrap gap-3 text-small" data-testid="reconcile-summary">
            <span className="text-[var(--success)]">{t('confident', { count: summary.confident })}</span>
            <span className="text-[var(--warning)]">{t('ambiguous', { count: summary.ambiguous })}</span>
            <span className="text-[var(--text-tertiary)]">{t('unmatched', { count: summary.unmatched })}</span>
          </p>

          <ul className="flex flex-col gap-2">
            {rows.map((row, index) => (
              <li
                key={`${row.line.rowNumber}-${row.line.narration}`}
                className="flex flex-col gap-2 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
                data-testid="reconcile-row"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body text-[var(--text-primary)]">{row.line.narration || '—'}</span>
                  <span data-numeric className="tabular-nums text-body">
                    {formatPaisa(row.line.amountPaisa)}
                  </span>
                </span>

                {row.candidates.length === 0 ? (
                  <span className="text-small text-[var(--text-tertiary)]">{t('noCandidates')}</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {row.candidates.map((candidate) => {
                      const isChosen = chosen.get(index) === candidate.invoiceId;
                      return (
                        <li key={candidate.invoiceId}>
                          <label className="flex min-h-tap cursor-pointer items-center gap-3 rounded-button border border-[var(--border-subtle)] p-2 has-[:checked]:border-[var(--accent)]">
                            <input
                              type="radio"
                              className="h-4 w-4 accent-[var(--accent)]"
                              name={`row-${index}`}
                              checked={isChosen}
                              onChange={() =>
                                setChosen((previous) =>
                                  new Map(previous).set(index, candidate.invoiceId),
                                )
                              }
                            />
                            <span className="flex flex-1 flex-wrap items-baseline justify-between gap-2">
                              <span className="font-mono text-small">{candidate.voucherNumber}</span>
                              <span className="text-small text-[var(--text-secondary)]">
                                {candidate.rollNumber} · {candidate.studentName}
                              </span>
                              <span data-numeric className="tabular-nums text-small">
                                {formatPaisa(candidate.outstanding)}
                              </span>
                            </span>
                            <span className="text-small text-[var(--text-tertiary)]">
                              {candidate.reasons.join(', ')}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                    {chosen.has(index) ? (
                      <li>
                        <button
                          type="button"
                          className="min-h-tap text-small text-[var(--text-tertiary)] underline"
                          onClick={() =>
                            setChosen((previous) => {
                              const next = new Map(previous);
                              next.delete(index);
                              return next;
                            })
                          }
                        >
                          {t('skip')}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                )}
              </li>
            ))}
          </ul>

          <div className="sticky bottom-[calc(var(--bottom-nav-height)+0.5rem)] desktop:static">
            <Button
              full
              onClick={confirm}
              disabled={busy || chosen.size === 0}
              data-testid="confirm-matches"
            >
              {busy ? t('posting') : t('confirm', { count: chosen.size })}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
