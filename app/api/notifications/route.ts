import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { getInbox } from '@/lib/services/notifications/inbox';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = z
    .object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      unreadOnly: z.coerce.boolean().default(false),
    })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return getInbox(actor, query);
});
