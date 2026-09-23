import { getTranslations, getLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/states';
import { BookSlot } from '@/components/features/parents/book-slot';
import { requireSessionActor, withActor } from '@/lib/auth/session';
import { listSlots } from '@/lib/services/parents/bookings';
import { formatDate, formatTime } from '@/lib/i18n/format';

export const dynamic = 'force-dynamic';

/**
 * Parent–teacher meeting slots.
 *
 * Grouped by teacher, because a parent comes here wanting a word with one particular
 * person. A parent never sees who holds another slot — only that it is taken.
 */
export default async function MeetingsPage() {
  const actor = await requireSessionActor();
  const t = await getTranslations('parents');
  const locale = (await getLocale()) === 'ur' ? 'ur' : 'en';

  const slots = await withActor(actor, () => listSlots(actor));

  if (slots.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-h1">{t('meetings')}</h1>
        <EmptyState title={t('noSlots')} body={t('noSlotsBody')} />
      </div>
    );
  }

  const byTeacher = new Map<string, typeof slots>();
  for (const slot of slots) {
    byTeacher.set(slot.staffName, [...(byTeacher.get(slot.staffName) ?? []), slot]);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-h1">{t('meetings')}</h1>

      {[...byTeacher.entries()].map(([staffName, teacherSlots]) => (
        <section key={staffName} className="flex flex-col gap-2">
          <h2 className="text-h2">{staffName}</h2>
          <p className="text-small text-[var(--text-tertiary)]">
            {formatDate(new Date(teacherSlots[0]!.startsAt), locale)}
          </p>

          <ul className="flex flex-wrap gap-2" data-testid="slot-list">
            {teacherSlots.map((slot) => (
              <li key={slot.id}>
                <BookSlot
                  slotId={slot.id}
                  label={formatTime(new Date(slot.startsAt), locale)}
                  status={slot.status}
                  isMine={slot.isMine}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
