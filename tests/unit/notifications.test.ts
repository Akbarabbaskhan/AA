import { describe, expect, it } from 'vitest';
import { isWithinQuietHours, minutesOfDay, releaseAt } from '@/lib/services/notifications/quiet-hours';
import {
  NOTIFICATION_TYPE_NAMES,
  NOTIFICATION_TYPES,
  WHATSAPP_TEMPLATES,
  isKnownType,
  specFor,
} from '@/lib/services/notifications/types';

describe('quiet hours', () => {
  const overnight = { from: '21:00', to: '07:00' };

  it('holds a message at midnight', () => {
    expect(isWithinQuietHours(minutesOfDay('00:30'), overnight)).toBe(true);
  });

  it('holds a message at 21:00 exactly — the boundary is inclusive at the start', () => {
    expect(isWithinQuietHours(minutesOfDay('21:00'), overnight)).toBe(true);
  });

  it('releases at 07:00 exactly — the boundary is exclusive at the end', () => {
    expect(isWithinQuietHours(minutesOfDay('07:00'), overnight)).toBe(false);
  });

  it('sends in the middle of the day', () => {
    expect(isWithinQuietHours(minutesOfDay('14:00'), overnight)).toBe(false);
  });

  it('handles a window that does not wrap midnight', () => {
    const lunch = { from: '13:00', to: '14:00' };
    expect(isWithinQuietHours(minutesOfDay('13:30'), lunch)).toBe(true);
    expect(isWithinQuietHours(minutesOfDay('12:30'), lunch)).toBe(false);
    expect(isWithinQuietHours(minutesOfDay('23:00'), lunch)).toBe(false);
  });

  it('treats an equal from and to as "no quiet hours", never as a permanent blackout', () => {
    // The alternative reading silences the whole system with no error anywhere.
    const none = { from: '00:00', to: '00:00' };
    expect(isWithinQuietHours(minutesOfDay('03:00'), none)).toBe(false);
    expect(isWithinQuietHours(minutesOfDay('15:00'), none)).toBe(false);
  });
});

describe('releaseAt', () => {
  // Pakistan is UTC+5, so a local 23:10 is 18:10 UTC.
  const offset = 5 * 60;
  const overnight = { from: '21:00', to: '07:00' };

  it('returns null when nothing is being held', () => {
    const middayUtc = new Date('2026-09-23T07:00:00.000Z'); // 12:00 local
    expect(releaseAt(middayUtc, overnight, offset)).toBeNull();
  });

  it('releases a late-evening message the next morning, not at once', () => {
    const lateUtc = new Date('2026-09-23T18:10:00.000Z'); // 23:10 local
    const release = releaseAt(lateUtc, overnight, offset);
    expect(release).not.toBeNull();
    // 07:00 local on the 24th is 02:00 UTC.
    expect(release?.toISOString()).toBe('2026-09-24T02:00:00.000Z');
  });

  it('releases an early-hours message the same morning', () => {
    const earlyUtc = new Date('2026-09-23T00:30:00.000Z'); // 05:30 local
    const release = releaseAt(earlyUtc, overnight, offset);
    expect(release?.toISOString()).toBe('2026-09-23T02:00:00.000Z');
  });
});

describe('notification type registry', () => {
  it('sends absence alerts on the channels a Pakistani parent actually reads', () => {
    const spec = specFor('attendance.absent');
    expect(spec.defaultChannels).toContain('WHATSAPP');
    expect(spec.defaultChannels).toContain('IN_APP');
  });

  it('batches absences per day, so four missed periods is one message', () => {
    expect(specFor('attendance.absent').batching).toBe('DAILY_PER_USER');
  });

  it('keeps every type on in-app, which is the record of what was sent', () => {
    for (const type of NOTIFICATION_TYPE_NAMES) {
      expect(specFor(type).defaultChannels, type).toContain('IN_APP');
    }
  });

  it('reserves urgency for things that genuinely cannot wait until morning', () => {
    const urgent = NOTIFICATION_TYPE_NAMES.filter((type) => specFor(type).isUrgent);
    // A fee reminder at 22:30 is how a school teaches parents to mute it.
    expect(urgent).not.toContain('fee.reminder');
    expect(urgent).not.toContain('announcement.published');
    expect(urgent).toContain('security.alert');
  });

  it('has an approved WhatsApp template for every type that sends over WhatsApp', () => {
    for (const type of NOTIFICATION_TYPE_NAMES) {
      if (!specFor(type).defaultChannels.includes('WHATSAPP')) continue;
      expect(WHATSAPP_TEMPLATES[type], `${type} needs a template name`).toBeTruthy();
    }
  });

  it('recognises its own type names and rejects anything else', () => {
    expect(isKnownType('attendance.absent')).toBe(true);
    expect(isKnownType('attendance.teleport')).toBe(false);
  });

  it('never batches a receipt — a family at the counter wants it now', () => {
    expect(specFor('fee.receipt').batching).toBe('NONE');
    expect(specFor('fee.receipt').isUrgent).toBe(true);
  });

  it('declares at least one channel for every type', () => {
    for (const [type, spec] of Object.entries(NOTIFICATION_TYPES)) {
      expect(spec.defaultChannels.length, type).toBeGreaterThan(0);
    }
  });
});
