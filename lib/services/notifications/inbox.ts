import { z } from 'zod';
import type { DeliveryStatus, NotificationChannel } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, type Actor } from '@/lib/permissions';
import { CHANNELS, NOTIFICATION_TYPE_NAMES, isKnownType, specFor } from './types';

/**
 * Reading notifications, setting preferences, and the delivery log.
 *
 * The log is a feature, not a table: "when a parent says 'I was never informed', the
 * school can show them otherwise. That log is a feature you should demo explicitly." So it
 * is queryable by the admin, shows suppressions and failures alongside successes, and says
 * why in each case.
 */

export type InboxItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
};

export async function getInbox(
  actor: Actor,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<{ items: InboxItem[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({
      where: {
        userId: actor.userId,
        // In-app is the inbox. The WhatsApp and SMS copies of the same event belong in
        // the delivery log, not in a list the recipient scrolls.
        channel: 'IN_APP',
        ...(options.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
      select: { id: true, type: true, payloadJson: true, createdAt: true, readAt: true },
    }),
    prisma.notification.count({
      where: { userId: actor.userId, channel: 'IN_APP', readAt: null },
    }),
  ]);

  return {
    items: rows.map((row) => {
      const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
      return {
        id: row.id,
        type: row.type,
        title: typeof payload['title'] === 'string' ? payload['title'] : row.type,
        body: typeof payload['body'] === 'string' ? payload['body'] : '',
        link: typeof payload['link'] === 'string' ? payload['link'] : null,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      };
    }),
    unread,
  };
}

export async function markRead(actor: Actor, notificationIds: string[]): Promise<{ read: number }> {
  // Scoped by userId in the where clause, so passing someone else's id marks nothing
  // rather than throwing — and never reveals whether that id exists.
  const result = await prisma.notification.updateMany({
    where: { id: { in: notificationIds }, userId: actor.userId, readAt: null },
    data: { readAt: new Date(), deliveryStatus: 'READ' },
  });
  return { read: result.count };
}

export async function markAllRead(actor: Actor): Promise<{ read: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId: actor.userId, channel: 'IN_APP', readAt: null },
    data: { readAt: new Date(), deliveryStatus: 'READ' },
  });
  return { read: result.count };
}

export type PreferenceRow = {
  type: string;
  /** Per channel: whether it is on for this user, and whether that is their own choice. */
  channels: { channel: NotificationChannel; enabled: boolean; isDefault: boolean }[];
  isUrgent: boolean;
};

/**
 * The preference matrix.
 *
 * Every type × channel pair, with the school default shown where the user has not chosen.
 * A screen that only lists what a user has explicitly set is one where nobody can find the
 * thing they want to turn off.
 */
export async function getPreferences(actor: Actor): Promise<PreferenceRow[]> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: actor.userId },
    select: { type: true, channel: true, enabled: true },
  });
  const chosen = new Map(rows.map((row) => [`${row.type}:${row.channel}`, row.enabled]));

  return NOTIFICATION_TYPE_NAMES.map((type) => {
    const spec = specFor(type);
    return {
      type,
      isUrgent: spec.isUrgent,
      channels: CHANNELS.map((channel) => {
        const isOnByDefault = spec.defaultChannels.includes(channel);
        const explicit = chosen.get(`${type}:${channel}`);
        return {
          channel,
          enabled: explicit ?? isOnByDefault,
          isDefault: explicit === undefined,
        };
      }),
    };
  });
}

export const preferenceSchema = z.object({
  type: z.string().min(1).max(60),
  channel: z.enum(CHANNELS),
  enabled: z.boolean(),
});

/**
 * Sets one preference.
 *
 * In-app cannot be turned off: it is the source of truth and the record that the school
 * told someone. Turning it off would leave a recipient with no way to see what was sent
 * and the school with a gap in the log it relies on.
 */
export async function setPreference(
  actor: Actor,
  raw: z.infer<typeof preferenceSchema>,
): Promise<{ ok: true }> {
  const input = preferenceSchema.parse(raw);
  if (!isKnownType(input.type)) throw ApiError.badRequest('unknownType', 'No such notification type.');

  if (input.channel === 'IN_APP' && !input.enabled) {
    throw ApiError.badRequest(
      'inAppRequired',
      'In-app notifications stay on — they are the record of what the school sent you.',
    );
  }

  await prisma.notificationPreference.upsert({
    where: { userId_type_channel: { userId: actor.userId, type: input.type, channel: input.channel } },
    create: {
      schoolId: actor.schoolId,
      userId: actor.userId,
      type: input.type,
      channel: input.channel,
      enabled: input.enabled,
    },
    update: { enabled: input.enabled },
  });

  return { ok: true };
}

export type DeliveryLogRow = {
  id: string;
  userId: string;
  userName: string;
  userPhone: string | null;
  type: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  title: string;
  failureReason: string | null;
  providerMessageId: string | null;
  createdAt: string;
  sentAt: string | null;
};

export const deliveryLogQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  type: z.string().max(60).optional(),
  channel: z.enum(CHANNELS).optional(),
  status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SUPPRESSED']).optional(),
  search: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * The delivery log.
 *
 * Admin-only, and deliberately searchable by phone number: the question it answers is
 * always "what did we send to *this* parent", asked while that parent is on the line.
 */
export async function getDeliveryLog(
  actor: Actor,
  query: z.infer<typeof deliveryLogQuerySchema>,
): Promise<DeliveryLogRow[]> {
  if (!can(actor, 'audit.read')) throw ApiError.notFound('Not found');

  const rows = await prisma.notification.findMany({
    where: {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { deliveryStatus: query.status } : {}),
      ...(query.search
        ? {
            user: {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { phone: { contains: query.search } },
              ],
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
    select: {
      id: true,
      userId: true,
      type: true,
      channel: true,
      deliveryStatus: true,
      payloadJson: true,
      failureReason: true,
      providerMessageId: true,
      createdAt: true,
      sentAt: true,
      user: { select: { name: true, phone: true } },
    },
  });

  return rows.map((row) => {
    const payload = (row.payloadJson ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      userId: row.userId,
      userName: row.user.name,
      userPhone: row.user.phone,
      type: row.type,
      channel: row.channel,
      status: row.deliveryStatus,
      title: typeof payload['title'] === 'string' ? payload['title'] : row.type,
      failureReason: row.failureReason,
      providerMessageId: row.providerMessageId,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
    };
  });
}
