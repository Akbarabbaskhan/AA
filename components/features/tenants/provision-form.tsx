'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Provisioning a school.
 *
 * Eleven fields, because that is what a school actually needs before anybody can sign in: a
 * name, a handle, a theme, the academic year, and the first coordinator. Everything else is a
 * setting they will change anyway.
 */
export function ProvisionForm({ themes }: { themes: { id: string; displayName: string }[] }) {
  const t = useTranslations('tenants');
  const router = useRouter();

  const thisYear = new Date().getUTCFullYear();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({
    name: '',
    slug: '',
    themeId: themes[0]?.id ?? 'volt-default',
    adminName: '',
    adminEmail: '',
    adminPhone: '',
    adminPassword: '',
    yearLabel: `${thisYear}–${String((thisYear + 1) % 100).padStart(2, '0')}`,
    yearStart: `${thisYear}-04-01`,
    yearEnd: `${thisYear + 1}-03-31`,
  });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof typeof values, value: string): void {
    setValues((current) => ({ ...current, [field]: value }));
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} data-testid="provision-open">
        {t('provision')}
      </Button>
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof json === 'object' && json !== null && 'error' in json
            ? String((json as { error: { message?: string } }).error.message ?? 'Could not create')
            : 'Could not create',
        );
      }
      setCreated((json as { slug: string }).slug);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create');
    } finally {
      setBusy(false);
    }
  }

  const fields: [keyof typeof values, string, string?][] = [
    ['name', t('field.name')],
    ['slug', t('field.slug')],
    ['adminName', t('field.adminName')],
    ['adminEmail', t('field.adminEmail')],
    ['adminPhone', t('field.adminPhone')],
    ['adminPassword', t('field.adminPassword'), 'password'],
    ['yearLabel', t('field.yearLabel')],
    ['yearStart', t('field.yearStart'), 'date'],
    ['yearEnd', t('field.yearEnd'), 'date'],
  ];

  return (
    <section
      className="flex w-full max-w-[44rem] flex-col gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
      data-testid="provision-form"
    >
      <h2 className="text-h3">{t('provision')}</h2>

      <div className="grid gap-2 tablet:grid-cols-2">
        {fields.map(([field, label, type]) => (
          <label key={field} className="flex flex-col gap-1">
            <span className="text-small text-[var(--text-tertiary)]">{label}</span>
            <Input
              type={type ?? 'text'}
              value={values[field]}
              onChange={(event) => set(field, event.target.value)}
              data-testid={`provision-${field}`}
            />
          </label>
        ))}

        <label className="flex flex-col gap-1">
          <span className="text-small text-[var(--text-tertiary)]">{t('field.theme')}</span>
          <select
            className="min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body"
            value={values.themeId}
            onChange={(event) => set('themeId', event.target.value)}
            data-testid="provision-theme"
          >
            {themes.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
        <Button
          onClick={submit}
          disabled={
            busy ||
            values.name.trim().length < 3 ||
            values.slug.trim().length < 3 ||
            values.adminEmail.trim().length < 5 ||
            values.adminPassword.length < 12
          }
          data-testid="provision-save"
        >
          {busy ? t('creating') : t('create')}
        </Button>
        {created ? (
          <span className="text-small text-[var(--success)]" data-testid="provision-created">
            {t('created', { slug: created })}
          </span>
        ) : null}
        {error ? (
          <span className="text-small text-[var(--danger)]" data-testid="provision-error">
            {error}
          </span>
        ) : null}
      </div>
    </section>
  );
}
