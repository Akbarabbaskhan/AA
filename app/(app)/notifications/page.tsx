import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { NotificationPreferences } from '@/components/features/notifications/preferences';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { getInbox, getPreferences } from '@/lib/services/notifications/inbox';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('notifications');

  const { inbox, preferences } = await withActor(actor, async () => ({
    inbox: await getInbox(actor, { limit: 50 }),
    preferences: await getPreferences(actor),
  }));

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-h1">{t('title')}</h1>
        {inbox.unread > 0 ? (
          <span className="text-small text-[var(--text-tertiary)]" data-testid="unread-count">
            {t('unread', { count: inbox.unread })}
          </span>
        ) : null}
      </header>

      {inbox.items.length === 0 ? (
        <EmptyState title={t('none')} body={t('noneBody')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="notification-list">
          {inbox.items.map((item) => (
            <li
              key={item.id}
              className={[
                'flex flex-col gap-1 rounded-card border bg-[var(--surface)] p-3',
                item.readAt ? 'border-[var(--border-subtle)]' : 'border-[var(--accent)]',
              ].join(' ')}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body font-medium text-[var(--text-primary)]">{item.title}</span>
                <span className="text-small text-[var(--text-tertiary)]">
                  {item.createdAt.slice(0, 10)}
                </span>
              </span>
              <span className="text-body text-[var(--text-secondary)]">{item.body}</span>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('preferences')}</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferences rows={preferences} />
        </CardContent>
      </Card>
    </div>
  );
}
