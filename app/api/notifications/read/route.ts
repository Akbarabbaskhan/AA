import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { markAllRead, markRead } from '@/lib/services/notifications/inbox';

export const dynamic = 'force-dynamic';

export const POST = route({}, async ({ actor, request }) => {
  const input = z
    .object({ ids: z.array(z.string().uuid()).max(200).optional(), all: z.boolean().optional() })
    .parse(await request.json().catch(() => ({})));

  if (input.all) return markAllRead(actor);
  return markRead(actor, input.ids ?? []);
});
