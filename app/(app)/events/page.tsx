import { getLocale, getTranslations } from 'next-intl/server';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { RsvpButton } from '@/components/features/societies/rsvp-button';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { requireModule } from '@/lib/auth/module-guard';
import { can } from '@/lib/permissions';
import { eventQuerySchema, listEvents } from '@/lib/services/events';
import { formatDate, formatTime } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const actor = await requireSessionActor();
  await requireModule(actor, 'events');
  const t = await getTranslations('events');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const query = eventQuerySchema.parse(
    Object.fromEntries(
      Object.entries(searchParams).flatMap(([key, value]) =>
        value === undefined ? [] : [[key, Array.isArray(value) ? value[0] : value]],
      ),
    ),
  );

  const events = await withActor(actor, () => listEvents(actor, query));
  const canRsvp = can(actor, 'event.rsvp');

  if (events.length === 0) {
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
        {events.map((event) => (
          <li key={event.id} data-testid="event-row">
            <Card>
              <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-4">
                <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
                  <span className="text-h3 text-[var(--text-primary)]" data-testid="event-title">
                    {event.title}
                  </span>

                  <span className="text-small text-[var(--text-secondary)]">
                    {formatDate(new Date(event.startsAt), locale)} ·{' '}
                    {formatTime(new Date(event.startsAt), locale)}
                    {event.venue ? ` · ${event.venue}` : ''}
                  </span>

                  {event.societyName ? (
                    <span className="text-small text-[var(--text-tertiary)]">
                      {event.societyName}
                    </span>
                  ) : null}

                  <span className="flex flex-wrap gap-3 text-small text-[var(--text-tertiary)]">
                    <span>{t('going', { count: event.going })}</span>
                    {event.capacity === null ? (
                      <span>{t('noCapacity')}</span>
                    ) : event.placesLeft === 0 ? (
                      <span className="text-[var(--warning)]">
                        {t('full')} · {t('waitlisted', { count: event.waitlisted })}
                      </span>
                    ) : (
                      <span>{t('placesLeft', { count: event.placesLeft ?? 0 })}</span>
                    )}
                  </span>
                </div>

                {canRsvp && event.rsvpRequired !== false ? (
                  <RsvpButton
                    eventId={event.id}
                    status={event.myStatus}
                    waitlistPosition={event.myWaitlistPosition}
                    placesLeft={event.placesLeft}
                  />
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
