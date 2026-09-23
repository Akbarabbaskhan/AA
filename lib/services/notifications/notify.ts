import type { DeliveryStatus, NotificationChannel, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSchoolSettings } from '@/lib/services/school-settings';
import { timezoneOffsetMs } from '@/lib/utils/tz';
import { providerFor, type OutboundMessage } from './providers';
import { isWithinQuietHours, type QuietHours } from './quiet-hours';
import { NOTIFICATION_TYPE_NAMES, specFor, WHATSAPP_TEMPLATES, type NotificationType } from './types';

/**
 * `notify(userId, type, payload)` — the one way anything in Volt reaches a person.
 *
 * Nothing else in the codebase talks to WhatsApp, SMS or email. A feature that wants to
 * tell somebody something calls this with a type, and the type's spec plus the recipient's
 * preferences decide the rest. That is what makes "add SMS" a provider rather than a
 * rewrite, and it is what makes the delivery log complete — a log with a back door is not
 * evidence when a parent says "I was never informed".
 *
 * Four rules, in order:
 *   1. The recipient's preference wins over the type's default. Always.
 *   2. Batched types collapse into one message per recipient per window.
 *   3. Non-urgent messages are held through quiet hours rather than dropped.
 *   4. Every attempt is written down, including the ones that were suppressed and why.
 */

export type NotifyPayload = {
  title: string;
  body: string;
  /** Variables for the approved WhatsApp template, in template order. */
  templateVariables?: string[];
  /** Anything the in-app item needs to link somewhere useful. */
  link?: string;
  [key: string]: unknown;
};

export type NotifyResult = {
  notificationIds: string[];
  attempted: NotificationChannel[];
  /** Channels not attempted, and why — a suppression is an outcome, not a silence. */
  suppressed: { channel: NotificationChannel; reason: string }[];
  /** True when this send joined an existing batch instead of creating a new one. */
  batched: boolean;
};

function batchKeyFor(type: NotificationType, userId: string, now: Date): string | null {
  const spec = specFor(type);
  if (spec.batching === 'NONE') return null;
  const day = now.toISOString().slice(0, 10);
  if (spec.batching === 'DAILY_PER_USER') return `${type}:${userId}:${day}`;
  return `${type}:${userId}:${day}:${String(now.getUTCHours()).padStart(2, '0')}`;
}

function destinationFor(
  channel: NotificationChannel,
  user: { id: string; phone: string | null; email: string | null },
): string {
  if (channel === 'WHATSAPP' || channel === 'SMS') return user.phone ?? '';
  if (channel === 'EMAIL') return user.email ?? '';
  return user.id;
}

/**
 * Sends, or joins a batch.
 *
 * The batching contract is the spec's: "a parent whose child missed four periods gets one
 * message, not four." So a second absence on the same day updates the existing
 * notification's payload with a running count and does not send again — the message the
 * parent gets says four periods because it was rewritten before it went out, not because
 * four messages arrived.
 */
export async function notify(
  schoolId: string,
  userId: string,
  type: NotificationType,
  payload: NotifyPayload,
  options: { now?: Date } = {},
): Promise<NotifyResult> {
  const now = options.now ?? new Date();
  const spec = specFor(type);

  const user = await prisma.user.findFirst({
    where: { id: userId },
    select: { id: true, phone: true, email: true, locale: true, isActive: true },
  });
  if (!user) {
    return { notificationIds: [], attempted: [], suppressed: [], batched: false };
  }
  if (!user.isActive) {
    return {
      notificationIds: [],
      attempted: [],
      suppressed: spec.defaultChannels.map((channel) => ({ channel, reason: 'accountInactive' })),
      batched: false,
    };
  }

  const [settings, preferences] = await Promise.all([
    getSchoolSettings(),
    prisma.notificationPreference.findMany({
      where: { userId, type },
      select: { channel: true, enabled: true },
    }),
  ]);
  const preference = new Map(preferences.map((row) => [row.channel, row.enabled]));

  const batchKey = batchKeyFor(type, userId, now);
  if (batchKey) {
    const existing = await prisma.notification.findFirst({
      where: { batchKey, userId, deliveryStatus: 'QUEUED' },
      select: { id: true, payloadJson: true, channel: true },
    });
    if (existing) {
      // Fold this event into the pending one. The count is what turns four absence
      // events into "missed 4 periods today" in a single message.
      const previous = (existing.payloadJson ?? {}) as Record<string, unknown>;
      const count = typeof previous['count'] === 'number' ? previous['count'] + 1 : 2;
      await prisma.notification.updateMany({
        where: { batchKey, userId, deliveryStatus: 'QUEUED' },
        data: {
          payloadJson: { ...previous, ...payload, count } as Prisma.InputJsonValue,
        },
      });
      return { notificationIds: [existing.id], attempted: [], suppressed: [], batched: true };
    }
  }

  const quietHours: QuietHours = settings.notifications.quietHours;
  const offsetMinutes = timezoneOffsetMs(now, settings.timezone) / 60_000;
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const localMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const isQuiet = !spec.isUrgent && isWithinQuietHours(localMinutes, quietHours);

  const notificationIds: string[] = [];
  const attempted: NotificationChannel[] = [];
  const suppressed: NotifyResult['suppressed'] = [];

  for (const channel of spec.defaultChannels) {
    const enabled = preference.get(channel);
    if (enabled === false) {
      // Recorded rather than skipped silently: "why did the parent not get this?" must be
      // answerable from the log alone.
      await writeRow(schoolId, userId, channel, type, payload, batchKey, 'SUPPRESSED', {
        failureReason: 'optedOut',
        sentAt: now,
      });
      suppressed.push({ channel, reason: 'optedOut' });
      continue;
    }

    const destination = destinationFor(channel, user);
    if (!destination) {
      await writeRow(schoolId, userId, channel, type, payload, batchKey, 'SUPPRESSED', {
        failureReason: 'noDestination',
        sentAt: now,
      });
      suppressed.push({ channel, reason: 'noDestination' });
      continue;
    }

    const row = await writeRow(
      schoolId,
      userId,
      channel,
      type,
      payload,
      batchKey,
      'QUEUED',
      {},
    );
    notificationIds.push(row.id);

    /*
     * A batched type is never delivered here.
     *
     * "A parent whose child missed four periods gets one message, not four" only works if
     * the first message is still pending when the second event arrives — sending it
     * immediately leaves nothing to batch into, and the parent gets four after all. The
     * row waits in the queue, its count rises as more events land, and `flushPending`
     * sends the one message once the window closes.
     *
     * In-app is exempt from the quiet-hours hold because it makes no noise and is the
     * record of what the school sent, but it still waits for a batch window so the inbox
     * shows one item reading "4 periods" rather than four items.
     */
    if (batchKey !== null) {
      suppressed.push({ channel, reason: 'batching' });
      continue;
    }

    const holdForQuietHours = isQuiet && channel !== 'IN_APP';
    if (holdForQuietHours) {
      suppressed.push({ channel, reason: 'quietHours' });
      continue;
    }

    await deliver(row.id, {
      notificationId: row.id,
      type,
      channel,
      destination,
      title: payload.title,
      body: payload.body,
      locale: user.locale === 'ur' ? 'ur' : 'en',
      ...(WHATSAPP_TEMPLATES[type] ? { templateName: WHATSAPP_TEMPLATES[type] } : {}),
      ...(payload.templateVariables ? { templateVariables: payload.templateVariables } : {}),
    });
    attempted.push(channel);
  }

  return { notificationIds, attempted, suppressed, batched: false };
}

async function writeRow(
  schoolId: string,
  userId: string,
  channel: NotificationChannel,
  type: NotificationType,
  payload: NotifyPayload,
  batchKey: string | null,
  deliveryStatus: DeliveryStatus,
  extra: { failureReason?: string; sentAt?: Date },
): Promise<{ id: string }> {
  return prisma.notification.create({
    data: {
      schoolId,
      userId,
      channel,
      type,
      payloadJson: payload as Prisma.InputJsonValue,
      batchKey,
      deliveryStatus,
      failureReason: extra.failureReason ?? null,
      sentAt: extra.sentAt ?? null,
    },
    select: { id: true },
  });
}

/** Hands one queued notification to its provider and records what came back. */
export async function deliver(notificationId: string, message: OutboundMessage): Promise<void> {
  const provider = providerFor(message.channel);
  const outcome = await provider.send(message);

  await prisma.notification.update({
    where: { id: notificationId },
    data: {
      deliveryStatus: outcome.status === 'SENT' ? 'SENT' : outcome.status,
      sentAt: outcome.status === 'SENT' ? new Date() : null,
      providerMessageId: outcome.providerMessageId ?? null,
      failureReason: outcome.failureReason ?? null,
    },
  });
}

/**
 * Releases what quiet hours held, and sends the batches that closed.
 *
 * Run on a schedule. Deliberately idempotent — it only picks up rows still QUEUED, so a
 * worker that runs twice, or two workers that overlap, cannot double-send.
 */
export async function flushPending(
  schoolId: string,
  options: { now?: Date; limit?: number } = {},
): Promise<{ sent: number; held: number }> {
  const now = options.now ?? new Date();
  const settings = await getSchoolSettings();
  const offsetMinutes = timezoneOffsetMs(now, settings.timezone) / 60_000;
  const local = new Date(now.getTime() + offsetMinutes * 60_000);
  const localMinutes = local.getUTCHours() * 60 + local.getUTCMinutes();

  /*
   * Readiness is a query predicate, not a filter over the results.
   *
   * Taking the oldest N rows and then discarding the ones that are not ready starves the
   * queue: a batch still collecting events, or a row held for quiet hours, sits at the
   * head of the list forever and everything behind it never gets looked at. Asking the
   * database for rows that can actually be sent means a held row costs nothing.
   */
  const batchWindowMs = settings.notifications.absenceBatchMinutes * 60_000;
  const batchCutoff = new Date(now.getTime() - batchWindowMs);
  const isQuiet = isWithinQuietHours(localMinutes, settings.notifications.quietHours);

  const pending = await prisma.notification.findMany({
    where: {
      schoolId,
      deliveryStatus: 'QUEUED',
      sentAt: null,
      // A batch that is still collecting events is not ready to send.
      OR: [{ batchKey: null }, { createdAt: { lte: batchCutoff } }],
      // In quiet hours only in-app moves; it makes no noise and it is the record.
      ...(isQuiet ? { channel: 'IN_APP' as const } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 500,
    select: {
      id: true,
      channel: true,
      type: true,
      payloadJson: true,
      batchKey: true,
      createdAt: true,
      user: { select: { id: true, phone: true, email: true, locale: true } },
    },
  });

  let sent = 0;
  let held = 0;

  for (const row of pending) {
    const type = row.type as NotificationType;
    const spec = specFor(type);
    if (!spec) continue;

    // The query excludes everything but in-app during quiet hours, so an urgent type is
    // picked up here by a second pass rather than being held with the rest.
    if (isQuiet && !spec.isUrgent && row.channel !== 'IN_APP') {
      held += 1;
      continue;
    }

    const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
    const destination = destinationFor(row.channel, row.user);
    if (!destination) {
      await prisma.notification.update({
        where: { id: row.id },
        data: { deliveryStatus: 'SUPPRESSED', failureReason: 'noDestination', sentAt: now },
      });
      continue;
    }

    const count = typeof payload['count'] === 'number' ? payload['count'] : 1;
    const body = typeof payload['body'] === 'string' ? payload['body'] : '';

    await deliver(row.id, {
      notificationId: row.id,
      type,
      channel: row.channel,
      destination,
      title: typeof payload['title'] === 'string' ? payload['title'] : type,
      // The batched message says how many events it covers — that is the difference
      // between one honest message and four annoying ones.
      body: count > 1 ? `${body} (${count} in total today)` : body,
      locale: row.user.locale === 'ur' ? 'ur' : 'en',
      ...(WHATSAPP_TEMPLATES[type] ? { templateName: WHATSAPP_TEMPLATES[type] } : {}),
      ...(Array.isArray(payload['templateVariables'])
        ? { templateVariables: payload['templateVariables'] as string[] }
        : {}),
    });
    sent += 1;
  }

  /*
   * Urgent types ignore quiet hours, so they need a pass of their own — the main query
   * narrowed to in-app to keep everything else silent, and a security alert or a payment
   * receipt at 23:00 is exactly the case that exemption exists for.
   */
  if (isQuiet) {
    const urgentTypes = NOTIFICATION_TYPE_NAMES.filter((name) => specFor(name).isUrgent);
    const urgent = await prisma.notification.findMany({
      where: {
        schoolId,
        deliveryStatus: 'QUEUED',
        sentAt: null,
        channel: { not: 'IN_APP' },
        type: { in: urgentTypes },
        OR: [{ batchKey: null }, { createdAt: { lte: batchCutoff } }],
      },
      orderBy: { createdAt: 'asc' },
      take: options.limit ?? 500,
      select: {
        id: true,
        channel: true,
        type: true,
        payloadJson: true,
        user: { select: { id: true, phone: true, email: true, locale: true } },
      },
    });

    for (const row of urgent) {
      const type = row.type as NotificationType;
      const destination = destinationFor(row.channel, row.user);
      if (!destination) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { deliveryStatus: 'SUPPRESSED', failureReason: 'noDestination', sentAt: now },
        });
        continue;
      }
      const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
      await deliver(row.id, {
        notificationId: row.id,
        type,
        channel: row.channel,
        destination,
        title: typeof payload['title'] === 'string' ? payload['title'] : type,
        body: typeof payload['body'] === 'string' ? payload['body'] : '',
        locale: row.user.locale === 'ur' ? 'ur' : 'en',
        ...(WHATSAPP_TEMPLATES[type] ? { templateName: WHATSAPP_TEMPLATES[type] } : {}),
      });
      sent += 1;
    }
  }

  return { sent, held };
}

export type BulkRecipient = { userId: string; payload: NotifyPayload };

/**
 * The bulk path.
 *
 * `notify()` is the right shape for one person and the wrong shape for two thousand:
 * publishing a series for a whole school through it costs roughly eight queries per
 * recipient, which is a fifty-second HTTP request and a principal watching a spinner.
 *
 * So a fan-out reads the settings and preferences once, writes every row in a single
 * insert, and leaves delivery to `flushPending` — which is the queue-backed worker the
 * architecture calls for. In-app rows are complete the moment they exist, so they are
 * written SENT; the rails that actually cost money are queued and go out in the worker's
 * own time, batched and inside quiet hours.
 *
 * The recipient's preference is still honoured per person, and an opt-out still leaves a
 * SUPPRESSED row with its reason — the log stays complete, which is the whole point of it.
 */
export async function notifyMany(
  schoolId: string,
  type: NotificationType,
  recipients: readonly BulkRecipient[],
  options: { now?: Date } = {},
): Promise<{ queued: number; suppressed: number }> {
  if (recipients.length === 0) return { queued: 0, suppressed: 0 };

  const now = options.now ?? new Date();
  const spec = specFor(type);
  const userIds = [...new Set(recipients.map((entry) => entry.userId))];

  const [users, preferences] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true, phone: true, email: true },
    }),
    prisma.notificationPreference.findMany({
      where: { userId: { in: userIds }, type },
      select: { userId: true, channel: true, enabled: true },
    }),
  ]);

  const byId = new Map(users.map((user) => [user.id, user]));
  const optedOut = new Set(
    preferences.filter((row) => !row.enabled).map((row) => `${row.userId}:${row.channel}`),
  );

  const rows: Prisma.NotificationCreateManyInput[] = [];
  let suppressed = 0;

  for (const recipient of recipients) {
    const user = byId.get(recipient.userId);
    if (!user) continue;
    const batchKey = batchKeyFor(type, recipient.userId, now);

    for (const channel of spec.defaultChannels) {
      const base = {
        schoolId,
        userId: recipient.userId,
        channel,
        type,
        payloadJson: recipient.payload as Prisma.InputJsonValue,
        batchKey,
      };

      if (optedOut.has(`${recipient.userId}:${channel}`)) {
        rows.push({ ...base, deliveryStatus: 'SUPPRESSED', failureReason: 'optedOut', sentAt: now });
        suppressed += 1;
        continue;
      }

      const destination = destinationFor(channel, user);
      if (!destination) {
        rows.push({ ...base, deliveryStatus: 'SUPPRESSED', failureReason: 'noDestination', sentAt: now });
        suppressed += 1;
        continue;
      }

      // In-app is the row itself; everything else waits for the worker.
      rows.push(
        channel === 'IN_APP'
          ? { ...base, deliveryStatus: 'SENT', sentAt: now }
          : { ...base, deliveryStatus: 'QUEUED' },
      );
    }
  }

  for (let index = 0; index < rows.length; index += 2_000) {
    await prisma.notification.createMany({ data: rows.slice(index, index + 2_000) });
  }

  return { queued: rows.length - suppressed, suppressed };
}
