'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import type { ImportPreview, ImportResult } from '@/lib/services/import/students';

/**
 * The bulk import wizard.
 *
 * "Build it properly: upload an Excel or CSV, map columns to fields in a UI, preview the
 * first 20 rows with validation errors flagged inline, then commit with a downloadable
 * error report for failed rows."
 *
 * Desktop-first, and deliberately so — nobody maps spreadsheet columns on a phone.
 */

const FIELD_LABELS: Record<string, { label: string; required: boolean }> = {
  admissionNumber: { label: 'Admission number', required: true },
  name: { label: 'Student name', required: true },
  yearGroup: { label: 'Year group', required: true },
  rollNumber: { label: 'Roll number', required: false },
  gender: { label: 'Gender', required: false },
  dateOfBirth: { label: 'Date of birth', required: false },
  house: { label: 'House', required: false },
  phone: { label: 'Student phone', required: false },
  email: { label: 'Student email', required: false },
  guardianName: { label: 'Guardian name', required: false },
  guardianPhone: { label: 'Guardian phone', required: false },
  guardianRelation: { label: 'Guardian relation', required: false },
  guardianCnic: { label: 'Guardian CNIC', required: false },
  subjects: { label: 'Subjects', required: false },
};

type Step = 'choose' | 'map' | 'done';

export function ImportWizard() {
  const t = useTranslations('students');

  const [step, setStep] = useState<Step>('choose');
  const [fileName, setFileName] = useState('');
  const [fileText, setFileText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useCallback(
    async (text: string, overrides?: Record<string, number>) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch('/api/students/import/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ file: text, ...(overrides ? { mapping: overrides } : {}) }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Server responded ${response.status}`);
        }
        const data = (await response.json()) as ImportPreview;
        setPreview(data);
        setMapping(data.mapping as Record<string, number>);
        setStep('map');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not read that file');
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  async function onFile(file: File) {
    const text = await file.text();
    setFileName(file.name);
    setFileText(text);
    await runPreview(text);
  }

  function changeMapping(field: string, value: string) {
    const next = { ...mapping };
    if (value === '') delete next[field];
    else next[field] = Number(value);
    setMapping(next);
    // Re-validate immediately: the row-level errors depend entirely on the mapping.
    void runPreview(fileText, next);
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/students/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: fileText, mapping, fileName }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Server responded ${response.status}`);
      }
      setResult((await response.json()) as ImportResult);
      setStep('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import did not finish');
    } finally {
      setBusy(false);
    }
  }

  const errorReportHref = useMemo(() => {
    if (!result || result.errorReport.length === 0) return null;
    const rows = [
      ['Row', 'Admission number', 'Why it was rejected'],
      ...result.errorReport.map((entry) => [
        String(entry.rowNumber),
        entry.admissionNumber,
        entry.reasons.join('; '),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }, [result]);

  const canImport =
    preview !== null && preview.missingRequired.length === 0 && preview.counts.reject < preview.totalRows;

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex gap-2 text-small text-[var(--text-secondary)]">
        {(['choose', 'map', 'done'] as const).map((name, index) => (
          <li
            key={name}
            aria-current={step === name ? 'step' : undefined}
            className={cn(
              'flex items-center gap-1',
              step === name ? 'font-medium text-[var(--text-primary)]' : '',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-pill text-small',
                step === name
                  ? 'bg-[var(--accent)] text-[var(--accent-on)]'
                  : 'bg-[var(--surface)] text-[var(--text-tertiary)]',
              )}
            >
              {index + 1}
            </span>
            {t(name === 'choose' ? 'importStep1' : name === 'map' ? 'importStep2' : 'importStep3')}
          </li>
        ))}
      </ol>

      {error ? (
        <p role="alert" className="text-body text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {step === 'choose' ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-2 p-3">
            <p className="text-body text-[var(--text-secondary)]">{t('importDrop')}</p>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label={t('importStep1')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
              className="min-h-tap text-body"
            />
          </CardContent>
        </Card>
      ) : null}

      {step === 'map' && preview ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('importStep2')}</CardTitle>
              <p className="text-small text-[var(--text-secondary)]">{t('importMapHint')}</p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 tablet:grid-cols-2">
                {Object.entries(FIELD_LABELS).map(([field, meta]) => (
                  <label key={field} className="flex flex-col gap-1">
                    <span className="text-small text-[var(--text-secondary)]">
                      {meta.label}
                      {meta.required ? (
                        <span className="text-[var(--danger)]"> · {t('importRequired')}</span>
                      ) : null}
                    </span>
                    <select
                      value={mapping[field] ?? ''}
                      onChange={(event) => changeMapping(field, event.target.value)}
                      className={cn(
                        'min-h-tap rounded-input border bg-[var(--surface-raised)] px-2 text-body',
                        meta.required && mapping[field] === undefined
                          ? 'border-[var(--danger)]'
                          : 'border-[var(--border-subtle)]',
                      )}
                    >
                      <option value="">{t('importNotMapped')}</option>
                      {preview.headers.map((header, index) => (
                        <option key={`${header}-${index}`} value={index}>
                          {header || `Column ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('importPreview', { count: preview.sample.length })}</CardTitle>
              <p className="text-small text-[var(--text-secondary)]">
                {t('importWillCreate', { count: preview.counts.create })} ·{' '}
                {t('importWillUpdate', { count: preview.counts.update })} ·{' '}
                <span className={preview.counts.reject > 0 ? 'text-[var(--danger)]' : ''}>
                  {t('importWillReject', { count: preview.counts.reject })}
                </span>
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-small">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-start text-[var(--text-secondary)]">
                    <th scope="col" className="p-2 text-start font-medium">
                      {t('importRowNumber')}
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      {FIELD_LABELS.admissionNumber?.label}
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      {FIELD_LABELS.name?.label}
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      {FIELD_LABELS.yearGroup?.label}
                    </th>
                    <th scope="col" className="p-2 text-start font-medium">
                      &nbsp;
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((row) => (
                    <tr
                      key={row.rowNumber}
                      className={cn(
                        'border-b border-[var(--border-subtle)] last:border-0',
                        row.action === 'reject' ? 'bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]' : '',
                      )}
                    >
                      <td data-numeric className="p-2 font-mono">
                        {row.rowNumber}
                      </td>
                      <td className="p-2 font-mono">{row.values.admissionNumber ?? '—'}</td>
                      <td className="p-2">{row.values.name ?? '—'}</td>
                      <td className="p-2">{row.values.yearGroup ?? '—'}</td>
                      <td className="p-2">
                        {/* Errors are flagged inline, on the row, where the admin is looking. */}
                        {row.issues.length > 0 ? (
                          <ul className="flex flex-col gap-1 text-[var(--danger)]">
                            {row.issues.map((issue) => (
                              <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">
                            {row.action === 'update' ? t('importWillUpdate', { count: 1 }) : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <div className="flex gap-1">
            <Button type="button" onClick={() => void commit()} disabled={busy || !canImport}>
              {busy
                ? t('importRunning')
                : t('importRun', { count: preview.counts.create + preview.counts.update })}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setStep('choose')}>
              {t('importStep1')}
            </Button>
          </div>
        </>
      ) : null}

      {step === 'done' && result ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('importStep3')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2">
            <p className="text-body">
              {t('importDone', { created: result.created, updated: result.updated })}
            </p>
            {result.rejected > 0 ? (
              <>
                <p className="text-body text-[var(--danger)]">
                  {t('importRejected', { count: result.rejected })}
                </p>
                {errorReportHref ? (
                  <a
                    href={errorReportHref}
                    download={`${fileName || 'import'}-errors.csv`}
                    className="min-h-tap py-1 text-body text-[var(--accent)] underline"
                  >
                    {t('importDownloadErrors')}
                  </a>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
