'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

type Schedule = {
  id: string;
  reportKey: string;
  cadence: string;
  hourLocal: number;
  format: string;
  isActive: boolean;
  lastRunAt: string | null;
};

/**
 * Scheduling a report as a recurring email.
 *
 * Recipients are roles rather than a list of addresses: a principal who leaves takes their
 * inbox with them, and "whoever is the bursar" is what the school actually means.
 */
export function ScheduleForm({
  reportKeys,
  schedules,
}: {
  reportKeys: string[];
  schedules: Schedule[];
}) {
  const t = useTranslations('reports');
  const router = useRouter();

  const [reportKey, setReportKey] = useState(reportKeys[0] ?? '');
  const [cadence, setCadence] = useState('WEEKLY');
  const [hourLocal, setHourLocal] = useState(7);
  const [format, setFormat] = useState('XLSX');
  const [roles, setRoles] = useState<string[]>(['ADMIN']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const control =
    'min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body';

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/reports/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reportKey,
          cadence,
          hourLocal,
          format,
          recipients: { userIds: [], roles },
        }),
      });
      if (!response.ok) {
        const json: unknown = await response.json();
        throw new Error(
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save',
        );
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string, isActive: boolean): Promise<void> {
    await fetch('/api/reports/schedules', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, isActive }),
    });
    router.refresh();
  }

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
      data-testid="schedule-form"
    >
      <h2 className="text-h3">{t('schedules')}</h2>

      {schedules.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="schedule-list">
          {schedules.map((schedule) => (
            <li
              key={schedule.id}
              className="flex flex-wrap items-center justify-between gap-2 text-body"
            >
              <span>
                {t(`report.${schedule.reportKey}.title`)} ·{' '}
                <span className="text-small text-[var(--text-tertiary)]">
                  {t(`cadence.${schedule.cadence}`)} {String(schedule.hourLocal).padStart(2, '0')}
                  :00 · {schedule.format}
                </span>
              </span>
              <label className="flex min-h-tap items-center gap-2 text-small">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={schedule.isActive}
                  onChange={(event) => void toggle(schedule.id, event.target.checked)}
                  data-testid={`schedule-active-${schedule.id}`}
                />
                {t('active')}
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-2 tablet:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('report')}</span>
          <select
            className={control}
            value={reportKey}
            onChange={(event) => setReportKey(event.target.value)}
            data-testid="schedule-report"
          >
            {reportKeys.map((key) => (
              <option key={key} value={key}>
                {t(`report.${key}.title`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('cadenceLabel')}</span>
          <select
            className={control}
            value={cadence}
            onChange={(event) => setCadence(event.target.value)}
            data-testid="schedule-cadence"
          >
            {['DAILY', 'WEEKLY', 'MONTHLY'].map((value) => (
              <option key={value} value={value}>
                {t(`cadence.${value}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('hour')}</span>
          <select
            className={control}
            value={hourLocal}
            onChange={(event) => setHourLocal(Number(event.target.value))}
            data-testid="schedule-hour"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('format')}</span>
          <select
            className={control}
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            data-testid="schedule-format"
          >
            <option value="XLSX">Excel</option>
            <option value="PDF">PDF</option>
          </select>
        </label>
      </div>

      <fieldset className="flex flex-wrap gap-3">
        <legend className="text-small text-[var(--text-tertiary)]">{t('recipients')}</legend>
        {['ADMIN', 'BURSAR', 'HOD'].map((role) => (
          <label key={role} className="flex min-h-tap items-center gap-2 text-body">
            <input
              type="checkbox"
              className="h-5 w-5 accent-[var(--accent)]"
              checked={roles.includes(role)}
              onChange={(event) =>
                setRoles((current) =>
                  event.target.checked
                    ? [...current, role]
                    : current.filter((entry) => entry !== role),
                )
              }
              data-testid={`schedule-role-${role}`}
            />
            {role}
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-2">
        <Button onClick={create} disabled={busy || roles.length === 0} data-testid="schedule-save">
          {busy ? t('saving') : t('scheduleIt')}
        </Button>
        {error ? (
          <span className="text-small text-[var(--danger)]" data-testid="schedule-error">
            {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}
