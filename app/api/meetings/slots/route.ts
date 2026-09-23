import { z } from 'zod';
import { route } from '@/lib/api/handler';
import { listSlots, publishSlots, publishSlotsSchema } from '@/lib/services/parents/bookings';

export const dynamic = 'force-dynamic';

export const GET = route({}, async ({ actor, request }) => {
  const query = z
    .object({
      staffId: z.string().uuid().optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  return listSlots(actor, query);
});

export const POST = route({ capability: 'structure.manage' }, async ({ actor, request }) => {
  const input = publishSlotsSchema.parse(await request.json());
  return publishSlots(actor, input);
});
