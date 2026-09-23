import { getTranslations, getLocale } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { listAnnouncements } from '@/lib/services/announcements';
import { formatDate } from '@/lib/i18n/format';
import { MarkAnnouncementRead } from '@/components/features/announcements/mark-read';

export const dynamic = 'force-dynamic';

/**
 * The announcement board.
 *
 * Pinned first, then newest. Staff see the aggregate reach under each one — "412 of 480
 * have seen this" — which is the number that tells an admin whether to send it again.
 * Never a list of who has not read it.
 */
export default async function AnnouncementsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('announcements');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const announcements = await withActor(actor, () => listAnnouncements(actor, { limit: 50 }));

  if (announcements.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('title')}</h1>
        <EmptyState title={t('none')} body={t('noneBody')} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1">{t('title')}</h1>

      <ul className="flex flex-col gap-2">
        {announcements.map((announcement) => (
          <li key={announcement.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 pt-4" data-testid="announcement">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-h3 text-[var(--text-primary)]">
                    {announcement.pinned ? '📌 ' : ''}
                    {announcement.title}
                  </span>
                  <span className="text-small text-[var(--text-tertiary)]">
                    {formatDate(new Date(announcement.publishAt), locale)}
                  </span>
                </span>

                <p className="whitespace-pre-wrap text-body text-[var(--text-secondary)]">
                  {announcement.body}
                </p>

                <span className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                  <span>{t('by', { name: announcement.authorName })}</span>
                  {announcement.reach ? (
                    <span data-testid="announcement-reach">
                      {t('reach', {
                        seen: announcement.reach.seen,
                        audience: announcement.reach.audience,
                      })}
                    </span>
                  ) : null}
                </span>

                {!announcement.isRead ? <MarkAnnouncementRead id={announcement.id} /> : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
