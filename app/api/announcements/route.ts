import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { announcementSchema, createAnnouncement, listAnnouncements } from '@/lib/services/announcements';

export const dynamic = 'force-dynamic';

export const GET = route({ capability: 'announcement.read' }, async ({ actor, request }) => {
  const { limit } = z
    .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return listAnnouncements(actor, { limit });
});

export const POST = route({ capability: 'announcement.manage' }, async ({ actor, request }) => {
  const input = announcementSchema.parse(await request.json());
  return createAnnouncement(actor, input);
});
