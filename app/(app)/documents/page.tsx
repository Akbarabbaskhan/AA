import { getLocale, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getLocker } from '@/lib/services/identity';
import { formatDate } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * The document locker.
 *
 * "All downloadable" — which is the point. A student needing a character certificate the
 * night before a deadline should not have to wait for an office to open, and a parent
 * reprinting a result card should not have to ask.
 *
 * Every link is a short-lived signed URL minted for this request, so the page can be left
 * open without leaving a permanently readable link behind.
 */
export default async function DocumentsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('identity');
  const tc = await getTranslations('careers');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const items = await withActor(actor, () => getLocker(actor));

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('documents')}</h1>
        <EmptyState title={t('noDocuments')} body={t('noDocumentsBody')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">{t('documents')}</h1>
        <p className="text-small text-[var(--text-tertiary)]">{t('documentsSubtitle')}</p>
      </header>

      <ul className="flex flex-col gap-2" data-testid="locker-list">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--surface)] p-3"
            data-testid="locker-item"
          >
            <span className="flex flex-col gap-1">
              <span className="text-body text-[var(--text-primary)]">{item.title}</span>
              <span className="text-small text-[var(--text-tertiary)]">
                {formatDate(new Date(item.createdAt), locale)}
              </span>
            </span>

            <a
              href={item.url}
              className="min-h-tap rounded-button border border-[var(--border-subtle)] px-3 py-2 text-body text-[var(--text-primary)] hover:border-[var(--border-strong)]"
              data-testid="locker-download"
            >
              {tc('download')}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
