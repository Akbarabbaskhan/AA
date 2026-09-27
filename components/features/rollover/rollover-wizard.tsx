'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Plan = {
  fromYear: { label: string };
  newYear: { label: string; startDate: string; endDate: string };
  promotions: { fromYearGroup: string; toYearGroup: string | null; students: number; subjectGaps: number }[];
  graduating: number;
  repeating: number;
  withdrawing: number;
  sectionsToCreate: number;
  enrolmentsToCreate: number;
  timetableSlotsToCopy: number;
  feeStructuresToCopy: number;
  warnings: string[];
};

type Run = {
  id: string;
  status: 'PREVIEW' | 'COMMITTED' | 'REVERTED';
  plan: Plan;
  revertibleUntil: string | null;
};

/**
 * The rollover wizard: describe, preview, commit.
 *
 * The preview is not a formality. It is the only moment anybody can see that 37 students take
 * a subject A2 does not offer, or that the timetable is about to be copied when the school
 * meant to rebuild it — and it costs nothing, because a preview writes only its own plan.
 */
export function RolloverWizard({ suggested }: { suggested: { label: string; startDate: string; endDate: string } }) {
  const t = useTranslations('rollover');
  const router = useRouter();

  const [label, setLabel] = useState(suggested.label);
  const [startDate, setStartDate] = useState(suggested.startDate);
  const [endDate, setEndDate] = useState(suggested.endDate);
  const [copyTimetable, setCopyTimetable] = useState(true);
  const [copyFeeStructures, setCopyFeeStructures] = useState(true);
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState('');

  async function call(url: string, body: unknown): Promise<Run> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof json === 'object' && json !== null && 'error' in json
          ? String((json as { error: { message?: string } }).error.message ?? 'Could not do that')
          : 'Could not do that';
      throw new Error(message);
    }
    return json as Run;
  }

  async function preview(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setRun(
        await call('/api/rollover', {
          label,
          startDate,
          endDate,
          copyTimetable,
          copyFeeStructures,
          exceptions: [],
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not preview');
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      setRun(await call(`/api/rollover/${run.id}`, { action: 'commit' }));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not commit');
    } finally {
      setBusy(false);
    }
  }

  const plan = run?.plan;

  return (
    <div className="flex flex-col gap-4" data-testid="rollover-wizard">
      <section className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3">
        <h2 className="text-h3">{t('step1')}</h2>

        <div className="grid gap-3 tablet:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-small text-[var(--text-secondary)]">{t('label')}</span>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} data-testid="rollover-label" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small text-[var(--text-secondary)]">{t('startDate')}</span>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} data-testid="rollover-start" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-small text-[var(--text-secondary)]">{t('endDate')}</span>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} data-testid="rollover-end" />
          </label>
        </div>

        <label className="flex min-h-tap items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={copyTimetable}
            onChange={(event) => setCopyTimetable(event.target.checked)}
            data-testid="rollover-copy-timetable"
          />
          <span className="text-body">{t('copyTimetable')}</span>
        </label>

        <label className="flex min-h-tap items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={copyFeeStructures}
            onChange={(event) => setCopyFeeStructures(event.target.checked)}
            data-testid="rollover-copy-fees"
          />
          <span className="text-body">{t('copyFees')}</span>
        </label>

        <div>
          <Button onClick={preview} disabled={busy} data-testid="rollover-preview">
            {busy ? t('working') : t('previewAction')}
          </Button>
        </div>
      </section>

      {plan ? (
        <section
          className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
          data-testid="rollover-plan"
        >
          <h2 className="text-h3">{t('step2')}</h2>

          <ul className="flex flex-col gap-1" data-testid="rollover-promotions">
            {plan.promotions.map((row) => (
              <li key={row.fromYearGroup} className="flex flex-wrap items-baseline gap-2 text-body">
                <span className="font-medium">{row.fromYearGroup}</span>
                <span aria-hidden="true">→</span>
                <span className="font-medium">{row.toYearGroup ?? t('graduates')}</span>
                <span data-numeric className="text-small text-[var(--text-tertiary)]">
                  {t('studentCount', { count: row.students })}
                </span>
                {row.subjectGaps > 0 ? (
                  <span className="text-small text-[var(--warning)]">
                    {t('subjectGaps', { count: row.subjectGaps })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          <dl className="grid gap-2 tablet:grid-cols-3">
            {[
              [t('graduating'), plan.graduating],
              [t('repeating'), plan.repeating],
              [t('withdrawing'), plan.withdrawing],
              [t('sections'), plan.sectionsToCreate],
              [t('enrolments'), plan.enrolmentsToCreate],
              [t('slots'), plan.timetableSlotsToCopy],
              [t('feeStructures'), plan.feeStructuresToCopy],
            ].map(([term, value]) => (
              <div key={String(term)} className="flex items-baseline justify-between gap-2">
                <dt className="text-small text-[var(--text-tertiary)]">{term}</dt>
                <dd data-numeric className="text-body tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {plan.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1" data-testid="rollover-warnings">
              {plan.warnings.map((warning) => (
                <li key={warning} className="text-small text-[var(--warning)]">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          {run?.status === 'PREVIEW' ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-small text-[var(--text-secondary)]">
                  {t('typeToConfirm', { label: plan.newYear.label })}
                </span>
                <Input
                  value={confirmed}
                  onChange={(event) => setConfirmed(event.target.value)}
                  data-testid="rollover-confirm"
                />
              </label>
              <Button
                onClick={commit}
                disabled={busy || confirmed.trim() !== plan.newYear.label}
                data-testid="rollover-commit"
              >
                {busy ? t('working') : t('commitAction')}
              </Button>
              <p className="text-small text-[var(--text-tertiary)]">{t('revertNote')}</p>
            </div>
          ) : (
            <p className="text-body text-[var(--success)]" data-testid="rollover-done">
              {t('committed', { label: plan.newYear.label })}
            </p>
          )}
        </section>
      ) : null}

      {error ? (
        <p className="text-small text-[var(--danger)]" data-testid="rollover-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
