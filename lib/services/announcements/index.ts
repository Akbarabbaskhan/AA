import { z } from 'zod';
import type { Prisma, RoleName } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { can, requireCapability, type Actor } from '@/lib/permissions';
import { writeAudit } from '@/lib/services/audit';
import { notifyMany } from '@/lib/services/notifications/notify';

/**
 * Announcements.
 *
 * "Admin or teacher composes, targets an audience (role, year group, section or named
 * individuals), schedules a publish time, and optionally pins it. Read receipts at the
 * aggregate level, so the admin sees '412 of 480 students have seen this.'"
 *
 * Aggregate is the operative word: the admin sees a count and a percentage, never a list
 * of who has not opened it. That list is what turns an announcement board into a
 * surveillance tool, and the school does not need it to know whether the message landed.
 */

export const ROLES = ['STUDENT', 'PARENT', 'TEACHER', 'HOD', 'ADMIN', 'BURSAR'] as const;

export const audienceSchema = z
  .object({
    roles: z.array(z.enum(ROLES)).max(6).optional(),
    yearGroupIds: z.array(z.string().uuid()).max(20).optional(),
    sectionIds: z.array(z.string().uuid()).max(100).optional(),
    userIds: z.array(z.string().uuid()).max(500).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.roles?.length ||
          value.yearGroupIds?.length ||
          value.sectionIds?.length ||
          value.userIds?.length,
      ),
    { message: 'Pick at least one audience.' },
  );

export type Audience = z.infer<typeof audienceSchema>;

export const announcementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  audience: audienceSchema,
  pinned: z.boolean().default(false),
  allowReplies: z.boolean().default(false),
  /** Scheduling: a publish time in the future holds it until then. */
  publishAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().nullable().default(null),
});

export function parseAudience(value: Prisma.JsonValue): Audience {
  const result = audienceSchema.safeParse(value ?? {});
  return result.success ? result.data : { roles: [] };
}

/**
 * Resolves an audience to user ids.
 *
 * Done at publish time rather than on every read: a student who joins next term should not
 * retroactively appear in the read-receipt denominator of a message sent before they
 * arrived, and an announcement's reach is a fact about when it was sent.
 */
export async function resolveAudience(audience: Audience): Promise<string[]> {
  const ids = new Set<string>(audience.userIds ?? []);

  if (audience.roles?.length) {
    const users = await prisma.user.findMany({
      where: { isActive: true, roles: { some: { role: { in: audience.roles as RoleName[] } } } },
      select: { id: true },
    });
    for (const user of users) ids.add(user.id);
  }

  const sectionIds = [...(audience.sectionIds ?? [])];
  if (audience.yearGroupIds?.length) {
    const sections = await prisma.section.findMany({
      where: { yearGroupId: { in: audience.yearGroupIds } },
      select: { id: true },
    });
    for (const section of sections) sectionIds.push(section.id);
  }

  if (sectionIds.length > 0) {
    const enrolments = await prisma.enrolment.findMany({
      where: { sectionId: { in: sectionIds }, droppedAt: null },
      select: { student: { select: { userId: true } } },
    });
    for (const enrolment of enrolments) ids.add(enrolment.student.userId);

    // A section announcement reaches its teacher too — they are part of that class.
    const sections = await prisma.section.findMany({
      where: { id: { in: sectionIds }, teacherId: { not: null } },
      select: { teacher: { select: { userId: true } } },
    });
    for (const section of sections) {
      if (section.teacher) ids.add(section.teacher.userId);
    }
  }

  return [...ids];
}

/**
 * Composes an announcement.
 *
 * A teacher may only target their own sections. Without that, `announcement.manage` lets
 * any teacher message the whole school, which is the feature every school asks to have
 * switched off a week after go-live.
 */
export async function createAnnouncement(
  actor: Actor,
  raw: z.infer<typeof announcementSchema>,
): Promise<{ id: string; recipients: number; scheduled: boolean }> {
  requireCapability(actor, 'announcement.manage');
  const input = announcementSchema.parse(raw);

  const isSchoolWide = can(actor, 'structure.manage');
  if (!isSchoolWide) {
    const outsideMySections = (input.audience.sectionIds ?? []).some(
      (sectionId) => !actor.sectionIds.includes(sectionId),
    );
    if (
      outsideMySections ||
      input.audience.roles?.length ||
      input.audience.yearGroupIds?.length ||
      input.audience.userIds?.length
    ) {
      throw ApiError.badRequest(
        'audienceTooWide',
        'You can announce to your own classes. Ask a coordinator for anything wider.',
        { audience: ['Limited to your sections.'] },
      );
    }
  }

  const publishAt = input.publishAt ?? new Date();
  const scheduled = publishAt.getTime() > Date.now() + 60_000;

  const announcement = await prisma.announcement.create({
    data: {
      schoolId: actor.schoolId,
      authorId: actor.userId,
      title: input.title,
      body: input.body,
      audienceJson: input.audience,
      pinned: input.pinned,
      allowReplies: input.allowReplies,
      publishAt,
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });

  await writeAudit(actor, {
    action: 'announcement.create',
    entityType: 'Announcement',
    entityId: announcement.id,
    after: { title: input.title, audience: input.audience, publishAt: publishAt.toISOString() },
  });

  // A scheduled announcement notifies nobody yet — `publishDue` picks it up at its time.
  const recipients = scheduled ? 0 : await fanOut(actor.schoolId, announcement.id);
  return { id: announcement.id, recipients, scheduled };
}

/** Sends the in-app and push copies to a published announcement's audience. */
async function fanOut(schoolId: string, announcementId: string): Promise<number> {
  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId },
    select: { id: true, title: true, body: true, audienceJson: true },
  });
  if (!announcement) return 0;

  const userIds = await resolveAudience(parseAudience(announcement.audienceJson));
  // A school-wide announcement is two thousand recipients; one bulk write, not two
  // thousand round trips while an admin waits on the compose screen.
  await notifyMany(
    schoolId,
    'announcement.published',
    userIds.map((userId) => ({
      userId,
      payload: {
        title: announcement.title,
        // Trimmed for the push; the full text lives in the app.
        body: announcement.body.slice(0, 160),
        templateVariables: [announcement.title],
        link: `/announcements/${announcement.id}`,
        announcementId: announcement.id,
      },
    })),
  );

  return userIds.length;
}

/**
 * Publishes anything whose scheduled time has arrived.
 *
 * Idempotent: it checks for an existing fan-out before sending, so a worker that runs
 * twice, or two workers that overlap, cannot announce the same thing to a school twice.
 */
export async function publishDue(schoolId: string, now = new Date()): Promise<{ published: number }> {
  const due = await prisma.announcement.findMany({
    where: { publishAt: { lte: now } },
    orderBy: { publishAt: 'desc' },
    select: { id: true },
    take: 50,
  });

  let published = 0;
  for (const announcement of due) {
    const alreadySent = await prisma.notification.findFirst({
      where: {
        type: 'announcement.published',
        payloadJson: { path: ['announcementId'], equals: announcement.id },
      },
      select: { id: true },
    });
    if (alreadySent) continue;
    await fanOut(schoolId, announcement.id);
    published += 1;
  }

  return { published };
}

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  authorName: string;
  pinned: boolean;
  allowReplies: boolean;
  publishAt: string;
  expiresAt: string | null;
  isRead: boolean;
  /** Staff view only: how many of the audience have opened it. */
  reach: { seen: number; audience: number; percent: number } | null;
};

/**
 * The reader's list.
 *
 * Pinned first, then newest. Scheduled and expired items are excluded in the query rather
 * than after it, so a future announcement cannot be read early by paging deeply.
 */
export async function listAnnouncements(
  actor: Actor,
  options: { limit?: number } = {},
): Promise<AnnouncementRow[]> {
  const now = new Date();
  const isStaff = can(actor, 'announcement.manage');

  const rows = await prisma.announcement.findMany({
    where: {
      publishAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    orderBy: [{ pinned: 'desc' }, { publishAt: 'desc' }],
    take: options.limit ?? 50,
    select: {
      id: true,
      title: true,
      body: true,
      audienceJson: true,
      pinned: true,
      allowReplies: true,
      publishAt: true,
      expiresAt: true,
      author: { select: { name: true } },
      reads: { select: { userId: true } },
    },
  });

  /*
   * Audience membership decides visibility, and it is computed per row rather than pushed
   * into SQL because the audience is a JSON shape. A near-miss predicate here would leak a
   * message meant for staff to the whole student body, so it is deliberately explicit.
   */
  const visible: AnnouncementRow[] = [];
  for (const row of rows) {
    const recipients = await resolveAudience(parseAudience(row.audienceJson));
    const isForMe = recipients.includes(actor.userId);
    if (!isForMe && !isStaff) continue;

    const seen = row.reads.length;
    visible.push({
      id: row.id,
      title: row.title,
      body: row.body,
      authorName: row.author.name,
      pinned: row.pinned,
      allowReplies: row.allowReplies,
      publishAt: row.publishAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      isRead: row.reads.some((read) => read.userId === actor.userId),
      reach: isStaff
        ? {
            seen,
            audience: recipients.length,
            percent: recipients.length === 0 ? 0 : Math.round((seen / recipients.length) * 100),
          }
        : null,
    });
  }

  return visible;
}

/** A read receipt. Idempotent — reopening an announcement does not inflate the count. */
export async function markAnnouncementRead(actor: Actor, announcementId: string): Promise<{ ok: true }> {
  const announcement = await prisma.announcement.findFirst({
    where: { id: announcementId, publishAt: { lte: new Date() } },
    select: { id: true, audienceJson: true },
  });
  if (!announcement) throw ApiError.notFound('Announcement not found');

  const recipients = await resolveAudience(parseAudience(announcement.audienceJson));
  if (!recipients.includes(actor.userId) && !can(actor, 'announcement.manage')) {
    throw ApiError.notFound('Announcement not found');
  }

  await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId, userId: actor.userId } },
    create: { announcementId, userId: actor.userId },
    update: {},
  });

  return { ok: true };
}
