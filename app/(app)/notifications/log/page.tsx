import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';
import { deliveryLogQuerySchema, getDeliveryLog } from '@/lib/services/notifications/inbox';

export const dynamic = 'force-dynamic';

/** The reasons Volt itself produces; anything else came from a provider. */
const KNOWN_REASONS = ['optedOut', 'noDestination', 'quietHours'];

/**
 * The delivery log.
 *
 * "When a parent says 'I was never informed', the school can show them otherwise. That log
 * is a feature you should demo explicitly." So it is searchable by name or phone number,
 * because that is always how the question arrives, and it shows the suppressions and the
 * failures next to the successes rather than only the happy path.
 */
export default async function DeliveryLogPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  if (!can(actor, 'audit.read')) notFound();

  const t = await getTranslations('notifications');
  const query = deliveryLogQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const rows = await withActor(actor, () => getDeliveryLog(actor, query));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('log')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('logSubtitle')}</p>
      </header>

      <form className="flex gap-2" action="/notifications/log">
        <input
          name="search"
          defaultValue={query.search ?? ''}
          placeholder="Name or phone number"
          className="min-h-tap flex-1 rounded-button border border-[var(--border-subtle)] bg-[var(--surface)] px-3 text-body text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          data-testid="log-search"
        />
        <button
          type="submit"
          className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
        >
          {t('log')}
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="delivery-log">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-1 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
              data-testid="delivery-row"
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body text-[var(--text-primary)]">
                  {row.userName}
                  {row.userPhone ? (
                    <span className="ms-2 font-mono text-small text-[var(--text-tertiary)]">
                      {row.userPhone}
                    </span>
                  ) : null}
                </span>
                <span
                  className={
                    row.status === 'FAILED'
                      ? 'text-small text-[var(--danger)]'
                      : row.status === 'SUPPRESSED'
                        ? 'text-small text-[var(--warning)]'
                        : 'text-small text-[var(--success)]'
                  }
                >
                  {t(`status${row.status}`)}
                </span>
              </span>

              <span className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                <span>{t(`channel${row.channel}`)}</span>
                <span>{row.type}</span>
                <span>{(row.sentAt ?? row.createdAt).slice(0, 16).replace('T', ' ')}</span>
              </span>

              <span className="text-small text-[var(--text-secondary)]">{row.title}</span>

              {row.failureReason ? (
                <span className="text-small text-[var(--warning)]" data-testid="delivery-reason">
                  {/*
                    Translated where we know the reason, and shown raw where we do not —
                    a provider's own error message is more use to the office than a
                    generic "failed", even untranslated.
                  */}
                  {KNOWN_REASONS.includes(row.failureReason)
                    ? t(`reason${row.failureReason}`)
                    : row.failureReason}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
