'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * One card of settings, saved on its own.
 *
 * Each card PATCHes only its own section, so two people editing different parts of the
 * console at the same time cannot overwrite each other's work — which they will, because the
 * bursar edits the bank block on the same afternoon the coordinator sets the lock window.
 */
export type SettingField =
  | { kind: 'number'; name: string; label: string; hint?: string; value: number; min?: number; max?: number }
  | { kind: 'text'; name: string; label: string; hint?: string; value: string }
  | { kind: 'time'; name: string; label: string; hint?: string; value: string }
  | { kind: 'boolean'; name: string; label: string; hint?: string; value: boolean }
  | { kind: 'select'; name: string; label: string; hint?: string; value: string; options: { value: string; label: string }[] };

type Payload = Record<string, unknown>;

/** `a.b.c` into `{ a: { b: { c: value } } }`, which is the shape the PATCH expects. */
function nest(path: string, value: unknown): Payload {
  const parts = path.split('.');
  return parts.reduceRight<unknown>((carried, key) => ({ [key]: carried }), value) as Payload;
}

function merge(target: Payload, source: Payload): Payload {
  const output: Payload = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const existing = output[key];
    output[key] =
      existing && typeof existing === 'object' && value && typeof value === 'object'
        ? merge(existing as Payload, value as Payload)
        : value;
  }
  return output;
}

export function SettingsCard({
  title,
  description,
  fields,
  testId,
}: {
  title: string;
  description?: string;
  fields: SettingField[];
  testId: string;
}) {
  const t = useTranslations('settings');
  const router = useRouter();

  const [values, setValues] = useState<Record<string, string | number | boolean>>(
    Object.fromEntries(fields.map((field) => [field.name, field.value])),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = fields.reduce<Payload>(
        (carried, field) => merge(carried, nest(field.name, values[field.name])),
        {},
      );

      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not save')
            : 'Could not save';
        throw new Error(message);
      }
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const control =
    'min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body text-[var(--text-primary)]';

  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
      data-testid={testId}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-h3">{title}</h2>
        {description ? (
          <p className="text-small text-[var(--text-tertiary)]">{description}</p>
        ) : null}
      </header>

      <div className="grid gap-3 tablet:grid-cols-2">
        {fields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1">
            <span className="text-small text-[var(--text-secondary)]">{field.label}</span>

            {field.kind === 'boolean' ? (
              <span className="flex min-h-tap items-center gap-2">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-[var(--accent)]"
                  checked={Boolean(values[field.name])}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.name]: event.target.checked }))
                  }
                  data-testid={`setting-${field.name}`}
                />
                <span className="text-small text-[var(--text-tertiary)]">{field.hint ?? ''}</span>
              </span>
            ) : field.kind === 'select' ? (
              <select
                className={control}
                value={String(values[field.name])}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.name]: event.target.value }))
                }
                data-testid={`setting-${field.name}`}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={field.kind === 'number' ? 'number' : field.kind === 'time' ? 'time' : 'text'}
                {...(field.kind === 'number' && field.min !== undefined ? { min: field.min } : {})}
                {...(field.kind === 'number' && field.max !== undefined ? { max: field.max } : {})}
                value={String(values[field.name])}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.name]:
                      field.kind === 'number' ? Number(event.target.value) : event.target.value,
                  }))
                }
                data-testid={`setting-${field.name}`}
              />
            )}

            {field.kind !== 'boolean' && field.hint ? (
              <span className="text-small text-[var(--text-tertiary)]">{field.hint}</span>
            ) : null}
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={busy} data-testid={`${testId}-save`}>
          {busy ? t('saving') : t('save')}
        </Button>
        {saved ? (
          <span className="text-small text-[var(--success)]" data-testid={`${testId}-saved`}>
            {t('saved')}
          </span>
        ) : null}
        {error ? (
          <span className="text-small text-[var(--danger)]" data-testid={`${testId}-error`}>
            {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}
