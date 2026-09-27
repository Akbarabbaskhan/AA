import { route } from '@/lib/api/handler';
import { createEvent, eventInputSchema, eventQuerySchema, listEvents } from '@/lib/services/events';

export const dynamic = 'force-dynamic';

export const GET = route({ module: 'events' }, async ({ actor, request }) => {
  const query = eventQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listEvents(actor, query);
});

/*
 * The body goes through unparsed: `createEvent` decides which capability applies from the
 * society named in it, so it authorises first and validates second. Parsing here would hand
 * a caller with no business creating events a schema to read.
 */
export const POST = route({ module: 'events' }, async ({ actor, request }) =>
  createEvent(actor, await request.json()),
);
