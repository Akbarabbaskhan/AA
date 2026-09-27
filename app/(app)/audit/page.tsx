import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { auditQuerySchema, searchAuditLog } from '@/lib/services/audit-search';
import { formatDateTime } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * The audit log, for a coordinator with a parent on the phone.
 *
 * "An admin can answer 'who changed my son's Chemistry mark on 14 October and what was it
 * before?' from the UI, without a developer." So the filters are the words that arrive in
 * that sentence — a child's name, a date, the kind of record — and each row leads with what
 * changed rather than which table it lived in.
 *
 * Desktop-first, because this is spreadsheet-shaped work done sitting down. Readable on a
 * phone, which is where the call actually comes in.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  const [t, tc] = await Promise.all([getTranslations('audit'), getTranslations('common')]);
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const query = auditQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const page = await withActor(actor, () => searchAuditLog(actor, query));

  const nextHref = (cursor: string) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === 'string' && key !== 'cursor') params.set(key, value);
    }
    params.set('cursor', cursor);
    return `/audit?${params.toString()}`;
  };

  const field =
    'min-h-tap rounded-input border border-[var(--border-subtle)] bg-[var(--surface-raised)] px-2 text-body text-[var(--text-primary)]';

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('subtitle')}</p>
      </header>

      <Card>
        <CardContent className="pt-4">
          <form method="get" className="grid gap-2 tablet:grid-cols-3 desktop:grid-cols-6">
            <label className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('student')}</span>
              <input
                type="search"
                name="student"
                defaultValue={query.student ?? ''}
                placeholder={t('studentPlaceholder')}
                className={field}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('actor')}</span>
              <input
                type="search"
                name="actor"
                defaultValue={query.actor ?? ''}
                placeholder={t('actorPlaceholder')}
                className={field}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('entityType')}</span>
              <select name="entityType" defaultValue={query.entityType ?? ''} className={field}>
                <option value="">{t('anyType')}</option>
                {page.entityTypes.map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('action')}</span>
              <select name="action" defaultValue={query.action ?? ''} className={field}>
                <option value="">{t('anyAction')}</option>
                {page.actions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('from')}</span>
              <input type="date" name="from" defaultValue={query.from ?? ''} className={field} />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-small text-[var(--text-tertiary)]">{t('to')}</span>
              <input type="date" name="to" defaultValue={query.to ?? ''} className={field} />
            </label>

            <div className="flex items-end gap-2 tablet:col-span-3 desktop:col-span-6">
              <Button type="submit">{t('search')}</Button>
              <Button asChild variant="ghost">
                <Link href="/audit">{t('clear')}</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {page.rows.length === 0 ? (
        <EmptyState title={t('noRows')} body={t('noRowsBody')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="audit-list">
          {page.rows.map((row) => (
            <li key={row.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-4" data-testid="audit-row">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-body font-medium text-[var(--text-primary)]">
                      {row.label}
                    </span>
                    <span data-numeric className="text-small text-[var(--text-tertiary)]">
                      {formatDateTime(new Date(row.at), locale)}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-small text-[var(--text-secondary)]">
                    <span data-testid="audit-action">{row.action}</span>
                    <span>·</span>
                    <span data-testid="audit-actor">{row.actorName}</span>
                    {row.impersonatedByName ? (
                      <span className="text-[var(--warning)]">
                        {t('impersonatedBy', { name: row.impersonatedByName })}
                      </span>
                    ) : null}
                    {row.ip ? <span className="font-mono text-[var(--text-tertiary)]">{row.ip}</span> : null}
                  </div>

                  {row.changes.length > 0 ? (
                    <ul className="flex flex-col gap-1" data-testid="audit-changes">
                      {row.changes.map((change) => (
                        <li key={change.field} className="flex flex-wrap items-baseline gap-2 text-body">
                          <span className="text-small text-[var(--text-tertiary)]">{change.field}</span>
                          <span className="text-[var(--text-secondary)] line-through">
                            {change.before ?? tc('none')}
                          </span>
                          <span aria-hidden="true">→</span>
                          <span className="font-medium text-[var(--text-primary)]">
                            {change.after ?? tc('none')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {row.reason ? (
                    <p className="text-small text-[var(--text-secondary)]" data-testid="audit-reason">
                      {t('reason')}: {row.reason}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Button asChild variant="secondary">
          <Link href={nextHref(page.nextCursor)} data-testid="audit-next">
            {t('older')}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
